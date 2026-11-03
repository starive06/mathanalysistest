import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { ResourceStorage } from '../src/lib/resource-storage.js';

test('资源 COS 存储路径、上传、下载和删除', async (t) => {
  let storedBody = Buffer.from('no content');
  let deletedKey = '';
  const fileServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end(storedBody);
  });
  fileServer.listen(0, '127.0.0.1');
  await once(fileServer, 'listening');
  const fileUrl = `http://127.0.0.1:${fileServer.address().port}/signed-object`;
  t.after(() => fileServer.close());

  const cosClient = {
    putObject(params, callback) {
      storedBody = Buffer.from(params.Body);
      callback(null, {});
    },
    getObjectUrl(params, callback) {
      callback(null, { Url: fileUrl });
    },
    deleteObject(params, callback) {
      deletedKey = params.Key;
      callback(null, {});
    },
  };

  const storage = await new ResourceStorage({
    config: {
      resourceStorage: 'cos',
      resourceLocalDir: 'unused',
      cosSecretId: 'id',
      cosSecretKey: 'key',
      cosBucket: 'bucket-1250000000',
      cosRegion: 'ap-shanghai',
      cosResourcePrefix: 'math-analysis-tutor/resources/',
    },
    logger: { info() {}, warn() {}, error() {} },
    cosClient,
  }).init();

  assert.equal(storage.provider, 'cos');
  const key = storage.createStorageKey('res_123', 'pdf');
  assert.match(key, /^math-analysis-tutor\/resources\/res_123\/.+\.pdf$/);

  const source = Buffer.from('%PDF-1.4 cos content');
  await storage.put('cos', key, source, 'application/pdf');
  assert.deepEqual(storedBody, source);

  const downloaded = await storage.getBuffer('cos', key);
  assert.deepEqual(downloaded, source);

  await storage.remove('cos', key);
  assert.equal(deletedKey, key);
});
