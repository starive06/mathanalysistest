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
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, body };
}

test('提问、历史、社区点赞、教师登录与导出完整链路', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'math-tutor-test-'));
  const store = new QuestionStore({
    dataDir,
    hashSalt: 'unit-test-salt',
    logger: { error() {}, info() {} },
  });
  await store.init();

  const config = {
    adminToken: 'test-admin-token-123',
    clientHashSalt: 'unit-test-salt',
    maxQuestionLength: 2000,
    askRateLimit: 100,
    likeRateLimit: 100,
    loginRateLimit: 100,
    publicDir: path.resolve('public'),
  };
  const deepseek = {
    configured: true,
    async ask({ question }) {
      return {
        answer: `这是对“${question}”的模拟解答。\n1. 先看定义。\n2. 再计算。`,
        model: 'mock-deepseek',
        usage: { prompt_tokens: 10, completion_tokens: 20 },
        latencyMs: 12,
      };
    },
  };
  const app = createApp({
    config,
    store,
    deepseek,
    logger: { error() {}, info() {} },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.close();
    await once(server, 'close');
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await t.test('健康检查', async () => {
    const { response, body } = await jsonRequest(baseUrl, '/api/health');
    assert.equal(response.status, 200);
    assert.equal(body.data.deepseekConfigured, true);
  });

  await t.test('缺少匿名身份时拒绝提问', async () => {
    const { response, body } = await jsonRequest(baseUrl, '/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '求 lim(x→0) sin x / x' }),
    });
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'MISSING_CLIENT_ID');
  });

  let createdId;
  await t.test('学生甲提问并写入历史', async () => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Client-Id': 'student-alpha-001',
    };
    const { response, body } = await jsonRequest(baseUrl, '/api/questions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: '请说明 lim(x→0) sin x / x = 1 的证明思路。',
        context: [],
      }),
    });
    assert.equal(response.status, 201);
    assert.match(body.data.answer, /模拟解答/);
    assert.ok(body.data.id);
    createdId = body.data.id;

    const history = await jsonRequest(baseUrl, '/api/questions/mine', { headers });
    assert.equal(history.response.status, 200);
    assert.equal(history.body.data.total, 1);
    assert.equal(history.body.data.items[0].id, createdId);
  });

  await t.test('学生乙提问并点赞，社区按点赞排序', async () => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Client-Id': 'student-beta-002',
    };
    await jsonRequest(baseUrl, '/api/questions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ question: '讨论级数 ∑ 1/n² 的收敛性。' }),
    });
    const like = await jsonRequest(baseUrl, `/api/questions/${createdId}/like`, {
      method: 'POST',
      headers,
    });
    assert.equal(like.response.status, 200);
    assert.equal(like.body.data.liked, true);
    assert.equal(like.body.data.likeCount, 1);

    const community = await jsonRequest(baseUrl, '/api/community', { headers });
    assert.equal(community.response.status, 200);
    assert.equal(community.body.data.top[0].id, createdId);
    assert.equal(community.body.data.top[0].likedByMe, true);
    assert.equal(community.body.data.stats.totalStudents, 2);
    assert.equal(community.body.data.hasMore, false);
    assert.equal(community.body.data.recentTotal, 0);
  });

  let authHeaders;
  await t.test('教师口令校验与问题列表', async () => {
    const failed = await jsonRequest(baseUrl, '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'wrong-token' }),
    });
    assert.equal(failed.response.status, 401);

    const success = await jsonRequest(baseUrl, '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: config.adminToken }),
    });
    assert.equal(success.response.status, 200);
    authHeaders = { Authorization: `Bearer ${config.adminToken}` };

    const list = await jsonRequest(baseUrl, '/api/admin/questions', { headers: authHeaders });
    assert.equal(list.response.status, 200);
    assert.equal(list.body.data.questions.length, 2);
    assert.equal(list.body.data.stats.totalLikes, 1);
    assert.ok(list.body.data.questions[0].studentLabel.startsWith('学生 '));
  });

  await t.test('导出 Markdown 与 Word', async () => {
    const md = await jsonRequest(baseUrl, '/api/admin/export.md', { headers: authHeaders });
    assert.equal(md.response.status, 200);
    assert.match(md.response.headers.get('content-type'), /text\/markdown/);
    assert.match(md.body, /数学分析课程 · 学生提问汇总/);
    assert.match(md.body, /lim\(x→0\) sin x/);
    assert.match(md.body, /学生 01/);

    const docx = await fetch(`${baseUrl}/api/admin/export.docx`, { headers: authHeaders });
    assert.equal(docx.status, 200);
    assert.match(
      docx.headers.get('content-type'),
      /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/,
    );
    const buffer = Buffer.from(await docx.arrayBuffer());
    assert.equal(buffer.subarray(0, 2).toString(), 'PK');
    assert.ok(buffer.length > 5000);
  });

  await t.test('按所选 ID 导出 Markdown', async () => {
    const response = await fetch(`${baseUrl}/api/admin/export.md`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [createdId] }),
    });
    assert.equal(response.status, 200);
    const markdown = await response.text();
    assert.match(markdown, /lim\(x→0\) sin x/);
    assert.doesNotMatch(markdown, /∑ 1\/n²/);
  });

  await t.test('未授权导出被拒绝', async () => {
    const result = await fetch(`${baseUrl}/api/admin/export.md`);
    assert.equal(result.status, 401);
  });

  await t.test('安全响应头', async () => {
    const result = await fetch(`${baseUrl}/api/health`);
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(result.headers.get('x-frame-options'), 'DENY');
    assert.match(result.headers.get('content-security-policy'), /default-src 'self'/);
  });
});
