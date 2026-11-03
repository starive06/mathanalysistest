import assert from 'node:assert/strict';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { QuestionStore } from '../src/lib/store.js';
import { ResourceService } from '../src/lib/resource-service.js';
import { ResourceStorage } from '../src/lib/resource-storage.js';

async function jsonRequest(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, options);
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { response, body };
}

test('教师上传/修改/删除资源，学生浏览和下载', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'math-tutor-resources-'));
  const resourceDir = path.join(tempDir, 'uploads');
  const store = new QuestionStore({
    dataDir: path.join(tempDir, 'data'),
    hashSalt: 'resource-test-salt',
    logger: { info() {}, warn() {}, error() {} },
  });
  await store.init();

  const config = {
    adminToken: 'resource-admin-token',
    clientHashSalt: 'resource-test-salt',
    maxQuestionLength: 2000,
    askRateLimit: 100,
    likeRateLimit: 100,
    loginRateLimit: 100,
    manualBackupRateLimit: 100,
    publicDir: path.resolve('public'),
    resourceMaxSizeMb: 5,
    resourceStorage: 'local',
    resourceLocalDir: resourceDir,
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
  };
  const storage = await new ResourceStorage({
    config,
    logger: { info() {}, warn() {}, error() {} },
  }).init();
  const service = new ResourceService({
    store,
    storage,
    config,
    logger: { info() {}, warn() {}, error() {} },
  });
  const deepseek = {
    configured: true,
    async ask() {
      return {
        answer: 'mock answer',
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
    resourceService: service,
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

  const login = await jsonRequest(baseUrl, '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: config.adminToken }),
  });
  assert.equal(login.response.status, 200);
  const authHeaders = { Authorization: `Bearer ${config.adminToken}` };

  await t.test('学生未登录时可浏览资源列表', async () => {
    const result = await jsonRequest(baseUrl, '/api/resources', {
      headers: { 'X-Client-Id': 'resource-student-001' },
    });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.data.resources, []);
    assert.deepEqual(result.body.data.categories, [
      '讲义',
      '课件',
      '作业题',
      '作业题答案',
      '练习题',
      '模拟试卷',
    ]);
  });

  let resourceId;
  await t.test('教师上传 PDF 资源', async () => {
    const form = new FormData();
    form.append('title', '第一章 极限与连续 讲义');
    form.append('category', '讲义');
    form.append('description', '覆盖数列极限和函数极限');
    form.append(
      'file',
      new Blob([Buffer.from('%PDF-1.4 resource test content')], {
        type: 'application/pdf',
      }),
      '第一章讲义.pdf',
    );
    const result = await jsonRequest(baseUrl, '/api/admin/resources', {
      method: 'POST',
      headers: authHeaders,
      body: form,
    });
    assert.equal(result.response.status, 201);
    assert.ok(result.body.data.id);
    assert.equal(result.body.data.category, '讲义');
    assert.equal(result.body.data.fileTypeLabel, 'PDF');
    resourceId = result.body.data.id;

    const list = await jsonRequest(baseUrl, '/api/admin/resources', {
      headers: authHeaders,
    });
    assert.equal(list.response.status, 200);
    assert.equal(list.body.data.resources.length, 1);
    assert.equal(list.body.data.maxSizeMb, 5);
  });

  await t.test('学生能浏览并下载资源', async () => {
    const studentHeaders = { 'X-Client-Id': 'resource-student-001' };
    const list = await jsonRequest(baseUrl, '/api/resources', {
      headers: studentHeaders,
    });
    assert.equal(list.response.status, 200);
    assert.equal(list.body.data.resources.length, 1);
    assert.equal(list.body.data.resources[0].title, '第一章 极限与连续 讲义');

    const download = await fetch(`${baseUrl}/api/resources/${resourceId}/file`, {
      headers: studentHeaders,
    });
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-type'), /application\/pdf/);
    assert.match(
      download.headers.get('content-disposition'),
      /filename\*=UTF-8''/,
    );
    const buffer = Buffer.from(await download.arrayBuffer());
    assert.match(buffer.toString(), /resource test content/);
  });

  await t.test('教师修改标题、分类并替换文件', async () => {
    const form = new FormData();
    form.append('title', '第一章讲义（修订版）');
    form.append('category', '课件');
    form.append('description', '更新后的课件');
    form.append(
      'file',
      new Blob([Buffer.from('%PDF-1.4 revised content')], {
        type: 'application/pdf',
      }),
      'revision.pdf',
    );
    const result = await jsonRequest(baseUrl, `/api/admin/resources/${resourceId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: form,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.title, '第一章讲义（修订版）');
    assert.equal(result.body.data.category, '课件');

    const download = await fetch(`${baseUrl}/api/admin/resources/${resourceId}/file`, {
      headers: authHeaders,
    });
    assert.equal(download.status, 200);
    const buffer = Buffer.from(await download.arrayBuffer());
    assert.match(buffer.toString(), /revised content/);
  });

  await t.test('非法文件类型和分类被拒绝', async () => {
    const form = new FormData();
    form.append('title', '非法文件');
    form.append('category', '讲义');
    form.append('file', new Blob([Buffer.from('virus')]), 'bad.txt');
    const badFile = await jsonRequest(baseUrl, '/api/admin/resources', {
      method: 'POST',
      headers: authHeaders,
      body: form,
    });
    assert.equal(badFile.response.status, 400);
    assert.equal(badFile.body.error.code, 'RESOURCE_FILE_TYPE');

    const badCategoryForm = new FormData();
    badCategoryForm.append('title', '分类错误');
    badCategoryForm.append('category', '不存在分类');
    badCategoryForm.append(
      'file',
      new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }),
      'test.pdf',
    );
    const badCategory = await jsonRequest(baseUrl, '/api/admin/resources', {
      method: 'POST',
      headers: authHeaders,
      body: badCategoryForm,
    });
    assert.equal(badCategory.response.status, 400);
    assert.equal(badCategory.body.error.code, 'RESOURCE_INVALID_CATEGORY');
  });

  await t.test('未授权不能上传，删除后学生不可见', async () => {
    const form = new FormData();
    form.append('title', '未授权');
    form.append('category', '讲义');
    form.append('file', new Blob([Buffer.from('%PDF-1.4')]), 'test.pdf');
    const unauthorized = await jsonRequest(baseUrl, '/api/admin/resources', {
      method: 'POST',
      body: form,
    });
    assert.equal(unauthorized.response.status, 401);

    const deleted = await jsonRequest(baseUrl, `/api/admin/resources/${resourceId}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    assert.equal(deleted.response.status, 200);

    const studentList = await jsonRequest(baseUrl, '/api/resources', {
      headers: { 'X-Client-Id': 'resource-student-001' },
    });
    assert.equal(studentList.body.data.resources.length, 0);

    const missing = await fetch(`${baseUrl}/api/resources/${resourceId}/file`, {
      headers: { 'X-Client-Id': 'resource-student-001' },
    });
    assert.equal(missing.status, 404);
  });
});
