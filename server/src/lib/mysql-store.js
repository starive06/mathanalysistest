import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import {
  CREATE_MIGRATIONS_TABLE,
  MIGRATIONS,
  SCHEMA_VERSION,
} from '../db/schema.js';
import { aliasCodeFor, aliasFor, hashClientId } from './identity.js';
import { AppError } from './errors.js';
import { startOfBusinessDay, toIsoString, toSafeNumber } from './time.js';

const PUBLIC_SELECT = `
  q.id,
  q.question,
  q.answer,
  q.model,
  q.status,
  q.latency_ms,
  q.created_at,
  q.course_id,
  (SELECT c.name FROM courses c WHERE c.id = q.course_id) AS course_name,
  q.image_token,
  q.image_mime,
  q.image_size_bytes,
  s.owner_hash,
  (SELECT COUNT(*) FROM likes l WHERE l.question_id = q.id) AS like_count,
  EXISTS(
    SELECT 1 FROM likes l2
    WHERE l2.question_id = q.id AND l2.student_id = ?
  ) AS liked_by_me,
  (SELECT COUNT(*) FROM question_comments c
   WHERE c.question_id = q.id AND c.deleted_at IS NULL) AS comment_count,
  (SELECT COUNT(*) FROM question_comments c
   WHERE c.question_id = q.id AND c.deleted_at IS NULL
     AND c.author_type = 'teacher') AS teacher_comment_count
`;

function clamp(value, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function nullableInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toDate(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`备份数据中的 ${fieldName} 不是有效时间：${value}`);
  }
  return date;
}

async function insertRows(connection, table, columns, rows, chunkSize = 400) {
  if (!rows.length) return;
  const columnSql = columns.join(', ');
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const placeholders = chunk
      .map(() => `(${columns.map(() => '?').join(', ')})`)
      .join(', ');
    const params = chunk.flatMap((row) => columns.map((column) => row[column]));
    await connection.query(
      `INSERT INTO ${table} (${columnSql}) VALUES ${placeholders}`,
      params,
    );
  }
}

export class MySQLQuestionStore {
  constructor({
    host,
    port = 3306,
    user,
    password = '',
    database,
    connectionLimit = 10,
    ssl = false,
    autoMigrate = true,
    hashSalt,
    businessTimezoneOffsetMinutes = 480,
    logger = console,
  }) {
    if (!host || !user || !database) {
      throw new Error('MySQL 配置不完整：需要 MYSQL_HOST、MYSQL_USER、MYSQL_DATABASE');
    }
    if (!hashSalt) throw new Error('MySQLQuestionStore requires hashSalt');
    this.host = host;
    this.port = port;
    this.user = user;
    this.password = password;
    this.database = database;
    this.connectionLimit = connectionLimit;
    this.ssl = ssl;
    this.autoMigrate = autoMigrate;
    this.hashSalt = hashSalt;
    this.businessTimezoneOffsetMinutes = businessTimezoneOffsetMinutes;
    this.logger = logger;
    this.pool = null;
    this.ready = false;
    this.backendType = 'mysql';
    this.schemaVersion = SCHEMA_VERSION;
  }

  get description() {
    return `MySQL ${this.user}@${this.host}:${this.port}/${this.database}`;
  }

  async init() {
    this.pool = mysql.createPool({
      host: this.host,
      port: this.port,
      user: this.user,
      password: this.password,
      database: this.database,
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: this.connectionLimit,
      queueLimit: 0,
      timezone: 'Z',
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: false,
      decimalNumbers: true,
      connectTimeout: 10_000,
      enableKeepAlive: true,
      ...(this.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    });
    // DATETIME 不带时区；统一连接会话为 UTC，避免云数据库默认 +08 与 Node UTC 比较错位。
    this.pool.on('connection', (connection) => {
      connection.query("SET time_zone = '+00:00'", () => {});
    });

    try {
      await this.pool.query('SELECT 1');
      if (this.autoMigrate) await this.migrate();
      this.ready = true;
      return this;
    } catch (error) {
      await this.pool.end().catch(() => {});
      this.pool = null;
      throw new Error(
        `MySQL 连接或初始化失败（${this.host}:${this.port}/${this.database}）：${error.message}`,
      );
    }
  }

  async migrate() {
    const connection = await this.pool.getConnection();
    try {
      await connection.query(CREATE_MIGRATIONS_TABLE);
      const [rows] = await connection.query(
        'SELECT version FROM schema_migrations ORDER BY version ASC',
      );
      const applied = new Set(rows.map((row) => Number(row.version)));
      for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        for (const statement of migration.statements) {
          await connection.query(statement);
        }
        await connection.execute(
          'INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
          [migration.version, new Date()],
        );
        this.logger.info(`[mysql] schema migrated to v${migration.version}`);
      }
    } finally {
      connection.release();
    }
  }

  async ping() {
    if (!this.pool) return false;
    let timer;
    try {
      const ok = await Promise.race([
        this.pool.query('SELECT 1').then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), 3000);
        }),
      ]);
      return ok === true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.ready = false;
    }
  }

  hashClient(clientId) {
    return hashClientId(this.hashSalt, clientId);
  }

  aliasFor(ownerHash) {
    return aliasFor(ownerHash);
  }

  _serializeCourse(row) {
    return {
      id: row.id,
      name: row.name,
      teacherName: row.teacher_name,
      courseCode: row.course_code,
      term: row.term || '',
      colorIndex: toSafeNumber(row.color_index),
      sortOrder: toSafeNumber(row.sort_order),
      status: row.status || 'active',
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
      deletedAt: toIsoString(row.deleted_at),
    };
  }

  async listCourses({ includeArchived = false } = {}) {
    const [rows] = await this.pool.execute(
      `SELECT id, name, teacher_name, course_code, term, color_index, sort_order,
              status, created_at, updated_at, deleted_at
       FROM courses
       WHERE deleted_at IS NULL${includeArchived ? '' : " AND status = 'active'"}
       ORDER BY sort_order ASC, created_at ASC`,
    );
    return rows.map((row) => this._serializeCourse(row));
  }

  async getCourse(id) {
    const [rows] = await this.pool.execute(
      `SELECT id, name, teacher_name, course_code, term, color_index, sort_order,
              status, created_at, updated_at, deleted_at
       FROM courses WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    return rows[0] ? this._serializeCourse(rows[0]) : null;
  }

  async createCourse({ id, name, teacherName, courseCode, term, colorIndex, sortOrder }) {
    const now = new Date();
    try {
      await this.pool.execute(
        `INSERT INTO courses
          (id, name, teacher_name, course_code, term, color_index, sort_order,
           status, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
        [
          id,
          name,
          teacherName,
          courseCode,
          term || null,
          Number(colorIndex) || 0,
          Number(sortOrder) || 0,
          now,
          now,
        ],
      );
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        error.code = 'COURSE_CODE_EXISTS';
        error.message = '课程编号已存在。';
      }
      throw error;
    }
    return this.getCourse(id);
  }

  async updateCourse(id, updates) {
    const fields = [];
    const params = [];
    const mapping = {
      name: 'name',
      teacherName: 'teacher_name',
      courseCode: 'course_code',
      term: 'term',
      colorIndex: 'color_index',
      sortOrder: 'sort_order',
      status: 'status',
    };
    for (const [key, column] of Object.entries(mapping)) {
      if (updates[key] !== undefined) {
        fields.push(`${column} = ?`);
        params.push(updates[key]);
      }
    }
    if (!fields.length) return this.getCourse(id);
    fields.push('updated_at = ?');
    params.push(new Date(), id);
    try {
      const [result] = await this.pool.execute(
        `UPDATE courses SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
        params,
      );
      if (!result.affectedRows) return null;
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        error.code = 'COURSE_CODE_EXISTS';
        error.message = '课程编号已存在。';
      }
      throw error;
    }
    return this.getCourse(id);
  }

  async archiveCourse(id) {
    const [result] = await this.pool.execute(
      `UPDATE courses SET status = 'archived', updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [new Date(), id],
    );
    return result.affectedRows ? this.getCourse(id) : null;
  }

  async _findStudentByHash(ownerHash, connection = this.pool) {
    const [rows] = await connection.execute(
      'SELECT id, owner_hash, alias_code FROM students WHERE owner_hash = ? LIMIT 1',
      [ownerHash],
    );
    return rows[0] ?? null;
  }

  async _getOrCreateStudent(connection, ownerHash) {
    const now = new Date();
    await connection.execute(
      `INSERT INTO students (owner_hash, alias_code, created_at, last_seen_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_seen_at = ?`,
      [ownerHash, aliasCodeFor(ownerHash), now, now, now],
    );
    const student = await this._findStudentByHash(ownerHash, connection);
    if (!student) throw new Error('无法创建或读取学生匿名身份');
    return student;
  }

  _serializeQuestion(row, { withAlias = false } = {}) {
    const result = {
      id: row.id,
      courseId: row.course_id || 'c_default',
      courseName: row.course_name || '',
      question: row.question,
      answer: row.answer ?? '',
      createdAt: toIsoString(row.created_at),
      status: row.status || 'answered',
      likeCount: toSafeNumber(row.like_count, 0),
      likedByMe: Boolean(Number(row.liked_by_me)),
      commentCount: toSafeNumber(row.comment_count, 0),
      teacherCommentCount: toSafeNumber(row.teacher_comment_count, 0),
      imagePath: row.image_token ? `/api/images/${row.image_token}` : '',
      imageMimeType: row.image_mime || '',
      imageSizeBytes: row.image_size_bytes === null ? 0 : toSafeNumber(row.image_size_bytes),
    };
    if (withAlias) result.alias = aliasFor(row.owner_hash);
    return result;
  }

  async addQuestion({
    ownerHash,
    courseId = 'c_default',
    question,
    answer,
    model,
    usage = null,
    latencyMs = 0,
    image = null,
  }) {
    const id = `q_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
    const now = new Date();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const student = await this._getOrCreateStudent(connection, ownerHash);
      await connection.execute(
        `INSERT INTO questions
          (id, student_id, course_id, question, answer, model, status,
           prompt_tokens, completion_tokens, latency_ms, created_at, deleted_at,
           image_key, image_mime, image_provider, image_token, image_size_bytes)
         VALUES (?, ?, ?, ?, ?, ?, 'answered', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        [
          id,
          student.id,
          courseId,
          question,
          answer,
          String(model || '').slice(0, 80),
          nullableInt(usage?.prompt_tokens),
          nullableInt(usage?.completion_tokens),
          Number.isFinite(Number(latencyMs)) ? Math.max(0, Math.trunc(Number(latencyMs))) : 0,
          now,
          image?.storageKey || null,
          image?.mimeType || null,
          image?.storageProvider || null,
          image?.token || null,
          image?.sizeBytes ?? null,
        ],
      );
      await connection.commit();
      return {
        id,
        courseId,
        courseName: '',
        question,
        answer,
        createdAt: now.toISOString(),
        status: 'answered',
        likeCount: 0,
        likedByMe: false,
        commentCount: 0,
        teacherCommentCount: 0,
        imagePath: image?.token ? `/api/images/${image.token}` : '',
        imageMimeType: image?.mimeType || '',
        imageSizeBytes: image?.sizeBytes || 0,
      };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async listForClient(ownerHash, { limit = 30, offset = 0, courseId = '' } = {}) {
    const safeLimit = clamp(limit, 1, 100);
    const safeOffset = clamp(offset, 0, 1_000_000);
    const student = await this._findStudentByHash(ownerHash);
    if (!student) return { total: 0, items: [] };
    const courseClause = courseId ? ' AND q.course_id = ?' : '';
    const courseParams = courseId ? [courseId] : [];

    const [[totalRow]] = await this.pool.execute(
      `SELECT COUNT(*) AS total
       FROM questions q
       WHERE q.student_id = ? AND q.deleted_at IS NULL${courseClause}`,
      [student.id, ...courseParams],
    );
    const [rows] = await this.pool.execute(
      `SELECT ${PUBLIC_SELECT}
       FROM questions q
       JOIN students s ON s.id = q.student_id
       WHERE q.student_id = ? AND q.deleted_at IS NULL${courseClause}
       ORDER BY q.created_at DESC, q.id DESC
       LIMIT ? OFFSET ?`,
      [student.id, student.id, ...courseParams, safeLimit, safeOffset],
    );
    return {
      total: toSafeNumber(totalRow.total),
      items: rows.map((row) => this._serializeQuestion(row)),
    };
  }

  async getQuestionByImageToken(token) {
    const [rows] = await this.pool.execute(
      `SELECT image_provider AS imageProvider, image_key AS imageKey,
              image_mime AS imageMimeType, image_size_bytes AS imageSizeBytes, image_token AS imageToken
       FROM questions WHERE image_token = ? AND deleted_at IS NULL LIMIT 1`,
      [token],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      imageProvider: row.imageProvider,
      imageKey: row.imageKey,
      imageMimeType: row.imageMimeType,
      imageSizeBytes: toSafeNumber(row.imageSizeBytes),
      imageToken: row.imageToken,
    };
  }

  async getQuestion(id, viewerHash) {
    const viewer = await this._findStudentByHash(viewerHash);
    const viewerId = viewer ? Number(viewer.id) : 0;
    const [rows] = await this.pool.execute(
      `SELECT ${PUBLIC_SELECT}
       FROM questions q
       JOIN students s ON s.id = q.student_id
       WHERE q.id = ? AND q.deleted_at IS NULL
       LIMIT 1`,
      [viewerId, id],
    );
    return rows[0] ? this._serializeQuestion(rows[0]) : null;
  }

  async getCommunity(viewerHash, { limit = 30, offset = 0, courseId = '' } = {}) {
    const safeLimit = clamp(limit, 1, 100);
    const safeOffset = clamp(offset, 0, 1_000_000);
    const viewer = await this._findStudentByHash(viewerHash);
    const viewerId = viewer ? Number(viewer.id) : 0;
    const courseClause = courseId ? ' AND q.course_id = ?' : '';
    const courseParams = courseId ? [courseId] : [];

    const [topRows] = await this.pool.execute(
      `SELECT ${PUBLIC_SELECT}
       FROM questions q
       JOIN students s ON s.id = q.student_id
       WHERE q.deleted_at IS NULL${courseClause}
       ORDER BY like_count DESC, q.created_at ASC, q.id ASC
       LIMIT 3`,
      [viewerId, ...courseParams],
    );

    const top = topRows.map((row) => this._serializeQuestion(row, { withAlias: true }));
    const topIds = top.map((item) => item.id);
    const exclusion = topIds.length
      ? `AND q.id NOT IN (${topIds.map(() => '?').join(', ')})`
      : '';

    const [[recentTotalRow]] = await this.pool.execute(
      `SELECT COUNT(*) AS total
       FROM questions q
       WHERE q.deleted_at IS NULL ${exclusion}${courseClause}`,
      [...topIds, ...courseParams],
    );
    const [recentRows] = await this.pool.execute(
      `SELECT ${PUBLIC_SELECT}
       FROM questions q
       JOIN students s ON s.id = q.student_id
       WHERE q.deleted_at IS NULL ${exclusion}${courseClause}
       ORDER BY q.created_at DESC, q.id DESC
       LIMIT ? OFFSET ?`,
      [viewerId, ...topIds, ...courseParams, safeLimit, safeOffset],
    );
    const recentTotal = toSafeNumber(recentTotalRow.total);
    return {
      top,
      recent: recentRows.map((row) => this._serializeQuestion(row, { withAlias: true })),
      stats: await this.stats({ courseId }),
      recentTotal,
      hasMore: safeOffset + recentRows.length < recentTotal,
    };
  }

  async toggleLike(questionId, viewerHash) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const student = await this._getOrCreateStudent(connection, viewerHash);
      const [questionRows] = await connection.execute(
        'SELECT id FROM questions WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
        [questionId],
      );
      if (!questionRows[0]) {
        await connection.rollback();
        return null;
      }

      const [existing] = await connection.execute(
        'SELECT 1 FROM likes WHERE question_id = ? AND student_id = ? LIMIT 1',
        [questionId, student.id],
      );
      let liked;
      if (existing.length) {
        await connection.execute(
          'DELETE FROM likes WHERE question_id = ? AND student_id = ?',
          [questionId, student.id],
        );
        liked = false;
      } else {
        await connection.execute(
          'INSERT INTO likes (question_id, student_id, created_at) VALUES (?, ?, ?)',
          [questionId, student.id, new Date()],
        );
        liked = true;
      }
      const [[countRow]] = await connection.execute(
        'SELECT COUNT(*) AS total FROM likes WHERE question_id = ?',
        [questionId],
      );
      await connection.commit();
      return {
        id: questionId,
        liked,
        likeCount: toSafeNumber(countRow.total),
      };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async stats({ courseId = '' } = {}) {
    const todayStart = startOfBusinessDay(
      new Date(),
      this.businessTimezoneOffsetMinutes,
    );
    const courseClause = courseId ? ' AND q.course_id = ?' : '';
    const courseParams = courseId ? [courseId] : [];
    const queries = [
      this.pool.execute(
        `SELECT COUNT(*) AS total FROM questions q WHERE q.deleted_at IS NULL${courseClause}`,
        courseParams,
      ),
      this.pool.execute(
        `SELECT COUNT(DISTINCT q.student_id) AS total
         FROM questions q WHERE q.deleted_at IS NULL${courseClause}`,
        courseParams,
      ),
      this.pool.execute(
        `SELECT COUNT(*) AS total
         FROM likes l JOIN questions q ON q.id = l.question_id
         WHERE q.deleted_at IS NULL${courseClause}`,
        courseParams,
      ),
      this.pool.execute(
        `SELECT COUNT(*) AS total
         FROM questions q WHERE q.deleted_at IS NULL AND q.created_at >= ?${courseClause}`,
        [todayStart, ...courseParams],
      ),
      this.pool.execute(
        `SELECT COUNT(*) AS total
         FROM questions q WHERE q.deleted_at IS NULL AND q.status = 'answered'${courseClause}`,
        courseParams,
      ),
    ];
    const results = await Promise.all(queries);
    return {
      totalQuestions: toSafeNumber(results[0][0][0].total),
      totalStudents: toSafeNumber(results[1][0][0].total),
      totalLikes: toSafeNumber(results[2][0][0].total),
      todayQuestions: toSafeNumber(results[3][0][0].total),
      answeredQuestions: toSafeNumber(results[4][0][0].total),
    };
  }

  async _getStudentLabels() {
    const [rows] = await this.pool.query(
      `SELECT s.owner_hash, MIN(q.created_at) AS first_at
       FROM questions q
       JOIN students s ON s.id = q.student_id
       WHERE q.deleted_at IS NULL
       GROUP BY s.id, s.owner_hash
       ORDER BY first_at ASC, s.id ASC`,
    );
    const labels = new Map();
    for (const row of rows) {
      labels.set(row.owner_hash, `学生 ${String(labels.size + 1).padStart(2, '0')}`);
    }
    return labels;
  }

  async getAdminQuestions({ courseId = '' } = {}) {
    const courseClause = courseId ? ' AND q.course_id = ?' : '';
    const params = courseId ? [courseId] : [];
    const [rows] = await this.pool.execute(
      `SELECT q.id, q.course_id, q.question, q.answer, q.model, q.status, q.latency_ms,
              q.created_at, q.image_token, q.image_mime, q.image_size_bytes, s.owner_hash,
              (SELECT c.name FROM courses c WHERE c.id = q.course_id) AS course_name,
              (SELECT COUNT(*) FROM likes l WHERE l.question_id = q.id) AS like_count,
              (SELECT COUNT(*) FROM question_comments c
               WHERE c.question_id = q.id AND c.deleted_at IS NULL) AS comment_count,
              (SELECT COUNT(*) FROM question_comments c
               WHERE c.question_id = q.id AND c.deleted_at IS NULL
                 AND c.author_type = 'teacher') AS teacher_comment_count
       FROM questions q
       JOIN students s ON s.id = q.student_id
       WHERE q.deleted_at IS NULL${courseClause}
       ORDER BY q.created_at DESC, q.id DESC`,
      params,
    );
    const labels = await this._getStudentLabels();
    return rows.map((row) => ({
      id: row.id,
      courseId: row.course_id || 'c_default',
      courseName: row.course_name || '',
      studentLabel: labels.get(row.owner_hash) ?? '学生 --',
      question: row.question,
      answer: row.answer ?? '',
      createdAt: toIsoString(row.created_at),
      likeCount: toSafeNumber(row.like_count),
      commentCount: toSafeNumber(row.comment_count),
      teacherCommentCount: toSafeNumber(row.teacher_comment_count),
      imagePath: row.image_token ? `/api/images/${row.image_token}` : '',
      imageMimeType: row.image_mime || '',
      imageSizeBytes: row.image_size_bytes === null ? 0 : toSafeNumber(row.image_size_bytes),
      status: row.status || 'answered',
      model: row.model,
      latencyMs: toSafeNumber(row.latency_ms),
    }));
  }

  async getQuestionsForExport(ids = [], { courseId = '' } = {}) {
    const idSet = new Set(ids.filter(Boolean));
    const params = [];
    let filter = '';
    if (idSet.size) {
      const values = [...idSet];
      filter += ` AND q.id IN (${values.map(() => '?').join(', ')})`;
      params.push(...values);
    }
    if (courseId) {
      filter += ' AND q.course_id = ?';
      params.push(courseId);
    }
    const [rows] = await this.pool.execute(
      `SELECT q.id, q.course_id, q.question, q.answer, q.model, q.status, q.latency_ms,
              q.created_at, s.owner_hash,
              (SELECT c.name FROM courses c WHERE c.id = q.course_id) AS course_name,
              (SELECT COUNT(*) FROM likes l WHERE l.question_id = q.id) AS like_count
       FROM questions q
       JOIN students s ON s.id = q.student_id
       WHERE q.deleted_at IS NULL ${filter}
       ORDER BY q.created_at ASC, q.id ASC`,
      params,
    );
    const labels = await this._getStudentLabels();
    return rows.map((row) => ({
      id: row.id,
      courseId: row.course_id || 'c_default',
      courseName: row.course_name || '',
      question: row.question,
      answer: row.answer ?? '',
      createdAt: toIsoString(row.created_at),
      status: row.status || 'answered',
      likeCount: toSafeNumber(row.like_count),
      likedByMe: false,
      alias: aliasFor(row.owner_hash),
      studentLabel: labels.get(row.owner_hash) ?? '学生 --',
      model: row.model,
      latencyMs: toSafeNumber(row.latency_ms),
    }));
  }

  _serializeTeacher(row, { includePassword = false } = {}) {
    if (!row) return null;
    const teacher = {
      id: Number(row.id),
      email: row.email,
      name: row.name,
      publicId: row.public_id,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
    };
    if (includePassword) teacher.passwordHash = row.password_hash;
    return teacher;
  }

  async countTeachers() {
    const [[row]] = await this.pool.query('SELECT COUNT(*) AS total FROM teachers');
    return toSafeNumber(row.total);
  }

  async createTeacher({ email, passwordHash, name, publicId }) {
    const now = new Date();
    try {
      const [result] = await this.pool.execute(
        `INSERT INTO teachers (email, password_hash, name, public_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [email, passwordHash, name, publicId, now, now],
      );
      return this.getTeacherById(result.insertId);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw new AppError(409, 'TEACHER_ACCOUNT_EXISTS', '邮箱或对外展示 ID 已被使用。');
      }
      throw error;
    }
  }

  async getTeacherByEmail(email) {
    const [rows] = await this.pool.execute(
      'SELECT id, email, password_hash, name, public_id, created_at, updated_at FROM teachers WHERE email = ? LIMIT 1',
      [email],
    );
    return this._serializeTeacher(rows[0], { includePassword: true });
  }

  async getTeacherById(id) {
    const [rows] = await this.pool.execute(
      'SELECT id, email, name, public_id, created_at, updated_at FROM teachers WHERE id = ? LIMIT 1',
      [id],
    );
    return this._serializeTeacher(rows[0]);
  }

  async getTeacherAuthById(id) {
    const [rows] = await this.pool.execute(
      'SELECT id, email, password_hash, name, public_id, created_at, updated_at FROM teachers WHERE id = ? LIMIT 1',
      [id],
    );
    return this._serializeTeacher(rows[0], { includePassword: true });
  }

  async updateTeacher(id, { email, name, publicId }) {
    try {
      const [result] = await this.pool.execute(
        `UPDATE teachers SET email = ?, name = ?, public_id = ?, updated_at = ?
         WHERE id = ?`,
        [email, name, publicId, new Date(), id],
      );
      if (!result.affectedRows) return null;
      return this.getTeacherById(id);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw new AppError(409, 'TEACHER_ACCOUNT_EXISTS', '邮箱或对外展示 ID 已被使用。');
      }
      throw error;
    }
  }

  async updateTeacherPassword(id, passwordHash) {
    const [result] = await this.pool.execute(
      'UPDATE teachers SET password_hash = ?, updated_at = ? WHERE id = ?',
      [passwordHash, new Date(), id],
    );
    return result.affectedRows > 0;
  }

  async createTeacherSession({ teacherId, tokenHash, expiresAt }) {
    const now = new Date();
    await this.pool.execute(
      `INSERT INTO teacher_sessions (teacher_id, token_hash, created_at, expires_at, last_used_at)
       VALUES (?, ?, ?, ?, ?)`,
      [teacherId, tokenHash, now, expiresAt, now],
    );
  }

  async getTeacherBySession(tokenHash) {
    const [rows] = await this.pool.execute(
      `SELECT t.id, t.email, t.name, t.public_id, t.created_at, t.updated_at,
              s.id AS session_id, s.expires_at
       FROM teacher_sessions s
       JOIN teachers t ON t.id = s.teacher_id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3) LIMIT 1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return null;
    await this.pool
      .execute('UPDATE teacher_sessions SET last_used_at = ? WHERE id = ?', [
        new Date(),
        row.session_id,
      ])
      .catch(() => {});
    return this._serializeTeacher(row);
  }

  async deleteTeacherSession(tokenHash) {
    await this.pool.execute('DELETE FROM teacher_sessions WHERE token_hash = ?', [tokenHash]);
  }

  async deleteTeacherSessions(teacherId) {
    await this.pool.execute('DELETE FROM teacher_sessions WHERE teacher_id = ?', [teacherId]);
  }

  async bindStudentMiniOpenid(ownerHash, miniOpenid) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const student = await this._getOrCreateStudent(connection, ownerHash);
      await connection.execute(
        'UPDATE students SET mini_openid = NULL WHERE mini_openid = ? AND id <> ?',
        [miniOpenid, student.id],
      );
      await connection.execute('UPDATE students SET mini_openid = ? WHERE id = ?', [
        miniOpenid,
        student.id,
      ]);
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async getStudentMiniOpenid(ownerHash) {
    const student = await this._findStudentByHash(ownerHash);
    if (!student) return '';
    const [rows] = await this.pool.execute(
      'SELECT mini_openid FROM students WHERE id = ? LIMIT 1',
      [student.id],
    );
    return rows[0]?.mini_openid || '';
  }

  async getQuestionOwnerHash(questionId) {
    const [rows] = await this.pool.execute(
      `SELECT s.owner_hash
       FROM questions q JOIN students s ON s.id = q.student_id
       WHERE q.id = ? AND q.deleted_at IS NULL LIMIT 1`,
      [questionId],
    );
    return rows[0]?.owner_hash || '';
  }

  _serializeComment(row) {
    return {
      id: row.id,
      questionId: row.question_id,
      authorType: row.author_type,
      authorName: row.author_name,
      authorPublicId: row.author_public_id || '',
      content: row.content,
      createdAt: toIsoString(row.created_at),
      likeCount: toSafeNumber(row.like_count),
      likedByMe: Boolean(Number(row.liked_by_me)),
    };
  }

  async createComment({
    id,
    questionId,
    authorType,
    studentOwnerHash = null,
    teacherId = null,
    authorName,
    authorPublicId = null,
    content,
  }) {
    await this.pool.execute(
      `INSERT INTO question_comments
        (id, question_id, author_type, student_owner_hash, teacher_id,
         author_name, author_public_id, content, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        id,
        questionId,
        authorType,
        studentOwnerHash,
        teacherId,
        authorName,
        authorPublicId,
        content,
        new Date(),
      ],
    );
    const [rows] = await this.pool.execute(
      `SELECT c.*, 0 AS like_count, 0 AS liked_by_me
       FROM question_comments c WHERE c.id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ? this._serializeComment(rows[0]) : null;
  }

  async getQuestionComments(questionId, { viewerType = 'student', actorHash = '' } = {}) {
    const viewerActorType = viewerType === 'teacher' ? 'teacher' : 'student';
    const [rows] = await this.pool.execute(
      `SELECT c.*,
              (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS like_count,
              EXISTS(
                SELECT 1 FROM comment_likes cl2
                WHERE cl2.comment_id = c.id
                  AND cl2.actor_type = ? AND cl2.actor_hash = ?
              ) AS liked_by_me
       FROM question_comments c
       WHERE c.question_id = ? AND c.deleted_at IS NULL
       ORDER BY CASE c.author_type WHEN 'teacher' THEN 0 ELSE 1 END,
                c.created_at ASC, c.id ASC`,
      [viewerActorType, actorHash, questionId],
    );
    return rows.map((row) => this._serializeComment(row));
  }

  async getTeacherCommentsForQuestions(questionIds, { viewerType = 'student', actorHash = '' } = {}) {
    if (!questionIds.length) return new Map();
    const placeholders = questionIds.map(() => '?').join(', ');
    const viewerActorType = viewerType === 'teacher' ? 'teacher' : 'student';
    const [rows] = await this.pool.execute(
      `SELECT c.*,
              (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS like_count,
              EXISTS(
                SELECT 1 FROM comment_likes cl2
                WHERE cl2.comment_id = c.id
                  AND cl2.actor_type = ? AND cl2.actor_hash = ?
              ) AS liked_by_me
       FROM question_comments c
       WHERE c.question_id IN (${placeholders})
         AND c.author_type = 'teacher' AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC, c.id ASC`,
      [viewerActorType, actorHash, ...questionIds],
    );
    const map = new Map();
    for (const row of rows) {
      const comment = this._serializeComment(row);
      if (!map.has(comment.questionId)) map.set(comment.questionId, []);
      map.get(comment.questionId).push(comment);
    }
    return map;
  }

  async toggleCommentLike(commentId, { actorType, actorHash }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [commentRows] = await connection.execute(
        'SELECT id FROM question_comments WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
        [commentId],
      );
      if (!commentRows[0]) {
        await connection.rollback();
        return null;
      }
      const normalizedType = actorType === 'teacher' ? 'teacher' : 'student';
      const [existing] = await connection.execute(
        `SELECT 1 FROM comment_likes
         WHERE comment_id = ? AND actor_type = ? AND actor_hash = ? LIMIT 1`,
        [commentId, normalizedType, actorHash],
      );
      let liked;
      if (existing.length) {
        await connection.execute(
          `DELETE FROM comment_likes
           WHERE comment_id = ? AND actor_type = ? AND actor_hash = ?`,
          [commentId, normalizedType, actorHash],
        );
        liked = false;
      } else {
        await connection.execute(
          `INSERT INTO comment_likes (comment_id, actor_type, actor_hash, created_at)
           VALUES (?, ?, ?, ?)`,
          [commentId, normalizedType, actorHash, new Date()],
        );
        liked = true;
      }
      const [[countRow]] = await connection.execute(
        'SELECT COUNT(*) AS total FROM comment_likes WHERE comment_id = ?',
        [commentId],
      );
      await connection.commit();
      return { id: commentId, liked, likeCount: toSafeNumber(countRow.total) };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async recordPushNotification({
    commentId,
    studentOwnerHash,
    channel = 'wechat_service',
    status,
    errorMessage = '',
    sentAt = null,
  }) {
    await this.pool.execute(
      `INSERT INTO push_notifications
        (comment_id, student_owner_hash, channel, status, error_message, created_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         error_message = VALUES(error_message),
         sent_at = VALUES(sent_at)`,
      [
        commentId,
        studentOwnerHash,
        channel,
        status,
        errorMessage ? String(errorMessage).slice(0, 500) : null,
        new Date(),
        sentAt,
      ],
    );
  }

  async getQuestionMeta(id) {
    const [rows] = await this.pool.execute(
      `SELECT q.id, q.course_id, s.owner_hash
       FROM questions q JOIN students s ON s.id = q.student_id
       WHERE q.id = ? AND q.deleted_at IS NULL LIMIT 1`,
      [id],
    );
    const row = rows[0];
    return row
      ? { id: row.id, ownerHash: row.owner_hash, courseId: row.course_id || 'c_default' }
      : null;
  }

  async getCommentMeta(id) {
    const [rows] = await this.pool.execute(
      `SELECT c.id, c.question_id, c.author_type, c.student_owner_hash,
              q.course_id, s.owner_hash AS question_owner_hash
       FROM question_comments c
       JOIN questions q ON q.id = c.question_id
       JOIN students s ON s.id = q.student_id
       WHERE c.id = ? AND c.deleted_at IS NULL LIMIT 1`,
      [id],
    );
    const row = rows[0];
    return row
      ? {
          id: row.id,
          questionId: row.question_id,
          authorType: row.author_type,
          studentOwnerHash: row.student_owner_hash || '',
          questionOwnerHash: row.question_owner_hash || '',
          courseId: row.course_id || 'c_default',
        }
      : null;
  }

  async createCourseNotice({ id, courseId, type, title, body, resourceId = '' }) {
    await this.pool.execute(
      `INSERT INTO course_notices
        (id, course_id, type, title, body, resource_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, courseId, type, title, body || null, resourceId || null, new Date()],
    );
    return { id, courseId, type, title, body, resourceId };
  }

  async listCourseNotices(ownerHash, { limit = 30, offset = 0 } = {}) {
    const safeLimit = clamp(limit, 1, 100);
    const safeOffset = clamp(offset, 0, 1_000_000);
    const [[totalRow]] = await this.pool.execute(
      'SELECT COUNT(*) AS total FROM course_notices',
    );
    const [rows] = await this.pool.execute(
      `SELECT n.*, c.name AS course_name,
              EXISTS(
                SELECT 1 FROM notice_reads r
                WHERE r.notice_id = n.id AND r.owner_hash = ?
              ) AS is_read
       FROM course_notices n
       JOIN courses c ON c.id = n.course_id
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ? OFFSET ?`,
      [ownerHash, safeLimit, safeOffset],
    );
    return {
      total: toSafeNumber(totalRow.total),
      items: rows.map((row) => ({
        id: row.id,
        box: 'notice',
        type: row.type,
        courseId: row.course_id,
        courseName: row.course_name || '',
        title: row.title,
        body: row.body || '',
        resourceId: row.resource_id || '',
        createdAt: toIsoString(row.created_at),
        read: Boolean(Number(row.is_read)),
      })),
      hasMore: safeOffset + rows.length < toSafeNumber(totalRow.total),
    };
  }

  async markNoticeRead(ownerHash, noticeId) {
    const [rows] = await this.pool.execute(
      'SELECT id FROM course_notices WHERE id = ? LIMIT 1',
      [noticeId],
    );
    if (!rows[0]) return false;
    await this.pool.execute(
      `INSERT INTO notice_reads (notice_id, owner_hash, read_at)
       VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE read_at = read_at`,
      [noticeId, ownerHash, new Date()],
    );
    return true;
  }

  async markAllNoticesRead(ownerHash) {
    await this.pool.execute(
      `INSERT IGNORE INTO notice_reads (notice_id, owner_hash, read_at)
       SELECT id, ?, ? FROM course_notices`,
      [ownerHash, new Date()],
    );
    return true;
  }

  async createStudentEvent({
    id,
    courseId,
    recipientHash,
    actorHash,
    type,
    title,
    body,
    questionId = '',
    commentId = '',
  }) {
    await this.pool.execute(
      `INSERT INTO student_events
        (id, course_id, recipient_hash, actor_hash, type, title, body,
         question_id, comment_id, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        id,
        courseId,
        recipientHash,
        actorHash || null,
        type,
        title,
        body || null,
        questionId || null,
        commentId || null,
        new Date(),
      ],
    );
    return { id };
  }

  async listStudentEvents(ownerHash, { limit = 30, offset = 0 } = {}) {
    const safeLimit = clamp(limit, 1, 100);
    const safeOffset = clamp(offset, 0, 1_000_000);
    const [[totalRow]] = await this.pool.execute(
      'SELECT COUNT(*) AS total FROM student_events WHERE recipient_hash = ?',
      [ownerHash],
    );
    const [rows] = await this.pool.execute(
      `SELECT e.*, c.name AS course_name
       FROM student_events e
       JOIN courses c ON c.id = e.course_id
       WHERE e.recipient_hash = ?
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ? OFFSET ?`,
      [ownerHash, safeLimit, safeOffset],
    );
    return {
      total: toSafeNumber(totalRow.total),
      items: rows.map((row) => ({
        id: row.id,
        box: 'comment',
        type: row.type,
        courseId: row.course_id,
        courseName: row.course_name || '',
        title: row.title,
        body: row.body || '',
        questionId: row.question_id || '',
        commentId: row.comment_id || '',
        createdAt: toIsoString(row.created_at),
        read: Boolean(row.read_at),
      })),
      hasMore: safeOffset + rows.length < toSafeNumber(totalRow.total),
    };
  }

  async markStudentEventRead(ownerHash, eventId) {
    const [result] = await this.pool.execute(
      `UPDATE student_events SET read_at = COALESCE(read_at, ?)
       WHERE id = ? AND recipient_hash = ?`,
      [new Date(), eventId, ownerHash],
    );
    return result.affectedRows > 0;
  }

  async markAllStudentEventsRead(ownerHash) {
    await this.pool.execute(
      `UPDATE student_events SET read_at = COALESCE(read_at, ?)
       WHERE recipient_hash = ? AND read_at IS NULL`,
      [new Date(), ownerHash],
    );
    return true;
  }

  async messageSummary(ownerHash) {
    const [[row]] = await this.pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM course_notices n
          WHERE NOT EXISTS (
            SELECT 1 FROM notice_reads r
            WHERE r.notice_id = n.id AND r.owner_hash = ?
          )) AS notice_count,
         (SELECT COUNT(*) FROM student_events e
          WHERE e.recipient_hash = ? AND e.read_at IS NULL) AS comment_count`,
      [ownerHash, ownerHash],
    );
    const notice = toSafeNumber(row.notice_count);
    const comment = toSafeNumber(row.comment_count);
    return { notice, comment, total: notice + comment };
  }

  _serializeResource(row) {
    return {
      id: row.id,
      courseId: row.course_id || 'c_default',
      courseName: row.course_name || '',
      title: row.title,
      category: row.category,
      description: row.description ?? '',
      fileName: row.file_name,
      extension: row.extension,
      mimeType: row.mime_type,
      sizeBytes: toSafeNumber(row.size_bytes),
      storageProvider: row.storage_provider,
      storageKey: row.storage_key,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
    };
  }

  async listResources({ category = '', includeDeleted = false, courseId = '' } = {}) {
    const clauses = [];
    const params = [];
    if (!includeDeleted) clauses.push('deleted_at IS NULL');
    if (category) {
      clauses.push('category = ?');
      params.push(category);
    }
    if (courseId) {
      clauses.push('course_id = ?');
      params.push(courseId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [rows] = await this.pool.execute(
      `SELECT r.id, r.course_id, (SELECT c.name FROM courses c WHERE c.id = r.course_id) AS course_name,
              r.title, r.category, r.description, r.file_name, r.extension, r.mime_type,
              r.size_bytes, r.storage_provider, r.storage_key, r.created_at, r.updated_at
       FROM resources r ${where.replace(/\b(deleted_at|category|course_id)\b/g, 'r.$1')}
       ORDER BY r.updated_at DESC, r.id DESC`,
      params,
    );
    return rows.map((row) => this._serializeResource(row));
  }

  async getResource(id) {
    const [rows] = await this.pool.execute(
      `SELECT r.id, r.course_id, (SELECT c.name FROM courses c WHERE c.id = r.course_id) AS course_name,
              r.title, r.category, r.description, r.file_name, r.extension, r.mime_type,
              r.size_bytes, r.storage_provider, r.storage_key, r.created_at, r.updated_at
       FROM resources r WHERE r.id = ? AND r.deleted_at IS NULL LIMIT 1`,
      [id],
    );
    return rows[0] ? this._serializeResource(rows[0]) : null;
  }

  async createResource({
    id,
    courseId = 'c_default',
    title,
    category,
    description = '',
    fileName,
    extension,
    mimeType,
    sizeBytes,
    storageProvider,
    storageKey,
    createdAt = new Date(),
  }) {
    await this.pool.execute(
      `INSERT INTO resources
        (id, course_id, title, category, description, file_name, extension, mime_type,
         size_bytes, storage_provider, storage_key, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        id,
        courseId,
        title,
        category,
        description || null,
        fileName,
        extension,
        mimeType,
        sizeBytes,
        storageProvider,
        storageKey,
        createdAt,
        createdAt,
      ],
    );
    return this.getResource(id);
  }

  async updateResource(id, resource) {
    const now = new Date();
    const [result] = await this.pool.execute(
      `UPDATE resources SET
         course_id = ?, title = ?, category = ?, description = ?, file_name = ?, extension = ?,
         mime_type = ?, size_bytes = ?, storage_provider = ?, storage_key = ?,
         updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        resource.courseId || 'c_default',
        resource.title,
        resource.category,
        resource.description || null,
        resource.fileName,
        resource.extension,
        resource.mimeType,
        resource.sizeBytes,
        resource.storageProvider,
        resource.storageKey,
        now,
        id,
      ],
    );
    if (!result.affectedRows) return null;
    return this.getResource(id);
  }

  async deleteResource(id) {
    const now = new Date();
    const [result] = await this.pool.execute(
      'UPDATE resources SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      [now, now, id],
    );
    return result.affectedRows > 0;
  }

  async exportSnapshot() {
    // InnoDB REPEATABLE READ 提供一致性快照，避免备份期间新增数据造成跨表不一致。
    const connection = await this.pool.getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
      const [teacherRows] = await connection.query(
        `SELECT id, email, password_hash, name, public_id, created_at, updated_at
         FROM teachers ORDER BY id ASC`,
      );
      const [studentRows] = await connection.query(
        `SELECT id, owner_hash, alias_code, created_at, last_seen_at
         FROM students ORDER BY id ASC`,
      );
      const [courseRows] = await connection.query(
        `SELECT id, name, teacher_name, course_code, term, color_index, sort_order,
                status, created_at, updated_at, deleted_at
         FROM courses ORDER BY sort_order ASC, created_at ASC`,
      );
      const [questionRows] = await connection.query(
        `SELECT id, student_id, course_id, question, answer, model, status,
                prompt_tokens, completion_tokens, latency_ms, created_at, deleted_at,
                image_key, image_mime, image_provider, image_token, image_size_bytes
         FROM questions ORDER BY created_at ASC, id ASC`,
      );
      const [likeRows] = await connection.query(
        `SELECT question_id, student_id, created_at
         FROM likes ORDER BY created_at ASC, question_id ASC, student_id ASC`,
      );
      const [resourceRows] = await connection.query(
        `SELECT id, course_id, title, category, description, file_name, extension, mime_type,
                size_bytes, storage_provider, storage_key, created_at, updated_at, deleted_at
         FROM resources ORDER BY created_at ASC, id ASC`,
      );
      const [commentRows] = await connection.query(
        `SELECT id, question_id, author_type, student_owner_hash, teacher_id,
                author_name, author_public_id, content, created_at, deleted_at
         FROM question_comments ORDER BY created_at ASC, id ASC`,
      );
      const [commentLikeRows] = await connection.query(
        `SELECT comment_id, actor_type, actor_hash, created_at
         FROM comment_likes ORDER BY created_at ASC, comment_id ASC, actor_hash ASC`,
      );
      const [noticeRows] = await connection.query(
        `SELECT id, course_id, type, title, body, resource_id, created_at
         FROM course_notices ORDER BY created_at ASC, id ASC`,
      );
      const [noticeReadRows] = await connection.query(
        `SELECT notice_id, owner_hash, read_at
         FROM notice_reads ORDER BY notice_id ASC, owner_hash ASC`,
      );
      const [eventRows] = await connection.query(
        `SELECT id, course_id, recipient_hash, actor_hash, type, title, body,
                question_id, comment_id, read_at, created_at
         FROM student_events ORDER BY created_at ASC, id ASC`,
      );
      await connection.commit();
      return {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        counts: {
          courses: courseRows.length,
          teachers: teacherRows.length,
          students: studentRows.length,
          questions: questionRows.length,
          likes: likeRows.length,
          comments: commentRows.length,
          commentLikes: commentLikeRows.length,
          resources: resourceRows.length,
          notices: noticeRows.length,
          events: eventRows.length,
        },
        courses: courseRows.map((row) => ({
          id: row.id,
          name: row.name,
          teacherName: row.teacher_name,
          courseCode: row.course_code,
          term: row.term || '',
          colorIndex: Number(row.color_index || 0),
          sortOrder: Number(row.sort_order || 0),
          status: row.status || 'active',
          createdAt: toIsoString(row.created_at),
          updatedAt: toIsoString(row.updated_at),
          deletedAt: toIsoString(row.deleted_at),
        })),
        teachers: teacherRows.map((row) => ({
          id: Number(row.id),
          email: row.email,
          passwordHash: row.password_hash,
          name: row.name,
          publicId: row.public_id,
          createdAt: toIsoString(row.created_at),
          updatedAt: toIsoString(row.updated_at),
        })),
        students: studentRows.map((row) => ({
          id: Number(row.id),
          ownerHash: row.owner_hash,
          aliasCode: row.alias_code,
          createdAt: toIsoString(row.created_at),
          lastSeenAt: toIsoString(row.last_seen_at),
        })),
        questions: questionRows.map((row) => ({
          id: row.id,
          studentId: Number(row.student_id),
          courseId: row.course_id || 'c_default',
          question: row.question,
          answer: row.answer ?? '',
          model: row.model,
          status: row.status,
          promptTokens: row.prompt_tokens === null ? null : Number(row.prompt_tokens),
          completionTokens:
            row.completion_tokens === null ? null : Number(row.completion_tokens),
          latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
          createdAt: toIsoString(row.created_at),
          deletedAt: toIsoString(row.deleted_at),
          imageKey: row.image_key || '',
          imageMimeType: row.image_mime || '',
          imageProvider: row.image_provider || '',
          imageToken: row.image_token || '',
          imageSizeBytes: row.image_size_bytes === null ? 0 : Number(row.image_size_bytes),
        })),
        likes: likeRows.map((row) => ({
          questionId: row.question_id,
          studentId: Number(row.student_id),
          createdAt: toIsoString(row.created_at),
        })),
        comments: commentRows.map((row) => ({
          id: row.id,
          questionId: row.question_id,
          authorType: row.author_type,
          studentOwnerHash: row.student_owner_hash || '',
          teacherId: row.teacher_id === null ? null : Number(row.teacher_id),
          authorName: row.author_name,
          authorPublicId: row.author_public_id || '',
          content: row.content,
          createdAt: toIsoString(row.created_at),
          deletedAt: toIsoString(row.deleted_at),
        })),
        commentLikes: commentLikeRows.map((row) => ({
          commentId: row.comment_id,
          actorType: row.actor_type,
          actorHash: row.actor_hash,
          createdAt: toIsoString(row.created_at),
        })),
        resources: resourceRows.map((row) => ({
          id: row.id,
          courseId: row.course_id || 'c_default',
          title: row.title,
          category: row.category,
          description: row.description ?? '',
          fileName: row.file_name,
          extension: row.extension,
          mimeType: row.mime_type,
          sizeBytes: Number(row.size_bytes),
          storageProvider: row.storage_provider,
          storageKey: row.storage_key,
          createdAt: toIsoString(row.created_at),
          updatedAt: toIsoString(row.updated_at),
          deletedAt: toIsoString(row.deleted_at),
        })),
        courseNotices: noticeRows.map((row) => ({
          id: row.id,
          courseId: row.course_id,
          type: row.type,
          title: row.title,
          body: row.body || '',
          resourceId: row.resource_id || '',
          createdAt: toIsoString(row.created_at),
        })),
        noticeReads: noticeReadRows.map((row) => ({
          noticeId: row.notice_id,
          ownerHash: row.owner_hash,
          readAt: toIsoString(row.read_at),
        })),
        studentEvents: eventRows.map((row) => ({
          id: row.id,
          courseId: row.course_id,
          recipientHash: row.recipient_hash,
          actorHash: row.actor_hash || '',
          type: row.type,
          title: row.title,
          body: row.body || '',
          questionId: row.question_id || '',
          commentId: row.comment_id || '',
          readAt: toIsoString(row.read_at),
          createdAt: toIsoString(row.created_at),
        })),
      };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async importSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.students) || !Array.isArray(snapshot.questions) || !Array.isArray(snapshot.likes)) {
      throw new Error('备份文件结构不正确');
    }
    if (snapshot.schemaVersion !== undefined && snapshot.schemaVersion !== null) {
      const version = Number(snapshot.schemaVersion);
      if (!Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) {
        throw new Error(
          `备份 schemaVersion=${snapshot.schemaVersion} 与当前程序 schemaVersion=${SCHEMA_VERSION} 不兼容`,
        );
      }
    }
    const courses = Array.isArray(snapshot.courses) ? snapshot.courses : [];
    const resources = Array.isArray(snapshot.resources) ? snapshot.resources : [];
    const teachers = Array.isArray(snapshot.teachers) ? snapshot.teachers : [];
    const comments = Array.isArray(snapshot.comments) ? snapshot.comments : [];
    const commentLikes = Array.isArray(snapshot.commentLikes) ? snapshot.commentLikes : [];
    const courseNotices = Array.isArray(snapshot.courseNotices) ? snapshot.courseNotices : [];
    const noticeReads = Array.isArray(snapshot.noticeReads) ? snapshot.noticeReads : [];
    const studentEvents = Array.isArray(snapshot.studentEvents) ? snapshot.studentEvents : [];
    const [[counts]] = await this.pool.query(
      `SELECT
         (SELECT COUNT(*) FROM teachers) AS teachers,
         (SELECT COUNT(*) FROM students) AS students,
         (SELECT COUNT(*) FROM questions) AS questions,
         (SELECT COUNT(*) FROM likes) AS likes,
         (SELECT COUNT(*) FROM question_comments) AS comments,
         (SELECT COUNT(*) FROM comment_likes) AS comment_likes,
         (SELECT COUNT(*) FROM resources) AS resources`,
    );
    if (
      toSafeNumber(counts.teachers) > 0 ||
      toSafeNumber(counts.students) > 0 ||
      toSafeNumber(counts.questions) > 0 ||
      toSafeNumber(counts.likes) > 0 ||
      toSafeNumber(counts.comments) > 0 ||
      toSafeNumber(counts.comment_likes) > 0 ||
      toSafeNumber(counts.resources) > 0
    ) {
      throw new Error('目标数据库不是空库。为避免覆盖线上数据，恢复操作只允许导入到空数据库。');
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      if (courses.length) {
        await connection.query("DELETE FROM courses WHERE id = 'c_default'");
        await insertRows(
          connection,
          'courses',
          [
            'id',
            'name',
            'teacher_name',
            'course_code',
            'term',
            'color_index',
            'sort_order',
            'status',
            'created_at',
            'updated_at',
            'deleted_at',
          ],
          courses.map((course) => ({
            id: course.id,
            name: course.name,
            teacher_name: course.teacherName,
            course_code: course.courseCode,
            term: course.term || null,
            color_index: Number(course.colorIndex || 0),
            sort_order: Number(course.sortOrder || 0),
            status: course.status || 'active',
            created_at: toDate(course.createdAt, 'courses.createdAt'),
            updated_at: toDate(course.updatedAt || course.createdAt, 'courses.updatedAt'),
            deleted_at: course.deletedAt ? toDate(course.deletedAt, 'courses.deletedAt') : null,
          })),
        );
      }
      await insertRows(
        connection,
        'teachers',
        ['id', 'email', 'password_hash', 'name', 'public_id', 'created_at', 'updated_at'],
        teachers.map((teacher) => ({
          id: Number(teacher.id),
          email: teacher.email,
          password_hash: teacher.passwordHash,
          name: teacher.name,
          public_id: teacher.publicId,
          created_at: toDate(teacher.createdAt, 'teachers.createdAt'),
          updated_at: toDate(teacher.updatedAt || teacher.createdAt, 'teachers.updatedAt'),
        })),
      );
      await insertRows(
        connection,
        'students',
        ['id', 'owner_hash', 'alias_code', 'created_at', 'last_seen_at'],
        snapshot.students.map((student) => ({
          id: Number(student.id),
          owner_hash: student.ownerHash,
          alias_code: student.aliasCode || aliasCodeFor(student.ownerHash),
          created_at: toDate(student.createdAt, 'students.createdAt'),
          last_seen_at: toDate(student.lastSeenAt || student.createdAt, 'students.lastSeenAt'),
        })),
      );
      await insertRows(
        connection,
        'questions',
        [
          'id',
          'student_id',
          'course_id',
          'question',
          'answer',
          'model',
          'status',
          'prompt_tokens',
          'completion_tokens',
          'latency_ms',
          'created_at',
          'deleted_at',
          'image_key',
          'image_mime',
          'image_provider',
          'image_token',
          'image_size_bytes',
        ],
        snapshot.questions.map((question) => ({
          id: question.id,
          student_id: Number(question.studentId),
          course_id: question.courseId || 'c_default',
          question: question.question,
          answer: question.answer ?? '',
          model: question.model ? String(question.model).slice(0, 80) : null,
          status: question.status || 'answered',
          prompt_tokens: nullableInt(question.promptTokens),
          completion_tokens: nullableInt(question.completionTokens),
          latency_ms: nullableInt(question.latencyMs),
          created_at: toDate(question.createdAt, 'questions.createdAt'),
          deleted_at: question.deletedAt
            ? toDate(question.deletedAt, 'questions.deletedAt')
            : null,
          image_key: question.imageKey || null,
          image_mime: question.imageMimeType || null,
          image_provider: question.imageProvider || null,
          image_token: question.imageToken || null,
          image_size_bytes: question.imageSizeBytes ?? null,
        })),
      );
      await insertRows(
        connection,
        'likes',
        ['question_id', 'student_id', 'created_at'],
        snapshot.likes.map((like) => ({
          question_id: like.questionId,
          student_id: Number(like.studentId),
          created_at: toDate(like.createdAt, 'likes.createdAt'),
        })),
      );
      await insertRows(
        connection,
        'question_comments',
        [
          'id',
          'question_id',
          'author_type',
          'student_owner_hash',
          'teacher_id',
          'author_name',
          'author_public_id',
          'content',
          'created_at',
          'deleted_at',
        ],
        comments.map((comment) => ({
          id: comment.id,
          question_id: comment.questionId,
          author_type: comment.authorType,
          student_owner_hash: comment.studentOwnerHash || null,
          teacher_id: comment.teacherId ? Number(comment.teacherId) : null,
          author_name: comment.authorName,
          author_public_id: comment.authorPublicId || null,
          content: comment.content,
          created_at: toDate(comment.createdAt, 'comments.createdAt'),
          deleted_at: comment.deletedAt
            ? toDate(comment.deletedAt, 'comments.deletedAt')
            : null,
        })),
      );
      await insertRows(
        connection,
        'comment_likes',
        ['comment_id', 'actor_type', 'actor_hash', 'created_at'],
        commentLikes.map((like) => ({
          comment_id: like.commentId,
          actor_type: like.actorType,
          actor_hash: like.actorHash,
          created_at: toDate(like.createdAt, 'commentLikes.createdAt'),
        })),
      );
      await insertRows(
        connection,
        'resources',
        [
          'id',
          'course_id',
          'title',
          'category',
          'description',
          'file_name',
          'extension',
          'mime_type',
          'size_bytes',
          'storage_provider',
          'storage_key',
          'created_at',
          'updated_at',
          'deleted_at',
        ],
        resources.map((resource) => ({
          id: resource.id,
          course_id: resource.courseId || 'c_default',
          title: resource.title,
          category: resource.category,
          description: resource.description || null,
          file_name: resource.fileName,
          extension: resource.extension,
          mime_type: resource.mimeType,
          size_bytes: Number(resource.sizeBytes || 0),
          storage_provider: resource.storageProvider,
          storage_key: resource.storageKey,
          created_at: toDate(resource.createdAt, 'resources.createdAt'),
          updated_at: toDate(
            resource.updatedAt || resource.createdAt,
            'resources.updatedAt',
          ),
          deleted_at: resource.deletedAt
            ? toDate(resource.deletedAt, 'resources.deletedAt')
            : null,
        })),
      );
      await insertRows(
        connection,
        'course_notices',
        ['id', 'course_id', 'type', 'title', 'body', 'resource_id', 'created_at'],
        courseNotices.map((notice) => ({
          id: notice.id,
          course_id: notice.courseId,
          type: notice.type,
          title: notice.title,
          body: notice.body || null,
          resource_id: notice.resourceId || null,
          created_at: toDate(notice.createdAt, 'courseNotices.createdAt'),
        })),
      );
      await insertRows(
        connection,
        'notice_reads',
        ['notice_id', 'owner_hash', 'read_at'],
        noticeReads.map((read) => ({
          notice_id: read.noticeId,
          owner_hash: read.ownerHash,
          read_at: toDate(read.readAt, 'noticeReads.readAt'),
        })),
      );
      await insertRows(
        connection,
        'student_events',
        [
          'id',
          'course_id',
          'recipient_hash',
          'actor_hash',
          'type',
          'title',
          'body',
          'question_id',
          'comment_id',
          'read_at',
          'created_at',
        ],
        studentEvents.map((event) => ({
          id: event.id,
          course_id: event.courseId,
          recipient_hash: event.recipientHash,
          actor_hash: event.actorHash || null,
          type: event.type,
          title: event.title,
          body: event.body || null,
          question_id: event.questionId || null,
          comment_id: event.commentId || null,
          read_at: event.readAt ? toDate(event.readAt, 'studentEvents.readAt') : null,
          created_at: toDate(event.createdAt, 'studentEvents.createdAt'),
        })),
      );
      await connection.commit();
      return {
        courses: courses.length,
        teachers: teachers.length,
        students: snapshot.students.length,
        questions: snapshot.questions.length,
        likes: snapshot.likes.length,
        comments: comments.length,
        commentLikes: commentLikes.length,
        resources: resources.length,
        notices: courseNotices.length,
        events: studentEvents.length,
      };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async recordBackupRun({
    provider,
    status,
    reason,
    objectKey = null,
    localPath = null,
    sizeBytes = null,
    errorMessage = null,
    createdAt = new Date(),
  }) {
    await this.pool.execute(
      `INSERT INTO backup_runs
        (provider, status, reason, object_key, local_path, size_bytes, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        provider,
        status,
        reason,
        objectKey,
        localPath,
        sizeBytes === null ? null : Math.max(0, Math.trunc(sizeBytes)),
        errorMessage ? String(errorMessage).slice(0, 500) : null,
        createdAt,
      ],
    );
  }

  async getLatestBackupRun() {
    const [rows] = await this.pool.query(
      `SELECT id, provider, status, reason, object_key, local_path,
              size_bytes, error_message, created_at
       FROM backup_runs ORDER BY id DESC LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      provider: row.provider,
      status: row.status,
      reason: row.reason,
      objectKey: row.object_key,
      localPath: row.local_path,
      sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
      errorMessage: row.error_message,
      createdAt: toIsoString(row.created_at),
    };
  }
}
