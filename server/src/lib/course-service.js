import crypto from 'node:crypto';
import { AppError } from './errors.js';

const COLORS = 6;

function cleanText(value, maxLength, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new AppError(400, 'COURSE_REQUIRED_FIELD', `请填写${field}。`);
  if (text.length > maxLength) {
    throw new AppError(400, 'COURSE_INVALID_FIELD', `${field}不能超过 ${maxLength} 个字符。`);
  }
  return text;
}

function optionalText(value, maxLength, field) {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) {
    throw new AppError(400, 'COURSE_INVALID_FIELD', `${field}不能超过 ${maxLength} 个字符。`);
  }
  return text;
}

function normalizeCode(value) {
  const code = cleanText(value, 64, '课程编号').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(code)) {
    throw new AppError(
      400,
      'COURSE_INVALID_CODE',
      '课程编号只能使用字母、数字、下划线和中划线，长度 2–64。',
    );
  }
  return code;
}

function normalizeColor(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(COLORS - 1, Math.max(0, n));
}

export class CourseService {
  constructor({ store }) {
    this.store = store;
  }

  async list({ includeArchived = false } = {}) {
    const courses = await this.store.listCourses({ includeArchived });
    const result = [];
    for (const course of courses) {
      const stats = await this.store.stats({ courseId: course.id });
      const resources = await this.store.listResources({ courseId: course.id });
      result.push({
        ...course,
        questionCount: stats.totalQuestions,
        resourceCount: resources.length,
      });
    }
    return result;
  }

  async get(id) {
    const course = await this.store.getCourse(id);
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', '课程不存在。');
    return course;
  }

  async requireActive(id) {
    const course = await this.store.getCourse(id);
    if (!course || course.status !== 'active') {
      throw new AppError(404, 'COURSE_NOT_FOUND', '课程不存在或已归档。');
    }
    return course;
  }

  async create({ name, teacherName, courseCode, term, colorIndex, sortOrder }) {
    const id = `c_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    return this.store.createCourse({
      id,
      name: cleanText(name, 120, '课程名称'),
      teacherName: cleanText(teacherName, 80, '教师姓名'),
      courseCode: normalizeCode(courseCode),
      term: optionalText(term, 32, '学期'),
      colorIndex: normalizeColor(colorIndex),
      sortOrder: Number.parseInt(sortOrder, 10) || 0,
    });
  }

  async update(id, updates) {
    const existing = await this.get(id);
    const next = {};
    if (updates.name !== undefined) next.name = cleanText(updates.name, 120, '课程名称');
    if (updates.teacherName !== undefined) {
      next.teacherName = cleanText(updates.teacherName, 80, '教师姓名');
    }
    if (updates.courseCode !== undefined) next.courseCode = normalizeCode(updates.courseCode);
    if (updates.term !== undefined) next.term = optionalText(updates.term, 32, '学期');
    if (updates.colorIndex !== undefined) next.colorIndex = normalizeColor(updates.colorIndex);
    if (updates.sortOrder !== undefined) {
      next.sortOrder = Number.parseInt(updates.sortOrder, 10) || 0;
    }
    if (updates.status !== undefined) {
      next.status = updates.status === 'archived' ? 'archived' : 'active';
    }
    if (!Object.keys(next).length) return existing;
    return this.store.updateCourse(id, next);
  }

  async archive(id) {
    const course = await this.get(id);
    if (course.status === 'active') {
      const active = await this.store.listCourses();
      if (active.length <= 1) {
        throw new AppError(400, 'COURSE_LAST_ACTIVE', '至少需要保留一门启用课程。');
      }
    }
    return this.store.archiveCourse(id);
  }
}

export { COLORS as COURSE_COLOR_COUNT };
