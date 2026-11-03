import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { AppError, DeepSeekError } from './lib/errors.js';
import {
  contentDisposition,
  createDocxExport,
  createMarkdownExport,
  exportFileName,
} from './lib/exporter.js';
import { SlidingWindowLimiter } from './lib/rate-limit.js';
import { normalizeComment, teacherActorHash } from './lib/auth.js';
import { TeacherService } from './lib/teacher-service.js';
import {
  RESOURCE_CATEGORIES,
  RESOURCE_FILE_TYPES,
} from './lib/resource-service.js';

const MAX_RESOURCE_SIZE_MB = 30;

function requestId() {
  return crypto.randomBytes(8).toString('hex');
}

function normalizeQuestion(value, maxLength) {
  if (typeof value !== 'string') {
    throw new AppError(400, 'INVALID_QUESTION', '请输入要提问的数学问题。');
  }
  const question = value
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (question.length < 2) {
    throw new AppError(400, 'INVALID_QUESTION', '问题太短，请补充完整。');
  }
  if (question.length > maxLength) {
    throw new AppError(400, 'QUESTION_TOO_LONG', `问题不能超过 ${maxLength} 个字符。`);
  }
  return question;
}

function parseAskContext(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseLimit(value, fallback, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

function parseClientId(req) {
  const raw = req.get('X-Client-Id');
  if (typeof raw !== 'string') return '';
  const clientId = raw.trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(clientId)) return '';
  return clientId;
}

function requireClient(store) {
  return (req, res, next) => {
    const clientId = parseClientId(req);
    if (!clientId) {
      return next(
        new AppError(400, 'MISSING_CLIENT_ID', '缺少有效的匿名身份，请重新进入小程序。'),
      );
    }
    req.clientId = clientId;
    req.ownerHash = store.hashClient(clientId);
    return next();
  };
}

function bearerToken(req) {
  const header = req.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function sendData(res, data, status = 200) {
  res.status(status).json({ ok: true, data });
}

function parseExportIds(req) {
  let values = [];
  if (Array.isArray(req.body?.ids)) {
    values = req.body.ids;
  } else if (typeof req.query.ids === 'string') {
    values = req.query.ids.split(',');
  }
  if (!values.length) return [];
  return [
    ...new Set(
      values
        .filter((id) => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ].slice(0, 5000);
}

export function createApp({
  config,
  store,
  deepseek,
  backupService = null,
  resourceService = null,
  questionImageService = null,
  pushService = null,
  logger = console,
}) {
  const app = express();
  const teacherService = new TeacherService({ store, config, logger });
  const askImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: (config.questionImageMaxSizeMb || 8) * 1024 * 1024,
      files: 1,
    },
    fileFilter(req, file, callback) {
      if (!String(file.mimetype || '').startsWith('image/')) {
        callback(
          new AppError(
            400,
            'IMAGE_FORMAT_UNSUPPORTED',
            '只支持 JPEG、PNG、GIF、WebP 图片。',
          ),
        );
        return;
      }
      callback(null, true);
    },
  }).single('image');
  const adminOnly = async (req, res, next) => {
    try {
      const token = bearerToken(req);
      const teacher = await teacherService.authenticate(token);
      if (!teacher) {
        throw new AppError(401, 'ADMIN_UNAUTHORIZED', '教师端登录已失效，请重新登录。');
      }
      req.teacher = teacher;
      req.teacherToken = token;
      next();
    } catch (error) {
      next(error);
    }
  };
  const resourceUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: (config.resourceMaxSizeMb || MAX_RESOURCE_SIZE_MB) * 1024 * 1024,
      files: 1,
    },
    fileFilter(req, file, callback) {
      const extension = String(file.originalname || '')
        .split('.')
        .pop()
        .toLowerCase();
      if (!RESOURCE_FILE_TYPES[extension]) {
        callback(
          new AppError(
            400,
            'RESOURCE_FILE_TYPE',
            '只支持 PPT、Word（doc/docx）和 PDF 文件',
          ),
        );
        return;
      }
      callback(null, true);
    },
  }).single('file');

  function ensureResourceService() {
    if (!resourceService) {
      throw new AppError(
        503,
        'RESOURCE_SERVICE_UNAVAILABLE',
        '教学资源服务未初始化。',
      );
    }
    return resourceService;
  }

  async function sendResourceFile(req, res) {
    const file = await ensureResourceService().getFile(req.params.id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(file.fileName));
    res.setHeader('Content-Length', String(file.buffer.length));
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(file.buffer);
  }
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const askLimiter = new SlidingWindowLimiter({
    limit: config.askRateLimit,
    windowMs: 60_000,
    name: 'ask',
  });
  const likeLimiter = new SlidingWindowLimiter({
    limit: config.likeRateLimit,
    windowMs: 60_000,
    name: 'like',
  });
  const loginLimiter = new SlidingWindowLimiter({
    limit: config.loginRateLimit,
    windowMs: 15 * 60_000,
    name: 'login',
  });
  const backupLimiter = new SlidingWindowLimiter({
    limit: config.manualBackupRateLimit ?? 10,
    windowMs: 60 * 60_000,
    name: 'backup',
  });
  const commentLimiter = new SlidingWindowLimiter({
    limit: config.commentsPerMinute ?? 20,
    windowMs: 60_000,
    name: 'comment',
  });
  const bindLimiter = new SlidingWindowLimiter({
    limit: 12,
    windowMs: 60_000,
    name: 'bind',
  });
  const registerLimiter = new SlidingWindowLimiter({
    limit: 8,
    windowMs: 60 * 60_000,
    name: 'register',
  });

  app.use((req, res, next) => {
    req.id = requestId();
    res.setHeader('X-Request-Id', req.id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    next();
  });
  app.use(express.json({ limit: '128kb' }));

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', async (req, res) => {
    const databaseOk =
      typeof store.ping === 'function' ? await store.ping() : true;
    const payload = {
      status: databaseOk ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      database: databaseOk ? 'ok' : 'unavailable',
      deepseekConfigured: Boolean(deepseek.configured),
      model: config.deepseekModel,
      storageDriver: store.backendType || 'unknown',
      backupConfigured: Boolean(backupService?.configured),
      teacherEmailLogin: true,
      pushConfigured: Boolean(pushService?.configured),
    };
    if (!databaseOk) {
      res.status(503).json({
        ok: false,
        data: payload,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: '数据库连接不可用，请检查 MySQL 服务。',
        },
        requestId: req.id,
      });
      return;
    }
    sendData(res, payload);
  });

  const clientOnly = requireClient(store);

  app.post('/api/identity/bind', clientOnly, async (req, res) => {
    if (!config.miniprogramAppId || !config.miniprogramSecret) {
      throw new AppError(
        503,
        'MINIPROGRAM_LOGIN_NOT_CONFIGURED',
        '服务端未配置小程序 AppID/Secret，暂时无法绑定推送身份。',
      );
    }
    const limit = bindLimiter.check(req.ownerHash);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      throw new AppError(
        429,
        'BIND_RATE_LIMITED',
        `身份绑定有点频繁，请 ${limit.retryAfter} 秒后再试。`,
        { retryAfter: limit.retryAfter },
      );
    }
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code || code.length > 256) {
      throw new AppError(400, 'INVALID_LOGIN_CODE', '微信登录 code 无效。');
    }
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', config.miniprogramAppId);
    url.searchParams.set('secret', config.miniprogramSecret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');
    let payload;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      payload = await response.json();
    } catch (error) {
      throw new AppError(502, 'WECHAT_LOGIN_FAILED', `微信登录失败：${error.message}`);
    }
    if (!payload?.openid) {
      throw new AppError(
        502,
        'WECHAT_LOGIN_FAILED',
        `微信登录失败：${payload?.errcode || ''} ${payload?.errmsg || '未返回 openid'}`.trim(),
      );
    }
    await store.bindStudentMiniOpenid(req.ownerHash, payload.openid);
    sendData(res, { bound: true });
  });

  app.post('/api/questions', clientOnly, askImageUpload, async (req, res) => {
    const limit = askLimiter.check(req.ownerHash);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      throw new AppError(
        429,
        'ASK_RATE_LIMITED',
        `提问有点频繁，请 ${limit.retryAfter} 秒后再试。`,
        { retryAfter: limit.retryAfter },
      );
    }

    const hasImage = Boolean(req.file);
    let rawQuestion = req.body?.question;
    if ((!rawQuestion || !String(rawQuestion).trim()) && hasImage) {
      rawQuestion = '请分析这张图片中的数学问题。';
    }
    const question = normalizeQuestion(rawQuestion, config.maxQuestionLength);
    const context = parseAskContext(req.body?.context);
    let imageInput = null;
    if (hasImage) {
      if (!questionImageService) {
        throw new AppError(503, 'IMAGE_SERVICE_UNAVAILABLE', '图片答疑服务未初始化。');
      }
      const imageType = questionImageService.validate(req.file.buffer);
      imageInput = {
        buffer: req.file.buffer,
        mimeType: imageType.mimeType,
      };
    }

    const result = await deepseek.ask({
      question,
      context,
      image: imageInput,
    });
    let imageRecord = null;
    if (imageInput) {
      imageRecord = await questionImageService.save(req.file.buffer);
    }
    let record;
    try {
      record = await store.addQuestion({
        ownerHash: req.ownerHash,
        question,
        answer: result.answer,
        model: result.model,
        usage: result.usage,
        latencyMs: result.latencyMs,
        image: imageRecord,
      });
    } catch (error) {
      if (imageRecord) await questionImageService.remove(imageRecord);
      throw error;
    }

    logger.info(
      `[ask] request=${req.id} question=${record.id} model=${result.model} image=${hasImage ? 'yes' : 'no'} latency=${result.latencyMs}ms`,
    );
    sendData(res, record, 201);
  });

  app.get('/api/images/:token', async (req, res) => {
    if (!questionImageService) {
      throw new AppError(503, 'IMAGE_SERVICE_UNAVAILABLE', '图片答疑服务未初始化。');
    }
    const image = await questionImageService.getByToken(req.params.token);
    if (!image) {
      throw new AppError(404, 'IMAGE_NOT_FOUND', '图片不存在或已被删除。');
    }
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Content-Length', String(image.buffer.length));
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(image.buffer);
  });

  app.get('/api/questions/mine', clientOnly, async (req, res) => {
    const limit = parseLimit(req.query.limit, 30, 100);
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const result = await store.listForClient(req.ownerHash, { limit, offset });
    const teacherComments = await store.getTeacherCommentsForQuestions(
      result.items.map((item) => item.id),
      { viewerType: 'student', actorHash: req.ownerHash },
    );
    result.items = result.items.map((item) => ({
      ...item,
      teacherComments: teacherComments.get(item.id) || [],
    }));
    sendData(res, result);
  });

  app.get('/api/questions/:id', clientOnly, async (req, res) => {
    const question = await store.getQuestion(req.params.id, req.ownerHash);
    if (!question) {
      throw new AppError(404, 'QUESTION_NOT_FOUND', '这条提问不存在或已被删除。');
    }
    sendData(res, question);
  });

  app.get('/api/questions/:id/comments', clientOnly, async (req, res) => {
    const questionOwner = await store.getQuestionOwnerHash(req.params.id);
    if (!questionOwner) {
      throw new AppError(404, 'QUESTION_NOT_FOUND', '这条提问不存在或已被删除。');
    }
    const comments = await store.getQuestionComments(req.params.id, {
      viewerType: 'student',
      actorHash: req.ownerHash,
    });
    sendData(res, {
      questionId: req.params.id,
      comments,
      count: comments.length,
      teacherCount: comments.filter((comment) => comment.authorType === 'teacher').length,
    });
  });

  app.post('/api/questions/:id/comments', clientOnly, async (req, res) => {
    const limit = commentLimiter.check(`student:${req.ownerHash}`);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      throw new AppError(
        429,
        'COMMENT_RATE_LIMITED',
        `评论有点频繁，请 ${limit.retryAfter} 秒后再试。`,
        { retryAfter: limit.retryAfter },
      );
    }
    const content = normalizeComment(req.body?.content);
    const questionOwner = await store.getQuestionOwnerHash(req.params.id);
    if (!questionOwner) {
      throw new AppError(404, 'QUESTION_NOT_FOUND', '这条提问不存在或已被删除。');
    }
    const comment = await store.createComment({
      id: makeId('cm'),
      questionId: req.params.id,
      authorType: 'student',
      studentOwnerHash: req.ownerHash,
      authorName: store.aliasFor(req.ownerHash),
      authorPublicId: '',
      content,
    });
    sendData(res, comment, 201);
  });

  app.post('/api/comments/:id/like', clientOnly, async (req, res) => {
    const limit = likeLimiter.check(`comment-student:${req.ownerHash}`);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      throw new AppError(
        429,
        'LIKE_RATE_LIMITED',
        `点赞操作有点频繁，请 ${limit.retryAfter} 秒后再试。`,
        { retryAfter: limit.retryAfter },
      );
    }
    const result = await store.toggleCommentLike(req.params.id, {
      actorType: 'student',
      actorHash: req.ownerHash,
    });
    if (!result) {
      throw new AppError(404, 'COMMENT_NOT_FOUND', '这条评论不存在或已被删除。');
    }
    sendData(res, result);
  });

  app.post('/api/questions/:id/like', clientOnly, async (req, res) => {
    const limit = likeLimiter.check(req.ownerHash);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      throw new AppError(
        429,
        'LIKE_RATE_LIMITED',
        `点赞操作有点频繁，请 ${limit.retryAfter} 秒后再试。`,
        { retryAfter: limit.retryAfter },
      );
    }
    const result = await store.toggleLike(req.params.id, req.ownerHash);
    if (!result) {
      throw new AppError(404, 'QUESTION_NOT_FOUND', '这条提问不存在或已被删除。');
    }
    sendData(res, result);
  });

  app.get('/api/community', clientOnly, async (req, res) => {
    const limit = parseLimit(req.query.limit, 30, 100);
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    sendData(res, await store.getCommunity(req.ownerHash, { limit, offset }));
  });

  app.get('/api/resources', clientOnly, async (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    sendData(res, {
      resources: await ensureResourceService().listPublic(category),
      categories: RESOURCE_CATEGORIES,
    });
  });

  app.get('/api/resources/:id/file', clientOnly, async (req, res) => {
    await sendResourceFile(req, res);
  });

  app.post('/api/auth/register', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const limit = registerLimiter.check(ip);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      throw new AppError(
        429,
        'REGISTER_RATE_LIMITED',
        `注册尝试过多，请 ${Math.ceil(limit.retryAfter / 60)} 分钟后再试。`,
        { retryAfter: limit.retryAfter },
      );
    }
    sendData(res, await teacherService.register(req.body || {}), 201);
  });

  app.post('/api/auth/login', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const limit = loginLimiter.check(ip);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      throw new AppError(
        429,
        'LOGIN_RATE_LIMITED',
        `尝试次数过多，请 ${Math.ceil(limit.retryAfter / 60)} 分钟后再试。`,
        { retryAfter: limit.retryAfter },
      );
    }
    sendData(res, await teacherService.login(req.body || {}));
  });

  app.post('/api/auth/logout', adminOnly, async (req, res) => {
    await teacherService.logout(req.teacherToken);
    sendData(res, { loggedOut: true });
  });

  app.get('/api/auth/me', adminOnly, async (req, res) => {
    sendData(res, { teacher: await teacherService.me(req.teacher) });
  });

  app.patch('/api/auth/profile', adminOnly, async (req, res) => {
    const teacher = await teacherService.updateProfile(req.teacher, req.body || {});
    sendData(res, { teacher });
  });

  app.post('/api/auth/password', adminOnly, async (req, res) => {
    sendData(res, await teacherService.changePassword(req.teacher, req.body || {}));
  });

  app.post('/api/admin/login', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const limit = loginLimiter.check(ip);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      throw new AppError(
        429,
        'LOGIN_RATE_LIMITED',
        `尝试次数过多，请 ${Math.ceil(limit.retryAfter / 60)} 分钟后再试。`,
        { retryAfter: limit.retryAfter },
      );
    }
    sendData(res, await teacherService.legacyLogin(req.body?.token));
  });

  app.get('/api/admin/questions', adminOnly, async (req, res) => {
    const [questions, stats] = await Promise.all([
      store.getAdminQuestions(),
      store.stats(),
    ]);
    sendData(res, {
      questions,
      stats,
      generatedAt: new Date().toISOString(),
    });
  });

  app.get('/api/admin/questions/:id/comments', adminOnly, async (req, res) => {
    const question = await store.getQuestion(req.params.id, '');
    if (!question) {
      throw new AppError(404, 'QUESTION_NOT_FOUND', '这条提问不存在或已被删除。');
    }
    const comments = await store.getQuestionComments(req.params.id, {
      viewerType: 'teacher',
      actorHash: teacherActorHash(req.teacher),
    });
    sendData(res, {
      questionId: req.params.id,
      comments,
      count: comments.length,
      teacherCount: comments.filter((comment) => comment.authorType === 'teacher').length,
    });
  });

  app.post('/api/admin/questions/:id/comments', adminOnly, async (req, res) => {
    const teacherKey = req.teacher.legacy ? 'legacy' : req.teacher.id;
    const limit = commentLimiter.check(`teacher:${teacherKey}`);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      throw new AppError(
        429,
        'COMMENT_RATE_LIMITED',
        `评论有点频繁，请 ${limit.retryAfter} 秒后再试。`,
        { retryAfter: limit.retryAfter },
      );
    }
    const content = normalizeComment(req.body?.content);
    const question = await store.getQuestion(req.params.id, '');
    if (!question) {
      throw new AppError(404, 'QUESTION_NOT_FOUND', '这条提问不存在或已被删除。');
    }
    const comment = await store.createComment({
      id: makeId('cm'),
      questionId: req.params.id,
      authorType: 'teacher',
      teacherId: req.teacher.legacy ? null : req.teacher.id,
      authorName: req.teacher.name,
      authorPublicId: req.teacher.publicId,
      content,
    });
    const studentOwnerHash = await store.getQuestionOwnerHash(req.params.id);
    if (studentOwnerHash && pushService) {
      void pushService
        .notifyTeacherComment({ question, comment, studentOwnerHash })
        .catch((error) => logger.warn(`[push] ${error.message}`));
    }
    sendData(
      res,
      {
        ...comment,
        pushStarted: Boolean(pushService?.configured),
      },
      201,
    );
  });

  app.post('/api/admin/comments/:id/like', adminOnly, async (req, res) => {
    const teacherKey = req.teacher.legacy ? 'legacy' : req.teacher.id;
    const limit = likeLimiter.check(`comment-teacher:${teacherKey}`);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      throw new AppError(
        429,
        'LIKE_RATE_LIMITED',
        `点赞操作有点频繁，请 ${limit.retryAfter} 秒后再试。`,
        { retryAfter: limit.retryAfter },
      );
    }
    const result = await store.toggleCommentLike(req.params.id, {
      actorType: 'teacher',
      actorHash: teacherActorHash(req.teacher),
    });
    if (!result) {
      throw new AppError(404, 'COMMENT_NOT_FOUND', '这条评论不存在或已被删除。');
    }
    sendData(res, result);
  });

  app.get('/api/admin/resources', adminOnly, async (req, res) => {
    sendData(res, {
      resources: await ensureResourceService().listAdmin(),
      categories: RESOURCE_CATEGORIES,
      maxSizeMb: config.resourceMaxSizeMb || MAX_RESOURCE_SIZE_MB,
    });
  });

  app.post(
    '/api/admin/resources',
    adminOnly,
    resourceUpload,
    async (req, res) => {
      const resource = await ensureResourceService().create({
        title: req.body?.title,
        category: req.body?.category,
        description: req.body?.description,
        file: req.file,
      });
      sendData(res, resource, 201);
    },
  );

  app.patch(
    '/api/admin/resources/:id',
    adminOnly,
    resourceUpload,
    async (req, res) => {
      const resource = await ensureResourceService().update(req.params.id, {
        title: req.body?.title,
        category: req.body?.category,
        description: req.body?.description,
        file: req.file,
      });
      sendData(res, resource);
    },
  );

  app.delete('/api/admin/resources/:id', adminOnly, async (req, res) => {
    await ensureResourceService().delete(req.params.id);
    sendData(res, { deleted: true });
  });

  app.get('/api/admin/resources/:id/file', adminOnly, async (req, res) => {
    await sendResourceFile(req, res);
  });

  app.get('/api/admin/backup', adminOnly, (req, res) => {
    if (!backupService) {
      sendData(res, {
        supported: false,
        configured: false,
        automatic: false,
        provider: 'none',
        running: false,
        lastRun: null,
      });
      return;
    }
    sendData(res, backupService.getStatus());
  });

  app.post('/api/admin/backup', adminOnly, async (req, res) => {
    if (!backupService || !backupService.configured) {
      throw new AppError(
        503,
        'BACKUP_NOT_CONFIGURED',
        '备份服务未配置。请设置 COS_* 或 BACKUP_LOCAL_DIR，并确认使用 MySQL。',
      );
    }
    const limit = backupLimiter.check(req.ip || req.socket.remoteAddress || 'admin');
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      throw new AppError(
        429,
        'BACKUP_RATE_LIMITED',
        `手动备份过于频繁，请 ${Math.ceil(limit.retryAfter / 60)} 分钟后再试。`,
        { retryAfter: limit.retryAfter },
      );
    }
    try {
      const result = await backupService.run({ reason: 'manual' });
      logger.info(`[backup] manual request=${req.id} status=success`);
      sendData(res, result, 201);
    } catch (error) {
      throw new AppError(
        error.status || 500,
        error.code || 'BACKUP_FAILED',
        error.message || '备份失败。',
      );
    }
  });

  async function exportQuestions(req, res, format) {
    const ids = parseExportIds(req);
    const questions = await store.getQuestionsForExport(ids);
    const generatedAt = new Date();
    const filename = exportFileName(format, generatedAt);

    if (format === 'md') {
      const markdown = createMarkdownExport({ questions, generatedAt });
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', contentDisposition(filename));
      res.send(markdown);
      return;
    }

    const buffer = await createDocxExport({ questions, generatedAt });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }

  app.get('/api/admin/export.md', adminOnly, async (req, res) => {
    await exportQuestions(req, res, 'md');
  });

  app.get('/api/admin/export.docx', adminOnly, async (req, res) => {
    await exportQuestions(req, res, 'docx');
  });

  app.post('/api/admin/export.md', adminOnly, async (req, res) => {
    await exportQuestions(req, res, 'md');
  });

  app.post('/api/admin/export.docx', adminOnly, async (req, res) => {
    await exportQuestions(req, res, 'docx');
  });

  app.use(
    '/admin',
    express.static(config.publicDir, {
      index: 'index.html',
      extensions: ['html'],
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get('/', (req, res) => res.redirect('/admin'));

  app.use('/api', (req, res) => {
    res.status(404).json({
      ok: false,
      error: { code: 'NOT_FOUND', message: '接口不存在。' },
      requestId: req.id,
    });
  });

  app.use((req, res) => {
    res.status(404).send('Not Found');
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = '服务器开小差了，请稍后重试。';
    let details;

    if (error instanceof DeepSeekError || error instanceof AppError) {
      status = error.status;
      code = error.code;
      message = error.expose === false ? '请求处理失败。' : error.message;
      details = error.details;
    } else if (error?.type === 'entity.too.large') {
      status = 413;
      code = 'BODY_TOO_LARGE';
      message = '请求内容过大。';
    } else if (error?.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = '请求格式不正确。';
    } else if (error?.code === 'LIMIT_FILE_SIZE' && req.path === '/api/questions') {
      status = 413;
      code = 'IMAGE_TOO_LARGE';
      message = `图片不能超过 ${config.questionImageMaxSizeMb || 8} MB，请压缩后重试。`;
    } else if (error?.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      code = 'RESOURCE_TOO_LARGE';
      message = `资源文件不能超过 ${config.resourceMaxSizeMb || MAX_RESOURCE_SIZE_MB} MB。`;
    } else if (error?.code === 'LIMIT_UNEXPECTED_FILE') {
      status = 400;
      code = 'RESOURCE_INVALID_UPLOAD';
      message = '一次只能上传一个资源文件，字段名应为 file。';
    } else if (error?.code === 'TEACHER_ACCOUNT_EXISTS') {
      status = 409;
      code = 'TEACHER_ACCOUNT_EXISTS';
      message = error.message;
    } else {
      logger.error(`[error] request=${req.id}`, error);
    }

    if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    res.status(status).json({
      ok: false,
      error: { code, message, ...(details ? { details } : {}) },
      requestId: req.id,
    });
  });

  return app;
}
