import assert from 'node:assert/strict';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { QuestionStore } from '../src/lib/store.js';

async function jsonRequest(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, options);
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { response, body };
}

test('教师邮箱账号、资料/密码修改和问答评论链路', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'math-tutor-auth-comments-'));
  const store = new QuestionStore({
    dataDir: tempDir,
    hashSalt: 'auth-comment-salt',
    logger: { info() {}, warn() {}, error() {} },
  });
  await store.init();
  const config = {
    adminToken: 'legacy-admin-token',
    teacherRegisterCode: 'register-code-123',
    clientHashSalt: 'auth-comment-salt',
    maxQuestionLength: 2000,
    askRateLimit: 100,
    likeRateLimit: 100,
    loginRateLimit: 100,
    manualBackupRateLimit: 100,
    commentsPerMinute: 100,
    publicDir: path.resolve('public'),
    resourceMaxSizeMb: 5,
    resourceStorage: 'local',
    resourceLocalDir: path.join(tempDir, 'uploads'),
    cosSecretId: '',
    cosSecretKey: '',
    cosBucket: '',
    cosRegion: '',
    cosResourcePrefix: 'math-analysis-tutor/resources/',
    backupCosConfigured: false,
    backupLocalDir: '',
    backupEnabled: false,
    backupCron: '0 3 * * *',
    backupTimezone: 'Asia/Shanghai',
    businessTimezoneOffsetMinutes: 480,
    miniprogramAppId: '',
    miniprogramSecret: '',
    wechatPushEnabled: false,
    wechatMpAppId: '',
    wechatMpTemplateId: '',
    wechatMpTemplateUrl: 'https://weixin.qq.com/',
  };
  const deepseek = {
    configured: true,
    async ask() {
      return {
        answer: '教师评论测试回答',
        model: 'mock',
        usage: null,
        latencyMs: 1,
      };
    },
  };
  const app = createApp({
    config,
    store,
    deepseek,
    logger: { info() {}, warn() {}, error() {} },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.close();
    await once(server, 'close');
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  let teacherToken = '';
  let teacherAccount;
  await t.test('邮箱注册、登录和资料修改', async () => {
    const registered = await jsonRequest(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'teacher@example.com',
        password: 'password-123',
        name: '王老师',
        publicId: 'teacher_wang',
        registerCode: 'register-code-123',
      }),
    });
    assert.equal(registered.response.status, 201);
    assert.ok(registered.body.data.token);
    assert.equal(registered.body.data.teacher.name, '王老师');
    assert.equal(registered.body.data.teacher.publicId, 'teacher_wang');
    assert.equal(registered.body.data.teacher.passwordHash, undefined);
    teacherToken = registered.body.data.token;
    teacherAccount = registered.body.data.teacher;

    const badRegisterCode = await jsonRequest(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'another@example.com',
        password: 'password-123',
        name: '李老师',
        publicId: 'teacher_li',
        registerCode: 'wrong',
      }),
    });
    assert.equal(badRegisterCode.response.status, 403);

    const login = await jsonRequest(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@example.com', password: 'password-123' }),
    });
    assert.equal(login.response.status, 200);
    assert.ok(login.body.data.token);
    teacherToken = login.body.data.token;

    const me = await jsonRequest(baseUrl, '/api/auth/me', {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    assert.equal(me.response.status, 200);
    assert.equal(me.body.data.teacher.email, 'teacher@example.com');

    const profile = await jsonRequest(baseUrl, '/api/auth/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`,
      },
      body: JSON.stringify({
        name: '王老师（修订）',
        publicId: 'teacher_wang2',
        email: 'teacher2@example.com',
        currentPassword: 'password-123',
      }),
    });
    assert.equal(profile.response.status, 200);
    assert.equal(profile.body.data.teacher.name, '王老师（修订）');
    assert.equal(profile.body.data.teacher.email, 'teacher2@example.com');
    teacherAccount = profile.body.data.teacher;

    const changed = await jsonRequest(baseUrl, '/api/auth/password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`,
      },
      body: JSON.stringify({
        currentPassword: 'password-123',
        newPassword: 'new-password-456',
      }),
    });
    assert.equal(changed.response.status, 200);
    assert.ok(changed.body.data.token);
    teacherToken = changed.body.data.token;

    const oldSession = await jsonRequest(baseUrl, '/api/auth/me', {
      headers: { Authorization: `Bearer ${registered.body.data.token}` },
    });
    assert.equal(oldSession.response.status, 401);

    const newLogin = await jsonRequest(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher2@example.com', password: 'new-password-456' }),
    });
    assert.equal(newLogin.response.status, 200);
  });

  let questionId;
  const studentA = { 'X-Client-Id': 'student-comment-a-001' };
  const studentB = { 'X-Client-Id': 'student-comment-b-001' };
  await t.test('学生提问', async () => {
    const result = await jsonRequest(baseUrl, '/api/questions', {
      method: 'POST',
      headers: { ...studentA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '为什么这个极限存在？', context: [] }),
    });
    assert.equal(result.response.status, 201);
    questionId = result.body.data.id;
  });

  let teacherCommentId;
  let studentCommentId;
  await t.test('学生和教师评论，教师评论置顶', async () => {
    const studentComment = await jsonRequest(
      baseUrl,
      `/api/questions/${questionId}/comments`,
      {
        method: 'POST',
        headers: { ...studentB, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '我也有同样的疑问。' }),
      },
    );
    assert.equal(studentComment.response.status, 201);
    studentCommentId = studentComment.body.data.id;
    assert.equal(studentComment.body.data.authorType, 'student');

    const teacherComment = await jsonRequest(
      baseUrl,
      `/api/admin/questions/${questionId}/comments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${teacherToken}`,
        },
        body: JSON.stringify({ content: '先看左右极限是否相等，再判断连续性。' }),
      },
    );
    assert.equal(teacherComment.response.status, 201);
    teacherCommentId = teacherComment.body.data.id;
    assert.equal(teacherComment.body.data.authorType, 'teacher');
    assert.equal(teacherComment.body.data.authorName, '王老师（修订）');
    assert.equal(teacherComment.body.data.pushStarted, false);

    const comments = await jsonRequest(
      baseUrl,
      `/api/questions/${questionId}/comments`,
      { headers: studentA },
    );
    assert.equal(comments.response.status, 200);
    assert.equal(comments.body.data.comments.length, 2);
    assert.equal(comments.body.data.comments[0].authorType, 'teacher');
    assert.equal(comments.body.data.comments[0].id, teacherCommentId);
    assert.equal(comments.body.data.comments[1].id, studentCommentId);
  });

  await t.test('评论点赞、历史教师评论和圈子评论计数', async () => {
    const studentLike = await jsonRequest(baseUrl, `/api/comments/${teacherCommentId}/like`, {
      method: 'POST',
      headers: studentA,
    });
    assert.equal(studentLike.response.status, 200);
    assert.equal(studentLike.body.data.liked, true);
    assert.equal(studentLike.body.data.likeCount, 1);

    const teacherLike = await jsonRequest(
      baseUrl,
      `/api/admin/comments/${studentCommentId}/like`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${teacherToken}` },
      },
    );
    assert.equal(teacherLike.response.status, 200);
    assert.equal(teacherLike.body.data.liked, true);

    const mine = await jsonRequest(baseUrl, '/api/questions/mine', {
      headers: studentA,
    });
    assert.equal(mine.response.status, 200);
    assert.equal(mine.body.data.items[0].teacherComments.length, 1);
    assert.equal(
      mine.body.data.items[0].teacherComments[0].content,
      '先看左右极限是否相等，再判断连续性。',
    );

    const community = await jsonRequest(baseUrl, '/api/community', {
      headers: studentB,
    });
    assert.equal(community.response.status, 200);
    const item = [...community.body.data.top, ...community.body.data.recent].find(
      (entry) => entry.id === questionId,
    );
    assert.ok(item);
    assert.equal(item.commentCount, 2);
    assert.equal(item.teacherCommentCount, 1);
  });

  await t.test('旧教师口令仍可登录但不能修改资料', async () => {
    const legacyLogin = await jsonRequest(baseUrl, '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'legacy-admin-token' }),
    });
    assert.equal(legacyLogin.response.status, 200);
    assert.equal(legacyLogin.body.data.teacher.legacy, true);
    const legacyProfile = await jsonRequest(baseUrl, '/api/auth/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer legacy-admin-token',
      },
      body: JSON.stringify({ name: '不能修改' }),
    });
    assert.equal(legacyProfile.response.status, 403);
  });
});
