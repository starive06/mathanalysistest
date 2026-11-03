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
  const body = await response.json();
  return { response, body };
}

test('学生 wx.login code 可绑定小程序 openid', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'math-tutor-identity-'));
  const store = new QuestionStore({
    dataDir: tempDir,
    hashSalt: 'identity-test-salt',
    logger: { info() {}, warn() {}, error() {} },
  });
  await store.init();
  const config = {
    adminToken: 'identity-admin-token',
    teacherRegisterCode: 'identity-register-code',
    clientHashSalt: 'identity-test-salt',
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
    miniprogramAppId: 'wx-identity-mini',
    miniprogramSecret: 'identity-mini-secret',
    wechatPushEnabled: false,
    wechatMpAppId: '',
    wechatMpTemplateId: '',
    wechatMpTemplateUrl: 'https://weixin.qq.com/',
  };
  const app = createApp({
    config,
    store,
    deepseek: { configured: false, async ask() { throw new Error('unused'); } },
    logger: { info() {}, warn() {}, error() {} },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (!String(url).includes('jscode2session')) {
      return originalFetch(url, options);
    }
    assert.equal(options.method, undefined);
    return new Response(
      JSON.stringify({ openid: 'openid-bound-1', session_key: 'session-key' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  t.after(async () => {
    global.fetch = originalFetch;
    server.close();
    await once(server, 'close');
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const result = await jsonRequest(baseUrl, '/api/identity/bind', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': 'identity-student-001',
    },
    body: JSON.stringify({ code: 'wx-login-code' }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.bound, true);
  const ownerHash = store.hashClient('identity-student-001');
  assert.equal(await store.getStudentMiniOpenid(ownerHash), 'openid-bound-1');
});
