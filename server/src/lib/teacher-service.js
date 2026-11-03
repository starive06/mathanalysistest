import { AppError } from './errors.js';
import {
  LEGACY_TEACHER,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  normalizePublicId,
  normalizeTeacherName,
  publicTeacher,
  safeTokenEqual,
  sessionExpiry,
  validatePassword,
  verifyPassword,
} from './auth.js';

function accountConflict(message = '邮箱或对外展示 ID 已被使用。') {
  return new AppError(409, 'TEACHER_ACCOUNT_EXISTS', message);
}

export class TeacherService {
  constructor({ store, config, logger = console }) {
    this.store = store;
    this.config = config;
    this.logger = logger;
  }

  _public(teacher) {
    return publicTeacher(teacher);
  }

  async _createSession(teacher) {
    const token = createSessionToken();
    await this.store.createTeacherSession({
      teacherId: teacher.id,
      tokenHash: hashSessionToken(token),
      expiresAt: sessionExpiry(),
    });
    return token;
  }

  async register({ email, password, name, publicId, registerCode }) {
    if (!safeTokenEqual(this.config.teacherRegisterCode, String(registerCode || ''))) {
      throw new AppError(403, 'TEACHER_REGISTER_CODE_INVALID', '教师注册码不正确。');
    }
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = normalizeTeacherName(name);
    const normalizedPublicId = normalizePublicId(publicId);
    validatePassword(password);
    if (await this.store.getTeacherByEmail(normalizedEmail)) {
      throw accountConflict('这个邮箱已经注册。');
    }
    const passwordHash = await hashPassword(password);
    const teacher = await this.store.createTeacher({
      email: normalizedEmail,
      passwordHash,
      name: normalizedName,
      publicId: normalizedPublicId,
    });
    const token = await this._createSession(teacher);
    this.logger.info(`[auth] teacher registered id=${teacher.id}`);
    return { token, teacher: this._public(teacher) };
  }

  async login({ email, password }) {
    const normalizedEmail = normalizeEmail(email);
    const teacher = await this.store.getTeacherByEmail(normalizedEmail);
    const valid = teacher
      ? await verifyPassword(String(password || ''), teacher.passwordHash)
      : false;
    if (!teacher || !valid) {
      throw new AppError(401, 'TEACHER_LOGIN_FAILED', '邮箱或密码不正确。');
    }
    const token = await this._createSession(teacher);
    this.logger.info(`[auth] teacher login id=${teacher.id}`);
    return { token, teacher: this._public(teacher) };
  }

  async legacyLogin(token) {
    if (!safeTokenEqual(this.config.adminToken, String(token || '').trim())) {
      throw new AppError(401, 'ADMIN_LOGIN_FAILED', '教师口令不正确。');
    }
    return {
      token: this.config.adminToken,
      teacher: this._public(LEGACY_TEACHER),
    };
  }

  async authenticate(token) {
    if (!token) return null;
    if (safeTokenEqual(this.config.adminToken, token)) return { ...LEGACY_TEACHER };
    const teacher = await this.store.getTeacherBySession(hashSessionToken(token));
    return teacher || null;
  }

  async me(teacher) {
    if (teacher.legacy) return this._public(LEGACY_TEACHER);
    return this._public(teacher);
  }

  async updateProfile(teacher, { email, name, publicId, currentPassword }) {
    if (teacher.legacy) {
      throw new AppError(403, 'LEGACY_PROFILE_READONLY', '教师口令模式不能修改资料，请先注册邮箱账号。');
    }
    const authTeacher = await this.store.getTeacherAuthById(teacher.id);
    if (!authTeacher) throw new AppError(404, 'TEACHER_NOT_FOUND', '教师账号不存在。');
    const nextEmail = normalizeEmail(email ?? authTeacher.email);
    const nextName = normalizeTeacherName(name ?? authTeacher.name);
    const nextPublicId = normalizePublicId(publicId ?? authTeacher.publicId);
    if (nextEmail !== authTeacher.email) {
      const valid = await verifyPassword(
        String(currentPassword || ''),
        authTeacher.passwordHash,
      );
      if (!valid) {
        throw new AppError(403, 'CURRENT_PASSWORD_INVALID', '修改邮箱需要验证当前密码。');
      }
    }
    const updated = await this.store.updateTeacher(teacher.id, {
      email: nextEmail,
      name: nextName,
      publicId: nextPublicId,
    });
    this.logger.info(`[auth] teacher profile updated id=${teacher.id}`);
    return this._public(updated);
  }

  async changePassword(teacher, { currentPassword, newPassword }) {
    if (teacher.legacy) {
      throw new AppError(403, 'LEGACY_PASSWORD_READONLY', '教师口令模式不能修改密码。');
    }
    validatePassword(newPassword, '新密码');
    const authTeacher = await this.store.getTeacherAuthById(teacher.id);
    if (!authTeacher) throw new AppError(404, 'TEACHER_NOT_FOUND', '教师账号不存在。');
    const valid = await verifyPassword(
      String(currentPassword || ''),
      authTeacher.passwordHash,
    );
    if (!valid) {
      throw new AppError(403, 'CURRENT_PASSWORD_INVALID', '当前密码不正确。');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.store.updateTeacherPassword(teacher.id, passwordHash);
    await this.store.deleteTeacherSessions(teacher.id);
    const token = await this._createSession(authTeacher);
    this.logger.info(`[auth] teacher password changed id=${teacher.id}`);
    return { token, teacher: this._public(authTeacher) };
  }

  async logout(token) {
    if (!token || safeTokenEqual(this.config.adminToken, token)) return;
    await this.store.deleteTeacherSession(hashSessionToken(token));
  }
}
