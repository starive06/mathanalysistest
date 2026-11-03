import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { DeepSeekClient } from '../src/lib/deepseek.js';

async function startUpstream(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

test('DeepSeek 客户端发送上下文并解析回答', async (t) => {
  let received;
  const upstream = await startUpstream((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received = {
        authorization: req.headers.authorization,
        body: JSON.parse(body),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [{ message: { role: 'assistant', content: '先看定义，再计算。' } }],
          usage: { prompt_tokens: 100, completion_tokens: 30 },
        }),
      );
    });
  });
  t.after(() => {
    upstream.server.close();
  });

  const client = new DeepSeekClient({
    apiKey: 'sk-test',
    baseUrl: upstream.url,
    model: 'deepseek-chat',
    timeoutMs: 5000,
    maxContextMessages: 4,
  });
  const result = await client.ask({
    question: '求极限',
    context: [
      { role: 'user', content: '上一个问题' },
      { role: 'assistant', content: '上一个回答' },
      { role: 'system', content: '这条应被过滤' },
    ],
  });

  assert.equal(result.answer, '先看定义，再计算。');
  assert.equal(result.model, 'deepseek-chat');
  assert.equal(received.authorization, 'Bearer sk-test');
  assert.equal(received.body.messages[0].role, 'system');
  assert.equal(received.body.messages.at(-1).content, '求极限');
  assert.equal(
    received.body.messages.some((item) => item.content === '这条应被过滤'),
    false,
  );
});

test('图片提问使用 vision 模型和 data URL 内容块', async (t) => {
  let received;
  const upstream = await startUpstream((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'deepseek-flash',
          choices: [{ message: { role: 'assistant', content: '图片里是一个极限。' } }],
        }),
      );
    });
  });
  t.after(() => upstream.server.close());

  const client = new DeepSeekClient({
    apiKey: 'sk-test',
    baseUrl: upstream.url,
    model: 'deepseek-chat',
    visionModel: 'deepseek-flash',
    timeoutMs: 5000,
  });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const result = await client.ask({
    question: '这道题怎么做？',
    image: { buffer: png, mimeType: 'image/png' },
  });
  assert.equal(result.model, 'deepseek-flash');
  assert.equal(received.model, 'deepseek-flash');
  const content = received.messages.at(-1).content;
  assert.equal(content[0].type, 'text');
  assert.equal(content[1].type, 'image_url');
  assert.match(content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(content[1].image_url.detail, 'high');
});

test('DeepSeek API Key 无效时给出可读错误', async (t) => {
  const upstream = await startUpstream((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Authentication Fails' } }));
  });
  t.after(() => upstream.server.close());

  const client = new DeepSeekClient({
    apiKey: 'sk-wrong',
    baseUrl: upstream.url,
    timeoutMs: 5000,
  });
  await assert.rejects(
    () => client.ask({ question: '测试' }),
    (error) => error.code === 'DEEPSEEK_AUTH_ERROR' && /API Key/.test(error.message),
  );
});

test('未配置 API Key 时不发请求', async () => {
  const client = new DeepSeekClient({ apiKey: '' });
  assert.equal(client.configured, false);
  await assert.rejects(
    () => client.ask({ question: '测试' }),
    (error) => error.code === 'DEEPSEEK_NOT_CONFIGURED' && error.status === 503,
  );
});
