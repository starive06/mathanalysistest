import assert from 'node:assert/strict';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { QuestionImageService } from '../src/lib/question-image-service.js';
import { ResourceStorage } from '../src/lib/resource-storage.js';
import { QuestionStore } from '../src/lib/store.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function jsonRequest(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, options);
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.arrayBuffer();
  return { response, body };
}

test('图片提问上传、视觉模型参数、图片读取和历史回显', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'math-tutor-image-'));
  const store = new QuestionStore({
    dataDir: path.join(tempDir, 'data'),
    hashSalt: 'image-test-salt',
    logger: { info() {}, warn() {}, error() {} },
  });
  await store.init();
  const config = {
    adminToken: 'image-admin-token',
    teacherRegisterCode: 'image-register-code',
    clientHashSalt: 'image-test-salt',
    maxQuestionLength: 2000,
    askRateLimit: 100,
    likeRateLimit: 100,
    loginRateLimit: 100,
    manualBackupRateLimit: 100,
    commentsPerMinute: 100,
    publicDir: path.resolve('public'),
    resourceMaxSizeMb: 5,
    resourceStorage: 'local',
    resourceLocalDir: path.join(tempDir, 'resources'),
    questionImageLocalDir: path.join(tempDir, 'question-images'),
    questionImageMaxSizeMb: 2,
    cosQuestionImagePrefix: 'math-analysis-tutor/question-images/',
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
    deepseekModel: 'deepseek-chat',
    deepseekVisionModel: 'deepseek-flash',
    miniprogramAppId: '',
    miniprogramSecret: '',
    wechatPushEnabled: false,
    wechatMpAppId: '',
    wechatMpTemplateId: '',
    wechatMpTemplateUrl: 'https://weixin.qq.com/',
  };
  const imageStorage = await new ResourceStorage({
    config: {
      ...config,
      resourceLocalDir: config.questionImageLocalDir,
      cosResourcePrefix: config.cosQuestionImagePrefix,
    },
    logger: { info() {}, warn() {}, error() {} },
  }).init();
  const imageService = new QuestionImageService({
    config,
    store,
    storage: imageStorage,
    logger: { info() {}, warn() {}, error() {} },
  });
  let askedImage = null;
  const deepseek = {
    configured: true,
    async ask({ question, context, image }) {
      askedImage = image;
      assert.equal(question, '请分析图片中的极限题');
      assert.deepEqual(context, []);
      return {
        answer: '图片中的极限可以用夹逼定理。',
        model: 'deepseek-flash',
        usage: null,
        latencyMs: 10,
      };
    },
  };
  const app = createApp({
    config,
    store,
    deepseek,
    questionImageService: imageService,
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

  const form = new FormData();
  form.append('question', '请分析图片中的极限题');
  form.append('context', '[]');
  form.append('image', new Blob([PNG_1X1], { type: 'image/png' }), 'question.png');
  const created = await jsonRequest(baseUrl, '/api/questions', {
    method: 'POST',
    headers: { 'X-Client-Id': 'image-student-001' },
    body: form,
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.data.imageMimeType, 'image/png');
  assert.match(created.body.data.imagePath, /^\/api\/images\/[a-f0-9]{48}$/);
  assert.ok(askedImage);
  assert.equal(askedImage.mimeType, 'image/png');
  assert.deepEqual(askedImage.buffer, PNG_1X1);

  const token = created.body.data.imagePath.split('/').pop();
  const imageResponse = await fetch(`${baseUrl}/api/images/${token}`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), PNG_1X1);

  const single = await jsonRequest(baseUrl, `/api/questions/${created.body.data.id}`, {
    headers: { 'X-Client-Id': 'image-student-001' },
  });
  assert.equal(single.response.status, 200);
  assert.equal(single.body.data.imagePath, created.body.data.imagePath);

  const mine = await jsonRequest(baseUrl, '/api/questions/mine', {
    headers: { 'X-Client-Id': 'image-student-001' },
  });
  assert.equal(mine.response.status, 200);
  assert.equal(mine.body.data.items[0].imagePath, created.body.data.imagePath);

  const badForm = new FormData();
  badForm.append('question', '坏图片');
  badForm.append('image', new Blob([Buffer.from('not an image')], { type: 'image/png' }), 'bad.png');
  const bad = await jsonRequest(baseUrl, '/api/questions', {
    method: 'POST',
    headers: { 'X-Client-Id': 'image-student-001' },
    body: badForm,
  });
  assert.equal(bad.response.status, 400);
  assert.equal(bad.body.error.code, 'IMAGE_FORMAT_UNSUPPORTED');
});
