import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import COS from 'cos-nodejs-sdk-v5';
import cron from 'node-cron';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const BACKUP_FORMAT = 'math-analysis-tutor-backup';
export const BACKUP_FORMAT_VERSION = 1;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function businessDateParts(date, offsetMinutes) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: pad2(shifted.getUTCMonth() + 1),
    day: pad2(shifted.getUTCDate()),
    hours: pad2(shifted.getUTCHours()),
    minutes: pad2(shifted.getUTCMinutes()),
    seconds: pad2(shifted.getUTCSeconds()),
    milliseconds: String(shifted.getUTCMilliseconds()).padStart(3, '0'),
  };
}

function backupStamp(date, offsetMinutes) {
  const parts = businessDateParts(date, offsetMinutes);
  return {
    datePath: `${parts.year}/${parts.month}/${parts.day}`,
    // 毫秒后缀避免同一秒内手动备份和定时备份生成相同对象 Key。
    fileStamp: `${parts.year}${parts.month}${parts.day}-${parts.hours}${parts.minutes}${parts.seconds}${parts.milliseconds}`,
  };
}

function backupError(code, message, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function normalizeBackupPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('备份内容不是有效的 JSON 对象');
  }
  const source = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  if (!source || !Array.isArray(source.students) || !Array.isArray(source.questions)) {
    throw new Error('备份文件缺少 students/questions 数组');
  }
  return {
    ...source,
    format: payload.format || source.format,
    formatVersion: payload.formatVersion || source.formatVersion,
    schemaVersion: payload.schemaVersion ?? source.schemaVersion,
    createdAt: payload.createdAt || source.createdAt,
    counts: payload.counts || source.counts,
    likes: Array.isArray(source.likes) ? source.likes : [],
    courses: Array.isArray(source.courses) ? source.courses : [],
    teachers: Array.isArray(source.teachers) ? source.teachers : [],
    comments: Array.isArray(source.comments) ? source.comments : [],
    commentLikes: Array.isArray(source.commentLikes) ? source.commentLikes : [],
    resources: Array.isArray(source.resources) ? source.resources : [],
    courseNotices: Array.isArray(source.courseNotices) ? source.courseNotices : [],
    noticeReads: Array.isArray(source.noticeReads) ? source.noticeReads : [],
    studentEvents: Array.isArray(source.studentEvents) ? source.studentEvents : [],
  };
}

export async function readBackupFile(filePath) {
  const raw = await fs.readFile(filePath);
  let text;
  if (String(filePath).toLowerCase().endsWith('.gz')) {
    text = (await gunzipAsync(raw)).toString('utf8');
  } else {
    text = raw.toString('utf8');
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`备份文件 JSON 解析失败：${error.message}`);
  }
  return normalizeBackupPayload(payload);
}

/**
 * MySQL 数据备份到 COS（可选再写一份本地文件）。
 * 备份格式是可恢复的完整快照，不是 mysqldump SQL。
 */
export class BackupService {
  constructor({ config, store, logger = console, cosClient = null }) {
    this.config = config;
    this.store = store;
    this.logger = logger;
    this.supported = typeof store.exportSnapshot === 'function';
    this.cosConfigured = Boolean(config.backupCosConfigured);
    this.localConfigured = Boolean(config.backupLocalDir);
    this.configured = this.supported && (this.cosConfigured || this.localConfigured);
    this.running = false;
    this.task = null;
    this.lastRun = null;
    this.cos =
      cosClient ||
      (this.cosConfigured
        ? new COS({
            SecretId: config.cosSecretId,
            SecretKey: config.cosSecretKey,
          })
        : null);
  }

  get statusProvider() {
    if (this.cosConfigured && this.localConfigured) return 'cos+local';
    if (this.cosConfigured) return 'cos';
    if (this.localConfigured) return 'local';
    return 'none';
  }

  async init() {
    if (this.supported && typeof this.store.getLatestBackupRun === 'function') {
      try {
        this.lastRun = await this.store.getLatestBackupRun();
      } catch (error) {
        this.logger.warn(`[backup] 读取最近备份记录失败：${error.message}`);
      }
    }
  }

  start() {
    if (!this.config.backupEnabled) return;
    if (!this.configured) {
      this.logger.warn(
        '[backup] BACKUP_ENABLED=true 但未配置 COS 或 BACKUP_LOCAL_DIR，自动备份不会启动。',
      );
      return;
    }
    if (!cron.validate(this.config.backupCron)) {
      this.logger.error(`[backup] BACKUP_CRON 不合法：${this.config.backupCron}`);
      return;
    }
    try {
      this.task = cron.schedule(
        this.config.backupCron,
        () => {
          this.run({ reason: 'scheduled' }).catch((error) => {
            this.logger.error(`[backup] 自动备份失败：${error.message}`);
          });
        },
        { timezone: this.config.backupTimezone },
      );
      this.logger.info(
        `[backup] 自动备份已启用：${this.config.backupCron} (${this.config.backupTimezone}) → ${this.statusProvider}`,
      );
    } catch (error) {
      this.logger.error(`[backup] 自动备份调度失败：${error.message}`);
      this.task = null;
    }
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  async createPayload() {
    if (!this.supported) {
      throw backupError(
        'BACKUP_UNSUPPORTED',
        '当前是 JSON 本地存储模式，不支持在线备份；请切换 DB_DRIVER=mysql。',
        503,
      );
    }
    const snapshot = await this.store.exportSnapshot();
    const createdAt = new Date().toISOString();
    return {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: snapshot.schemaVersion,
      createdAt,
      counts: snapshot.counts,
      data: {
        courses: Array.isArray(snapshot.courses) ? snapshot.courses : [],
        teachers: Array.isArray(snapshot.teachers) ? snapshot.teachers : [],
        students: snapshot.students,
        questions: snapshot.questions,
        likes: snapshot.likes,
        comments: Array.isArray(snapshot.comments) ? snapshot.comments : [],
        commentLikes: Array.isArray(snapshot.commentLikes) ? snapshot.commentLikes : [],
        resources: Array.isArray(snapshot.resources) ? snapshot.resources : [],
        courseNotices: Array.isArray(snapshot.courseNotices) ? snapshot.courseNotices : [],
        noticeReads: Array.isArray(snapshot.noticeReads) ? snapshot.noticeReads : [],
        studentEvents: Array.isArray(snapshot.studentEvents) ? snapshot.studentEvents : [],
      },
    };
  }

  async run({ reason = 'manual' } = {}) {
    if (!this.configured) {
      throw backupError(
        'BACKUP_NOT_CONFIGURED',
        this.supported
          ? '未配置 COS 或本地备份目录，无法执行备份。'
          : '当前是 JSON 本地存储模式，无法执行在线备份。',
        503,
      );
    }
    if (this.running) {
      throw backupError('BACKUP_IN_PROGRESS', '已有备份任务正在执行，请稍后再试。', 409);
    }

    this.running = true;
    const startedAt = new Date();
    const { datePath, fileStamp } = backupStamp(
      startedAt,
      this.config.businessTimezoneOffsetMinutes,
    );
    const filename = `math-analysis-backup-${fileStamp}.json.gz`;
    let objectKey = null;
    let localPath = null;
    let sizeBytes = null;
    let provider = this.statusProvider;

    try {
      const payload = await this.createPayload();
      const json = JSON.stringify(payload);
      const buffer = await gzipAsync(Buffer.from(json, 'utf8'), { level: 9 });
      const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
      sizeBytes = buffer.length;

      if (this.localConfigured) {
        await fs.mkdir(this.config.backupLocalDir, { recursive: true });
        localPath = path.join(this.config.backupLocalDir, filename);
        await fs.writeFile(localPath, buffer, { mode: 0o600, flag: 'wx' });
      }

      if (this.cosConfigured && this.cos) {
        objectKey = `${this.config.cosBackupPrefix}${datePath}/${filename}`;
        await new Promise((resolve, reject) => {
          this.cos.putObject(
            {
              Bucket: this.config.cosBucket,
              Region: this.config.cosRegion,
              Key: objectKey,
              Body: buffer,
              ContentType: 'application/gzip',
              ContentDisposition: `attachment; filename="${filename}"`,
              Metadata: {
                'backup-format': BACKUP_FORMAT,
                'backup-schema-version': String(payload.schemaVersion),
                'backup-sha256': checksum,
              },
            },
            (error) => (error ? reject(error) : resolve()),
          );
        });
      }

      const finishedAt = new Date();
      const result = {
        status: 'success',
        provider,
        reason,
        objectKey,
        localPath,
        sizeBytes,
        checksum,
        counts: payload.counts,
        createdAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };
      await this.recordRun({
        provider,
        status: 'success',
        reason,
        objectKey,
        localPath,
        sizeBytes,
        createdAt: finishedAt,
      });
      this.lastRun = result;
      this.logger.info(
        `[backup] 备份成功 provider=${provider} size=${sizeBytes}B key=${objectKey || localPath || '-'}`,
      );
      return result;
    } catch (error) {
      await this.recordRun({
        provider,
        status: 'failed',
        reason,
        objectKey,
        localPath,
        sizeBytes,
        errorMessage: error.message,
        createdAt: new Date(),
      }).catch(() => {});
      this.lastRun = {
        status: 'failed',
        provider,
        reason,
        objectKey,
        localPath,
        sizeBytes,
        errorMessage: error.message,
        createdAt: new Date().toISOString(),
      };
      this.logger.error(`[backup] 备份失败 provider=${provider}：${error.message}`);
      throw error;
    } finally {
      this.running = false;
    }
  }

  async recordRun(run) {
    if (typeof this.store.recordBackupRun !== 'function') return;
    await this.store.recordBackupRun(run);
  }

  getStatus() {
    return {
      supported: this.supported,
      configured: this.configured,
      automatic: Boolean(this.task),
      provider: this.statusProvider,
      running: this.running,
      schedule: this.task ? this.config.backupCron : null,
      timezone: this.config.backupTimezone,
      storageDriver: this.store.backendType || 'unknown',
      cos: this.cosConfigured
        ? {
            bucket: this.config.cosBucket,
            region: this.config.cosRegion,
            prefix: this.config.cosBackupPrefix,
          }
        : null,
      localEnabled: this.localConfigured,
      lastRun: this.lastRun,
    };
  }
}

export function createBackupService({ config, store, logger = console, cosClient = null }) {
  return new BackupService({ config, store, logger, cosClient });
}
