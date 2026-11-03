#!/usr/bin/env node
/**
 * 不连接真实云环境，验证小程序云托管调用参数和响应解析。
 * 运行：node tools/test-miniprogram-cloud.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..', 'miniprogram');
const config = require(path.join(miniRoot, 'config.js'));
config.transport = 'cloud';
config.cloudEnv = 'prod-test-cloud-env';
config.cloudService = 'math-tutor';
config.cloudPublicBaseUrl = 'https://cloud.example.com';

const calls = [];
let mode = 'success';

global.wx = {
  env: {
    USER_DATA_PATH: '/tmp/miniprogram-user-data',
  },
  getStorageSync() {
    return 'test-client-id-12345678';
  },
  setStorageSync() {},
  getFileSystemManager() {
    return {
      writeFile(options) {
        calls.push({ type: 'write-file', options });
        options.success();
      },
    };
  },
  request(options) {
    calls.push({ type: 'public-request', options });
    setImmediate(() => {
      options.success({
        statusCode: 200,
        data: { ok: true, data: { id: 'q_public_1', status: 'answered' } },
      });
    });
  },
  downloadFile(options) {
    calls.push({ type: 'public-download', options });
    setImmediate(() => {
      options.success({ statusCode: 200, tempFilePath: '/tmp/public-resource.pdf' });
    });
  },
  uploadFile(options) {
    calls.push({ type: 'image-upload', options });
    setImmediate(() => {
      options.success({
        statusCode: 201,
        data: JSON.stringify({
          ok: true,
          data: { id: 'q_image_1', answer: '图片分析结果', imagePath: '/api/images/token' },
        }),
      });
    });
  },
  cloud: {
    init(options) {
      calls.push({ type: 'init', options });
    },
    callContainer(options) {
      calls.push({ type: 'request', options });
      setImmediate(() => {
        if (options.responseType === 'arraybuffer') {
          options.success({
            statusCode: 200,
            data: new ArrayBuffer(8),
          });
          return;
        }
        if (mode === 'error') {
          options.success({
            statusCode: 429,
            data: {
              ok: false,
              error: { code: 'ASK_RATE_LIMITED', message: '提问过于频繁' },
            },
          });
          return;
        }
        options.success({
          statusCode: 200,
          data: {
            ok: true,
            data: { status: 'ok', deepseekConfigured: true },
          },
        });
      });
    },
  },
};

const api = require(path.join(miniRoot, 'utils', 'api.js'));

async function main() {
  const health = await api.getHealth();
  assert.equal(health.status, 'ok');
  const request = calls.find((call) => call.type === 'request').options;
  assert.equal(request.path, '/api/health');
  assert.equal(request.method, 'GET');
  assert.equal(request.config.env, 'prod-test-cloud-env');
  assert.equal(request.header['X-WX-SERVICE'], 'math-tutor');
  assert.equal(request.header['X-Client-Id'], 'test-client-id-12345678');
  assert.equal(request.timeout, 10000);

  await api.askQuestion('测试问题', []);
  const askCall = calls.filter((call) => call.type === 'public-request').at(-1).options;
  assert.equal(askCall.url, 'https://cloud.example.com/api/questions');
  assert.equal(askCall.method, 'POST');
  assert.equal(askCall.data.question, '测试问题');
  assert.equal(askCall.timeout, 60000);
  assert.equal(askCall.header['X-Client-Id'], 'test-client-id-12345678');

  const imageAnswer = await api.askQuestionWithImage(
    '请分析这张图',
    [],
    '/tmp/question.png',
  );
  assert.equal(imageAnswer.answer, '图片分析结果');
  const uploadCall = calls.filter((call) => call.type === 'image-upload').at(-1).options;
  assert.equal(uploadCall.url, 'https://cloud.example.com/api/questions');
  assert.equal(uploadCall.name, 'image');
  assert.equal(uploadCall.filePath, '/tmp/question.png');
  assert.equal(uploadCall.formData.question, '请分析这张图');
  assert.equal(uploadCall.header['X-Client-Id'], 'test-client-id-12345678');

  const publicFile = await api.downloadResourceFile({
    id: 'res_public_1',
    extension: 'pdf',
  });
  assert.equal(publicFile, '/tmp/public-resource.pdf');
  const publicDownload = calls.filter((call) => call.type === 'public-download').at(-1)
    .options;
  assert.equal(
    publicDownload.url,
    'https://cloud.example.com/api/resources/res_public_1/file',
  );
  assert.equal(publicDownload.header['X-Client-Id'], 'test-client-id-12345678');

  config.cloudPublicBaseUrl = '';
  const filePath = await api.downloadResourceFile({
    id: 'res_test_1',
    extension: 'pdf',
  });
  assert.equal(filePath, '/tmp/miniprogram-user-data/resource-res_test_1.pdf');
  const fileCall = calls.filter((call) => call.type === 'request').at(-1).options;
  assert.equal(fileCall.path, '/api/resources/res_test_1/file');
  assert.equal(fileCall.responseType, 'arraybuffer');
  assert.equal(fileCall.header['X-WX-SERVICE'], 'math-tutor');
  assert.equal(fileCall.timeout, 15000);
  assert.equal(calls.filter((call) => call.type === 'write-file').length, 1);

  await assert.rejects(
    () => api.askQuestion('没有公网域名', []),
    (error) => error.code === 'CLOUD_PUBLIC_URL_MISSING',
  );

  mode = 'error';
  await assert.rejects(
    () => api.getHealth(),
    (error) => error.code === 'ASK_RATE_LIMITED' && error.statusCode === 429,
  );

  config.cloudEnv = '';
  await assert.rejects(
    () => api.getHealth(),
    (error) => error.code === 'CLOUD_CONFIG_MISSING',
  );

  config.cloudEnv = 'prod-test-cloud-env';
  let appDefinition = null;
  global.App = (definition) => {
    appDefinition = definition;
  };
  delete require.cache[require.resolve(path.join(miniRoot, 'app.js'))];
  require(path.join(miniRoot, 'app.js'));
  appDefinition.onLaunch.call(appDefinition);
  const initCall = calls.find((call) => call.type === 'init');
  assert.equal(initCall.options.env, 'prod-test-cloud-env');

  console.log('✓ 小程序云托管调用测试通过');
}

main().catch((error) => {
  console.error('✗ 小程序云托管调用测试失败');
  console.error(error);
  process.exit(1);
});
