import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const srcDir = path.dirname(fileURLToPath(import.meta.url));
export const serverRoot = path.resolve(srcDir, '..');

dotenv.config({ path: path.join(serverRoot, '.env') });

function readInt(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readString(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function readBool(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

const configuredAdminToken = readString('ADMIN_TOKEN');
const generatedAdminToken = configuredAdminToken
  ? ''
  : crypto.randomBytes(18).toString('base64url');
const configuredSalt = readString('CLIENT_HASH_SALT');
const generatedSalt = configuredSalt ? '' : crypto.randomBytes(24).toString('hex');

const dataDirSetting = readString('DATA_DIR', 'data');
const dataDir = path.isAbsolute(dataDirSetting)
  ? dataDirSetting
  : path.resolve(serverRoot, dataDirSetting);

const backupLocalDirSetting = readString('BACKUP_LOCAL_DIR');
const backupLocalDir = backupLocalDirSetting
  ? path.isAbsolute(backupLocalDirSetting)
    ? backupLocalDirSetting
    : path.resolve(serverRoot, backupLocalDirSetting)
  : '';
const resourceLocalDirSetting = readString('RESOURCE_LOCAL_DIR', 'uploads/resources');
const resourceLocalDir = path.isAbsolute(resourceLocalDirSetting)
  ? resourceLocalDirSetting
  : path.resolve(serverRoot, resourceLocalDirSetting);
const questionImageLocalDirSetting = readString(
  'QUESTION_IMAGE_LOCAL_DIR',
  'uploads/question-images',
);
const questionImageLocalDir = path.isAbsolute(questionImageLocalDirSetting)
  ? questionImageLocalDirSetting
  : path.resolve(serverRoot, questionImageLocalDirSetting);
const cosSecretId = readString('COS_SECRET_ID');
const cosSecretKey = readString('COS_SECRET_KEY');
const cosBucket = readString('COS_BUCKET');
const cosRegion = readString('COS_REGION');
const backupCosConfigured = Boolean(cosSecretId && cosSecretKey && cosBucket && cosRegion);

function prefixWithSlash(value) {
  const prefix = String(value || '').trim().replace(/^\/+/, '');
  if (!prefix) return '';
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

export const config = {
  serverRoot,
  publicDir: path.join(serverRoot, 'public'),
  dataDir,
  host: readString('HOST', '0.0.0.0'),
  port: readInt('PORT', 3000, { min: 1, max: 65535 }),

  deepseekApiKey: readString('DEEPSEEK_API_KEY'),
  deepseekBaseUrl: readString('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, ''),
  deepseekModel: readString('DEEPSEEK_MODEL', 'deepseek-chat'),
  deepseekTimeoutMs: readInt('DEEPSEEK_TIMEOUT_MS', 60_000, { min: 5_000, max: 120_000 }),

  adminToken: configuredAdminToken || generatedAdminToken,
  adminTokenGenerated: !configuredAdminToken,
  clientHashSalt: configuredSalt || generatedSalt,
  clientHashSaltGenerated: !configuredSalt,

  dbDriver: readString('DB_DRIVER', 'json').toLowerCase() === 'mysql' ? 'mysql' : 'json',
  mysqlHost: readString('MYSQL_HOST', '127.0.0.1'),
  mysqlPort: readInt('MYSQL_PORT', 3306, { min: 1, max: 65535 }),
  mysqlUser: readString('MYSQL_USER', ''),
  mysqlPassword: readString('MYSQL_PASSWORD'),
  mysqlDatabase: readString('MYSQL_DATABASE', ''),
  mysqlConnectionLimit: readInt('MYSQL_CONNECTION_LIMIT', 10, { min: 1, max: 50 }),
  mysqlSsl: readBool('MYSQL_SSL', false),
  dbAutoMigrate: readBool('DB_AUTO_MIGRATE', true),
  businessTimezoneOffsetMinutes: readInt('BUSINESS_TIMEZONE_OFFSET_MINUTES', 480, {
    min: -720,
    max: 840,
  }),

  cosSecretId,
  cosSecretKey,
  cosBucket,
  cosRegion,
  cosBackupPrefix: prefixWithSlash(readString('COS_BACKUP_PREFIX', 'math-analysis-tutor/backups')),
  backupCosConfigured,
  backupLocalDir,
  resourceStorage: readString('RESOURCE_STORAGE', 'auto').toLowerCase(),
  resourceLocalDir,
  resourceMaxSizeMb: readInt('RESOURCE_MAX_SIZE_MB', 30, { min: 1, max: 100 }),
  deepseekVisionModel: readString('DEEPSEEK_VISION_MODEL', 'deepseek-flash'),
  questionImageLocalDir,
  questionImageMaxSizeMb: readInt('QUESTION_IMAGE_MAX_SIZE_MB', 8, { min: 1, max: 20 }),
  cosQuestionImagePrefix: prefixWithSlash(
    readString('COS_QUESTION_IMAGE_PREFIX', 'math-analysis-tutor/question-images'),
  ),
  teacherRegisterCode:
    readString('TEACHER_REGISTER_CODE', '') || configuredAdminToken || generatedAdminToken,
  commentsPerMinute: readInt('COMMENTS_PER_MINUTE', 20, { min: 1, max: 120 }),
  miniprogramAppId: readString('MINIPROGRAM_APPID', ''),
  miniprogramSecret: readString('MINIPROGRAM_SECRET', ''),
  wechatPushEnabled: readBool('WECHAT_PUSH_ENABLED', false),
  wechatMpAppId: readString('WECHAT_MP_APPID', ''),
  wechatMpTemplateId: readString('WECHAT_MP_TEMPLATE_ID', ''),
  wechatMpTemplateUrl: readString('WECHAT_MP_TEMPLATE_URL', 'https://weixin.qq.com/'),
  cosResourcePrefix: prefixWithSlash(
    readString('COS_RESOURCE_PREFIX', 'math-analysis-tutor/resources'),
  ),
  backupEnabled: readBool('BACKUP_ENABLED', false),
  backupCron: readString('BACKUP_CRON', '0 3 * * *'),
  backupTimezone: readString('BACKUP_TIMEZONE', 'Asia/Shanghai'),
  manualBackupRateLimit: readInt('MANUAL_BACKUP_RATE_LIMIT_PER_HOUR', 10, {
    min: 1,
    max: 120,
  }),

  maxQuestionLength: readInt('MAX_QUESTION_LENGTH', 2000, { min: 100, max: 10_000 }),
  maxContextMessages: readInt('MAX_CONTEXT_MESSAGES', 12, { min: 0, max: 30 }),
  askRateLimit: readInt('ASK_RATE_LIMIT_PER_MINUTE', 10, { min: 1, max: 120 }),
  likeRateLimit: readInt('LIKE_RATE_LIMIT_PER_MINUTE', 40, { min: 1, max: 300 }),
  loginRateLimit: readInt('LOGIN_RATE_LIMIT_PER_15_MIN', 10, { min: 1, max: 100 }),
};
