import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { AppError } from './errors.js';

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SESSION_BYTES = 32;

export const TEACHER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const LEGACY_TEACHER = Object.freeze({
  id: null,
  email: '',
  name: '课程教师',
  publicId: 'teacher',
  legacy: true,
});

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new AppError(400, 'INVALID_EMAIL', '请输入有效的邮箱地址。');
  }
  return email;
}

export function normalizeTeacherName(value) {
  const name = String(value || '').trim();
  if (name.length < 1 || name.length > 40) {
    throw new AppError(400, 'INVALID_TEACHER_NAME', '教师名称需要 1–40 个字符。');
  }
  return name;
}

export function normalizePublicId(value) {
  const publicId = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(publicId)) {
    throw new AppError(
      400,
      'INVALID_PUBLIC_ID',
      '对外展示 ID 需要 3–32 位，只能使用字母、数字、下划线或短横线。',
    );
  }
  return publicId;
}

export function validatePassword(value, fieldName = '密码') {
  const password = String(value || '');
  if (password.length < 8) {
    throw new AppError(400, 'PASSWORD_TOO_SHORT', `${fieldName}至少需要 8 个字符。`);
  }
  if (password.length > 128) {
    throw new AppError(400, 'PASSWORD_TOO_LONG', `${fieldName}不能超过 128 个字符。`);
  }
  return password;
}

export function normalizeComment(value) {
  const content = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (content.length < 1) {
    throw new AppError(400, 'COMMENT_EMPTY', '评论内容不能为空。');
  }
  if (content.length > 1000) {
    throw new AppError(400, 'COMMENT_TOO_LONG', '评论不能超过 1000 个字符。');
  }
  return content;
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password, encoded) {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  let actual;
  try {
    actual = await scryptAsync(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function createSessionToken() {
  return crypto.randomBytes(SESSION_BYTES).toString('base64url');
}

export function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function sessionExpiry(now = new Date()) {
  return new Date(now.getTime() + TEACHER_SESSION_TTL_MS);
}

export function publicTeacher(teacher) {
  if (!teacher) return null;
  return {
    id: teacher.id ?? null,
    email: teacher.email || '',
    name: teacher.name || LEGACY_TEACHER.name,
    publicId: teacher.publicId || LEGACY_TEACHER.publicId,
    legacy: Boolean(teacher.legacy),
  };
}

export function teacherActorHash(teacher) {
  const identity = teacher?.legacy ? 'legacy-admin' : String(teacher?.id ?? '');
  return crypto.createHash('sha256').update(`teacher:${identity}`).digest('hex');
}

export function safeTokenEqual(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
