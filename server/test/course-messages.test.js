import assert from 'node:assert/strict';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { QuestionStore } from '../src/lib/store.js';

async function request(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, options);
  const type = response.headers.get('content-type') || '';
  return {
    response,
    body: type.includes('application/json') ? await response.json() : await response.text(),
  };
}

const studentA = { 'Content-Type': 'application/json', 'X-Client-Id': 'course-student-a' };
const studentB = { 'Content-Type': 'application/json', 'X-Client-Id': 'course-student-b' };

test('课程隔离、课程管理和学生消息', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'math-tutor-course-'));
  const store = new QuestionStore({
    dataDir,
    hashSalt: 'course-test-salt',
    logger: { error() {}, info() {}, warn() {} },
  });
  await store.init();
  const config = {
    adminToken: 'course-admin-token',
    teacherRegisterCode: 'course-register-code',
    clientHashSalt: 'course-test-salt',
    maxQuestionLength: 2000,
    askRateLimit: 100,
    likeRateLimit: 100,
    loginRateLimit: 100,
    commentsPerMinute: 100,
    publicDir: path.resolve('public'),
    resourceMaxSizeMb: 5,
    resourceStorage: 'local',
    resourceLocalDir: path.join(dataDir, 'resources'),
    cosResourcePrefix: 'resources/',
    backupEnabled: false,
  };
  const app = createApp({
    config,
    store,
    deepseek: {
      configured: true,
      async ask({ question }) {
        return { answer: `回答：${question}`, model: 'mock', usage: null, latencyMs: 1 };
      },
    },
    logger: { error() {}, info() {}, warn() {} },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.close();
    await once(server, 'close');
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const login = await request(baseUrl, '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: config.adminToken }),
  });
  assert.equal(login.response.status, 200);
  const adminHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.adminToken}`,
  };

  const listed = await request(baseUrl, '/api/courses');
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.data.courses.length, 1);
  assert.equal(listed.body.data.courses[0].id, 'c_default');

  const createdCourse = await request(baseUrl, '/api/admin/courses', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      name: '实变函数论',
      teacherName: '任老师',
      courseCode: 'REAL-2026',
      term: '2026秋',
      colorIndex: 2,
    }),
  });
  assert.equal(createdCourse.response.status, 201);
  const courseId = createdCourse.body.data.id;
  assert.equal(createdCourse.body.data.courseCode, 'REAL-2026');

  const duplicate = await request(baseUrl, '/api/admin/courses', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      name: '重复课程',
      teacherName: '任老师',
      courseCode: 'real-2026',
    }),
  });
  assert.equal(duplicate.response.status, 409);

  const createdA = await request(baseUrl, '/api/questions', {
    method: 'POST',
    headers: studentA,
    body: JSON.stringify({ question: '实变函数中的可测集是什么？', courseId }),
  });
  assert.equal(createdA.response.status, 201);
  assert.equal(createdA.body.data.courseId, courseId);
  const questionId = createdA.body.data.id;

  const createdDefault = await request(baseUrl, '/api/questions', {
    method: 'POST',
    headers: studentA,
    body: JSON.stringify({ question: '数学分析的极限定义是什么？' }),
  });
  assert.equal(createdDefault.response.status, 201);
  assert.equal(createdDefault.body.data.courseId, 'c_default');

  const historyA = await request(
    baseUrl,
    `/api/questions/mine?courseId=${encodeURIComponent(courseId)}`,
    { headers: studentA },
  );
  assert.equal(historyA.body.data.total, 1);
  assert.equal(historyA.body.data.items[0].id, questionId);

  const adminAll = await request(baseUrl, '/api/admin/questions?courseId=all', {
    headers: adminHeaders,
  });
  assert.equal(adminAll.body.data.questions.length, 2);
  assert.equal(adminAll.body.data.stats.totalQuestions, 2);
  const adminA = await request(
    baseUrl,
    `/api/admin/questions?courseId=${encodeURIComponent(courseId)}`,
    { headers: adminHeaders },
  );
  assert.equal(adminA.body.data.questions.length, 1);
  assert.equal(adminA.body.data.stats.totalQuestions, 1);
  assert.equal(adminA.body.data.questions[0].courseName, '实变函数论');

  const like = await request(baseUrl, `/api/questions/${questionId}/like`, {
    method: 'POST',
    headers: studentB,
  });
  assert.equal(like.body.data.liked, true);
  await new Promise((resolve) => setTimeout(resolve, 30));

  const summary = await request(baseUrl, '/api/messages/summary', { headers: studentA });
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.data.comment, 1);

  let messages = await request(baseUrl, '/api/messages?box=comment', { headers: studentA });
  assert.equal(messages.body.data.items.length, 1);
  assert.equal(messages.body.data.items[0].type, 'like_question');
  assert.equal(messages.body.data.items[0].questionId, questionId);
  assert.equal(messages.body.data.items[0].courseName, '实变函数论');

  const mark = await request(baseUrl, '/api/messages/read', {
    method: 'POST',
    headers: studentA,
    body: JSON.stringify({ ids: [messages.body.data.items[0].id] }),
  });
  assert.equal(mark.response.status, 200);
  assert.equal(mark.body.data.summary.comment, 0);

  const comment = await request(baseUrl, `/api/questions/${questionId}/comments`, {
    method: 'POST',
    headers: studentB,
    body: JSON.stringify({ content: '可测集需要满足 σ-代数条件。' }),
  });
  assert.equal(comment.response.status, 201);
  await new Promise((resolve) => setTimeout(resolve, 30));
  messages = await request(baseUrl, '/api/messages?box=comment', { headers: studentA });
  assert.equal(messages.body.data.items[0].type, 'comment');
  assert.match(messages.body.data.items[0].body, /σ-代数/);

  const archived = await request(
    baseUrl,
    `/api/admin/courses/${encodeURIComponent(courseId)}`,
    { method: 'DELETE', headers: adminHeaders },
  );
  assert.equal(archived.response.status, 200);
  const coursesAfter = await request(baseUrl, '/api/courses');
  assert.equal(coursesAfter.body.data.courses.some((course) => course.id === courseId), false);
  const archivedAsk = await request(baseUrl, '/api/questions', {
    method: 'POST',
    headers: studentA,
    body: JSON.stringify({ question: '归档课程还能提问吗？', courseId }),
  });
  assert.equal(archivedAsk.response.status, 404);
});
