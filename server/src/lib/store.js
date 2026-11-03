import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { aliasFor, hashClientId } from './identity.js';
import { startOfBusinessDay } from './time.js';

function createEmptyData() {
  return {
    version: 1,
    questions: [],
    likes: [],
    resources: [],
    teachers: [],
    teacherSessions: [],
    comments: [],
    commentLikes: [],
    studentChannels: [],
    pushNotifications: [],
  };
}

function sortByCreatedAtAsc(a, b) {
  return String(a.createdAt).localeCompare(String(b.createdAt));
}

function sortByCreatedAtDesc(a, b) {
  return String(b.createdAt).localeCompare(String(a.createdAt));
}

function clamp(value, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * 轻量 JSON 持久化。适合课堂/小规模部署，单进程写入通过串行队列保证一致性。
 * 学生身份只存 SHA-256 加盐哈希，不保存微信昵称、OpenID 等信息。
 */
export class QuestionStore {
  constructor({
    dataDir,
    hashSalt,
    logger = console,
    businessTimezoneOffsetMinutes = 480,
  }) {
    if (!dataDir) throw new Error('QuestionStore requires dataDir');
    if (!hashSalt) throw new Error('QuestionStore requires hashSalt');
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'questions.json');
    this.tempPath = `${this.filePath}.tmp`;
    this.hashSalt = hashSalt;
    this.businessTimezoneOffsetMinutes = businessTimezoneOffsetMinutes;
    this.logger = logger;
    this.data = createEmptyData();
    this.saveQueue = Promise.resolve();
    this.ready = false;
    this.backendType = 'json';
  }

  get description() {
    return `JSON ${this.filePath}`;
  }

  async close() {
    if (this.saveQueue) await this.saveQueue.catch(() => {});
  }

  async ping() {
    return true;
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.questions) || !Array.isArray(parsed.likes)) {
        throw new Error('questions.json 结构不正确：questions/likes 必须为数组');
      }
      this.data = {
        version: 1,
        questions: parsed.questions.filter((q) => q && q.id && q.ownerHash),
        likes: parsed.likes.filter((l) => l && l.questionId && l.ownerHash),
        resources: Array.isArray(parsed.resources)
          ? parsed.resources.filter((resource) => resource && resource.id)
          : [],
        teachers: Array.isArray(parsed.teachers) ? parsed.teachers : [],
        teacherSessions: Array.isArray(parsed.teacherSessions)
          ? parsed.teacherSessions
          : [],
        comments: Array.isArray(parsed.comments) ? parsed.comments : [],
        commentLikes: Array.isArray(parsed.commentLikes) ? parsed.commentLikes : [],
        studentChannels: Array.isArray(parsed.studentChannels)
          ? parsed.studentChannels
          : [],
        pushNotifications: Array.isArray(parsed.pushNotifications)
          ? parsed.pushNotifications
          : [],
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.data = createEmptyData();
        await this.save();
      } else {
        const backupPath = `${this.filePath}.corrupt-${Date.now()}`;
        try {
          await fs.copyFile(this.filePath, backupPath);
          this.logger.error(`[store] questions.json 读取失败，已备份到 ${backupPath}`);
        } catch {
          // 备份失败时保留原始错误，不覆盖数据文件。
        }
        throw error;
      }
    }
    this.ready = true;
    return this;
  }

  hashClient(clientId) {
    return hashClientId(this.hashSalt, clientId);
  }

  aliasFor(ownerHash) {
    return aliasFor(ownerHash);
  }

  async save() {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.saveQueue = this.saveQueue
      .catch(() => {
        // 上一次写入失败不应永久阻塞后续写入。
      })
      .then(async () => {
        await fs.mkdir(this.dataDir, { recursive: true });
        await fs.writeFile(this.tempPath, snapshot, 'utf8');
        await fs.rename(this.tempPath, this.filePath);
      });
    return this.saveQueue;
  }

  _likeCountMap() {
    const counts = new Map();
    for (const like of this.data.likes) {
      counts.set(like.questionId, (counts.get(like.questionId) ?? 0) + 1);
    }
    return counts;
  }

  _isLiked(questionId, ownerHash) {
    if (!ownerHash) return false;
    return this.data.likes.some(
      (like) => like.questionId === questionId && like.ownerHash === ownerHash,
    );
  }

  _studentLabels() {
    const labels = new Map();
    const ordered = [...this.data.questions].sort(sortByCreatedAtAsc);
    for (const question of ordered) {
      if (!labels.has(question.ownerHash)) {
        labels.set(question.ownerHash, `学生 ${String(labels.size + 1).padStart(2, '0')}`);
      }
    }
    return labels;
  }

  _publicQuestion(question, { viewerHash = '', likeCounts = null, withAlias = false } = {}) {
    const counts = likeCounts ?? this._likeCountMap();
    const comments = this.data.comments.filter(
      (comment) => comment.questionId === question.id,
    );
    const result = {
      id: question.id,
      question: question.question,
      answer: question.answer,
      createdAt: question.createdAt,
      status: 'answered',
      likeCount: counts.get(question.id) ?? 0,
      likedByMe: this._isLiked(question.id, viewerHash),
      commentCount: comments.length,
      teacherCommentCount: comments.filter((comment) => comment.authorType === 'teacher').length,
      imagePath: question.imageToken ? `/api/images/${question.imageToken}` : '',
      imageMimeType: question.imageMimeType || '',
      imageSizeBytes: question.imageSizeBytes || 0,
    };
    if (withAlias) result.alias = this.aliasFor(question.ownerHash);
    return result;
  }

  _findQuestion(id) {
    return this.data.questions.find((question) => question.id === id);
  }

  async addQuestion({
    ownerHash,
    question,
    answer,
    model,
    usage = null,
    latencyMs = 0,
    image = null,
  }) {
    const now = new Date().toISOString();
    const record = {
      id: `q_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`,
      ownerHash,
      question,
      answer,
      createdAt: now,
      model: model || '',
      usage: usage || null,
      latencyMs: Number.isFinite(latencyMs) ? latencyMs : 0,
      imageToken: image?.token || '',
      imageMimeType: image?.mimeType || '',
      imageProvider: image?.storageProvider || '',
      imageKey: image?.storageKey || '',
      imageSizeBytes: image?.sizeBytes || 0,
    };
    this.data.questions.push(record);
    await this.save();
    return this._publicQuestion(record, { viewerHash: ownerHash });
  }

  listForClient(ownerHash, { limit = 50, offset = 0 } = {}) {
    const safeLimit = clamp(limit, 1, 100);
    const safeOffset = clamp(offset, 0, 1_000_000);
    const all = this.data.questions
      .filter((question) => question.ownerHash === ownerHash)
      .sort(sortByCreatedAtDesc);
    const likeCounts = this._likeCountMap();
    return {
      total: all.length,
      items: all
        .slice(safeOffset, safeOffset + safeLimit)
        .map((question) => this._publicQuestion(question, { viewerHash: ownerHash, likeCounts })),
    };
  }

  getQuestion(id, viewerHash) {
    const question = this._findQuestion(id);
    if (!question) return null;
    return this._publicQuestion(question, { viewerHash });
  }

  getQuestionByImageToken(token) {
    const question = this.data.questions.find(
      (item) => item.imageToken === token && !item.deletedAt,
    );
    if (!question) return null;
    return {
      imageProvider: question.imageProvider || '',
      imageKey: question.imageKey || '',
      imageMimeType: question.imageMimeType || '',
      imageSizeBytes: question.imageSizeBytes || 0,
      imageToken: question.imageToken || '',
    };
  }

  getCommunity(viewerHash, { limit = 30, offset = 0 } = {}) {
    const safeLimit = clamp(limit, 1, 100);
    const safeOffset = clamp(offset, 0, 1_000_000);
    const likeCounts = this._likeCountMap();
    const all = this.data.questions
      .map((question) => ({
        question,
        likeCount: likeCounts.get(question.id) ?? 0,
        likedByMe: this._isLiked(question.id, viewerHash),
      }))
      .sort((a, b) => {
        if (b.likeCount !== a.likeCount) return b.likeCount - a.likeCount;
        return sortByCreatedAtAsc(a.question, b.question);
      });

    const top = all.slice(0, 3);
    const topIds = new Set(top.map((item) => item.question.id));
    const recentAll = all
      .filter((item) => !topIds.has(item.question.id))
      .sort((a, b) => sortByCreatedAtDesc(a.question, b.question));
    const recent = recentAll.slice(safeOffset, safeOffset + safeLimit);

    const serialize = (item) => this._publicQuestion(item.question, {
      viewerHash,
      likeCounts,
      withAlias: true,
    });

    return {
      top: top.map(serialize),
      recent: recent.map(serialize),
      stats: this.stats(),
      recentTotal: recentAll.length,
      hasMore: safeOffset + recent.length < recentAll.length,
    };
  }

  async toggleLike(questionId, viewerHash) {
    const question = this._findQuestion(questionId);
    if (!question) return null;
    const index = this.data.likes.findIndex(
      (like) => like.questionId === questionId && like.ownerHash === viewerHash,
    );
    let liked;
    if (index >= 0) {
      this.data.likes.splice(index, 1);
      liked = false;
    } else {
      this.data.likes.push({
        questionId,
        ownerHash: viewerHash,
        createdAt: new Date().toISOString(),
      });
      liked = true;
    }
    await this.save();
    return {
      id: questionId,
      liked,
      likeCount: this.data.likes.filter((like) => like.questionId === questionId).length,
    };
  }

  countTeachers() {
    return this.data.teachers.length;
  }

  async createTeacher({ email, passwordHash, name, publicId }) {
    const normalizedEmail = String(email).toLowerCase();
    if (
      this.data.teachers.some(
        (teacher) =>
          teacher.email === normalizedEmail ||
          String(teacher.publicId).toLowerCase() === String(publicId).toLowerCase(),
      )
    ) {
      const error = new Error('邮箱或对外展示 ID 已被使用。');
      error.code = 'TEACHER_ACCOUNT_EXISTS';
      throw error;
    }
    const now = new Date().toISOString();
    const id =
      this.data.teachers.reduce((max, teacher) => Math.max(max, Number(teacher.id) || 0), 0) + 1;
    const teacher = {
      id,
      email: normalizedEmail,
      passwordHash,
      name,
      publicId,
      createdAt: now,
      updatedAt: now,
    };
    this.data.teachers.push(teacher);
    await this.save();
    return { ...teacher };
  }

  getTeacherByEmail(email) {
    const normalizedEmail = String(email).toLowerCase();
    const teacher = this.data.teachers.find((item) => item.email === normalizedEmail);
    return teacher ? { ...teacher } : null;
  }

  getTeacherById(id) {
    const teacher = this.data.teachers.find((item) => Number(item.id) === Number(id));
    return teacher ? { ...teacher } : null;
  }

  getTeacherAuthById(id) {
    return this.getTeacherById(id);
  }

  async updateTeacher(id, { email, name, publicId }) {
    const teacher = this.data.teachers.find((item) => Number(item.id) === Number(id));
    if (!teacher) return null;
    const normalizedEmail = String(email).toLowerCase();
    const conflict = this.data.teachers.some(
      (item) =>
        Number(item.id) !== Number(id) &&
        (item.email === normalizedEmail ||
          String(item.publicId).toLowerCase() === String(publicId).toLowerCase()),
    );
    if (conflict) {
      const error = new Error('邮箱或对外展示 ID 已被使用。');
      error.code = 'TEACHER_ACCOUNT_EXISTS';
      throw error;
    }
    Object.assign(teacher, {
      email: normalizedEmail,
      name,
      publicId,
      updatedAt: new Date().toISOString(),
    });
    await this.save();
    return { ...teacher };
  }

  async updateTeacherPassword(id, passwordHash) {
    const teacher = this.data.teachers.find((item) => Number(item.id) === Number(id));
    if (!teacher) return false;
    teacher.passwordHash = passwordHash;
    teacher.updatedAt = new Date().toISOString();
    await this.save();
    return true;
  }

  async createTeacherSession({ teacherId, tokenHash, expiresAt }) {
    this.data.teacherSessions.push({
      teacherId: Number(teacherId),
      tokenHash,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      lastUsedAt: new Date().toISOString(),
    });
    await this.save();
  }

  getTeacherBySession(tokenHash) {
    const session = this.data.teacherSessions.find(
      (item) =>
        item.tokenHash === tokenHash &&
        new Date(item.expiresAt).getTime() > Date.now(),
    );
    if (!session) return null;
    const teacher = this.data.teachers.find(
      (item) => Number(item.id) === Number(session.teacherId),
    );
    if (!teacher) return null;
    session.lastUsedAt = new Date().toISOString();
    return { ...teacher };
  }

  async deleteTeacherSession(tokenHash) {
    this.data.teacherSessions = this.data.teacherSessions.filter(
      (item) => item.tokenHash !== tokenHash,
    );
    await this.save();
  }

  async deleteTeacherSessions(teacherId) {
    this.data.teacherSessions = this.data.teacherSessions.filter(
      (item) => Number(item.teacherId) !== Number(teacherId),
    );
    await this.save();
  }

  async bindStudentMiniOpenid(ownerHash, miniOpenid) {
    this.data.studentChannels = this.data.studentChannels.filter(
      (item) => item.miniOpenid !== miniOpenid && item.ownerHash !== ownerHash,
    );
    this.data.studentChannels.push({
      ownerHash,
      miniOpenid,
      updatedAt: new Date().toISOString(),
    });
    await this.save();
    return true;
  }

  getStudentMiniOpenid(ownerHash) {
    return (
      this.data.studentChannels.find((item) => item.ownerHash === ownerHash)?.miniOpenid || ''
    );
  }

  getQuestionOwnerHash(questionId) {
    return this._findQuestion(questionId)?.ownerHash || '';
  }

  _commentLikeCount(commentId) {
    return this.data.commentLikes.filter((like) => like.commentId === commentId).length;
  }

  _serializeComment(comment, { actorType = '', actorHash = '' } = {}) {
    return {
      id: comment.id,
      questionId: comment.questionId,
      authorType: comment.authorType,
      authorName: comment.authorName,
      authorPublicId: comment.authorPublicId || '',
      content: comment.content,
      createdAt: comment.createdAt,
      likeCount: this._commentLikeCount(comment.id),
      likedByMe: Boolean(
        actorHash &&
          this.data.commentLikes.some(
            (like) =>
              like.commentId === comment.id &&
              like.actorType === actorType &&
              like.actorHash === actorHash,
          ),
      ),
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
    const comment = {
      id,
      questionId,
      authorType,
      studentOwnerHash,
      teacherId,
      authorName,
      authorPublicId,
      content,
      createdAt: new Date().toISOString(),
    };
    this.data.comments.push(comment);
    await this.save();
    return this._serializeComment(comment);
  }

  getQuestionComments(questionId, { viewerType = 'student', actorHash = '' } = {}) {
    return this.data.comments
      .filter((comment) => comment.questionId === questionId)
      .sort((a, b) => {
        if (a.authorType !== b.authorType) return a.authorType === 'teacher' ? -1 : 1;
        return String(a.createdAt).localeCompare(String(b.createdAt));
      })
      .map((comment) => this._serializeComment(comment, { actorType: viewerType, actorHash }));
  }

  getTeacherCommentsForQuestions(questionIds, { viewerType = 'student', actorHash = '' } = {}) {
    const ids = new Set(questionIds);
    const map = new Map();
    for (const comment of this.data.comments) {
      if (!ids.has(comment.questionId) || comment.authorType !== 'teacher') continue;
      if (!map.has(comment.questionId)) map.set(comment.questionId, []);
      map
        .get(comment.questionId)
        .push(this._serializeComment(comment, { actorType: viewerType, actorHash }));
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    }
    return map;
  }

  async toggleCommentLike(commentId, { actorType, actorHash }) {
    const comment = this.data.comments.find((item) => item.id === commentId);
    if (!comment) return null;
    const index = this.data.commentLikes.findIndex(
      (like) =>
        like.commentId === commentId &&
        like.actorType === actorType &&
        like.actorHash === actorHash,
    );
    let liked;
    if (index >= 0) {
      this.data.commentLikes.splice(index, 1);
      liked = false;
    } else {
      this.data.commentLikes.push({
        commentId,
        actorType,
        actorHash,
        createdAt: new Date().toISOString(),
      });
      liked = true;
    }
    await this.save();
    return {
      id: commentId,
      liked,
      likeCount: this._commentLikeCount(commentId),
    };
  }

  async recordPushNotification({
    commentId,
    studentOwnerHash,
    channel = 'wechat_service',
    status,
    errorMessage = '',
    sentAt = null,
  }) {
    const existing = this.data.pushNotifications.find(
      (item) =>
        item.commentId === commentId &&
        item.studentOwnerHash === studentOwnerHash &&
        item.channel === channel,
    );
    const record = {
      commentId,
      studentOwnerHash,
      channel,
      status,
      errorMessage: errorMessage || '',
      createdAt: existing?.createdAt || new Date().toISOString(),
      sentAt: sentAt ? new Date(sentAt).toISOString() : null,
    };
    if (existing) Object.assign(existing, record);
    else this.data.pushNotifications.push(record);
    await this.save();
  }

  listResources({ category = '', includeDeleted = false } = {}) {
    return this.data.resources
      .filter((resource) => {
        if (!includeDeleted && resource.deletedAt) return false;
        return !category || resource.category === category;
      })
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((resource) => ({ ...resource }));
  }

  getResource(id) {
    const resource = this.data.resources.find(
      (item) => item.id === id && !item.deletedAt,
    );
    return resource ? { ...resource } : null;
  }

  async createResource(resource) {
    const now = new Date().toISOString();
    const record = {
      ...resource,
      description: resource.description || '',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.data.resources.push(record);
    await this.save();
    return { ...record };
  }

  async updateResource(id, updates) {
    const resource = this.data.resources.find(
      (item) => item.id === id && !item.deletedAt,
    );
    if (!resource) return null;
    Object.assign(resource, updates, {
      description: updates.description || '',
      updatedAt: new Date().toISOString(),
    });
    await this.save();
    return { ...resource };
  }

  async deleteResource(id) {
    const resource = this.data.resources.find(
      (item) => item.id === id && !item.deletedAt,
    );
    if (!resource) return false;
    resource.deletedAt = new Date().toISOString();
    resource.updatedAt = resource.deletedAt;
    await this.save();
    return true;
  }

  stats() {
    const uniqueStudents = new Set(this.data.questions.map((question) => question.ownerHash));
    const startOfToday = startOfBusinessDay(
      new Date(),
      this.businessTimezoneOffsetMinutes,
    );
    const todayQuestions = this.data.questions.filter(
      (question) => new Date(question.createdAt).getTime() >= startOfToday.getTime(),
    ).length;
    return {
      totalQuestions: this.data.questions.length,
      totalStudents: uniqueStudents.size,
      totalLikes: this.data.likes.length,
      todayQuestions,
      answeredQuestions: this.data.questions.filter((question) => Boolean(question.answer)).length,
    };
  }

  getAdminQuestions() {
    const likeCounts = this._likeCountMap();
    const labels = this._studentLabels();
    return this.data.questions
      .slice()
      .sort(sortByCreatedAtDesc)
      .map((question) => ({
        id: question.id,
        studentLabel: labels.get(question.ownerHash) ?? '学生 --',
        question: question.question,
        answer: question.answer,
        createdAt: question.createdAt,
        likeCount: likeCounts.get(question.id) ?? 0,
        commentCount: this.data.comments.filter((comment) => comment.questionId === question.id)
          .length,
        teacherCommentCount: this.data.comments.filter(
          (comment) =>
            comment.questionId === question.id && comment.authorType === 'teacher',
        ).length,
        imagePath: question.imageToken ? `/api/images/${question.imageToken}` : '',
        imageMimeType: question.imageMimeType || '',
        imageSizeBytes: question.imageSizeBytes || 0,
        status: question.answer ? 'answered' : 'pending',
        model: question.model,
        latencyMs: question.latencyMs,
      }));
  }

  getQuestionsForExport(ids = []) {
    const idSet = new Set(ids.filter(Boolean));
    const selected = idSet.size
      ? this.data.questions.filter((question) => idSet.has(question.id))
      : this.data.questions.slice();
    const likeCounts = this._likeCountMap();
    const labels = this._studentLabels();
    return selected
      .sort(sortByCreatedAtAsc)
      .map((question) => ({
        ...this._publicQuestion(question, { likeCounts }),
        studentLabel: labels.get(question.ownerHash) ?? '学生 --',
        model: question.model,
      }));
  }
}
