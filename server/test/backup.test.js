import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BackupService,
  normalizeBackupPayload,
  readBackupFile,
} from '../src/lib/backup.js';

function fakeStore() {
  const runs = [];
  return {
    backendType: 'mysql',
    runs,
    async exportSnapshot() {
      return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        counts: { students: 1, questions: 1, likes: 1, resources: 1 },
        students: [
          {
            id: 1,
            ownerHash: 'a'.repeat(64),
            aliasCode: 'AAAA',
            createdAt: '2026-10-31T08:00:00.000Z',
            lastSeenAt: '2026-10-31T08:00:00.000Z',
          },
        ],
        questions: [
          {
            id: 'q_test',
            studentId: 1,
            question: '测试问题',
            answer: '测试回答',
            model: 'deepseek-chat',
            status: 'answered',
            promptTokens: 10,
            completionTokens: 20,
            latencyMs: 800,
            createdAt: '2026-10-31T08:00:00.000Z',
            deletedAt: null,
          },
        ],
        likes: [
          {
            questionId: 'q_test',
            studentId: 1,
            createdAt: '2026-10-31T08:01:00.000Z',
          },
        ],
        resources: [
          {
            id: 'res_test',
            title: '测试讲义',
            category: '讲义',
            description: '',
            fileName: '讲义.pdf',
            extension: 'pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            storageProvider: 'cos',
            storageKey: 'math-analysis-tutor/resources/res_test/test.pdf',
            createdAt: '2026-10-31T08:00:00.000Z',
            updatedAt: '2026-10-31T08:00:00.000Z',
            deletedAt: null,
          },
        ],
      };
    },
    async recordBackupRun(run) {
      runs.push(run);
    },
    async getLatestBackupRun() {
      return null;
    },
  };
}

function baseConfig(localDir) {
  return {
    backupCosConfigured: false,
    backupLocalDir: localDir,
    backupEnabled: false,
    backupCron: '0 3 * * *',
    backupTimezone: 'Asia/Shanghai',
    businessTimezoneOffsetMinutes: 480,
    cosSecretId: '',
    cosSecretKey: '',
    cosBucket: '',
    cosRegion: '',
    cosBackupPrefix: 'math-analysis-tutor/backups/',
  };
}

test('本地备份生成可读取的 gzip 快照', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'math-tutor-backup-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = fakeStore();
  const service = new BackupService({
    config: baseConfig(dir),
    store,
    logger: { info() {}, warn() {}, error() {} },
  });
  await service.init();
  const result = await service.run({ reason: 'test' });

  assert.equal(result.status, 'success');
  assert.equal(result.provider, 'local');
  assert.ok(result.sizeBytes > 0);
  assert.ok(result.localPath.endsWith('.json.gz'));
  assert.equal(store.runs.length, 1);
  assert.equal(store.runs[0].status, 'success');

  const snapshot = await readBackupFile(result.localPath);
  assert.equal(snapshot.students.length, 1);
  assert.equal(snapshot.questions[0].id, 'q_test');
  assert.equal(snapshot.likes.length, 1);
  assert.equal(snapshot.resources.length, 1);
  assert.equal(snapshot.resources[0].title, '测试讲义');
  assert.equal(service.getStatus().configured, true);
  assert.equal(service.getStatus().supported, true);
});

test('COS 上传参数正确且不会泄露密钥', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'math-tutor-cos-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let uploaded = null;
  const config = {
    ...baseConfig(''),
    backupCosConfigured: true,
    cosSecretId: 'secret-id',
    cosSecretKey: 'secret-key',
    cosBucket: 'bucket-1250000000',
    cosRegion: 'ap-guangzhou',
  };
  const service = new BackupService({
    config,
    store: fakeStore(),
    logger: { info() {}, warn() {}, error() {} },
    cosClient: {
      putObject(params, callback) {
        uploaded = params;
        callback(null, {});
      },
    },
  });
  await service.init();
  const result = await service.run({ reason: 'test' });

  assert.equal(result.provider, 'cos');
  assert.ok(uploaded);
  assert.equal(uploaded.Bucket, 'bucket-1250000000');
  assert.equal(uploaded.Region, 'ap-guangzhou');
  assert.match(uploaded.Key, /^math-analysis-tutor\/backups\/\d{4}\/\d{2}\/\d{2}\/math-analysis-backup-.*\.json\.gz$/);
  assert.match(uploaded.Metadata['backup-sha256'], /^[a-f0-9]{64}$/);
  assert.equal(uploaded.Metadata['backup-format'], 'math-analysis-tutor-backup');
  const serializedStatus = JSON.stringify(service.getStatus());
  assert.doesNotMatch(serializedStatus, /secret-id|secret-key/);
});

test('未配置备份目标时明确报错', async () => {
  const service = new BackupService({
    config: baseConfig(''),
    store: fakeStore(),
    logger: { info() {}, warn() {}, error() {} },
  });
  await service.init();
  await assert.rejects(
    () => service.run(),
    (error) => error.code === 'BACKUP_NOT_CONFIGURED' && error.status === 503,
  );
});

test('兼容备份文件外层 data 包装', () => {
  const normalized = normalizeBackupPayload({
    format: 'math-analysis-tutor-backup',
    data: { students: [], questions: [], likes: [] },
  });
  assert.deepEqual(normalized.students, []);
  assert.deepEqual(normalized.questions, []);
  assert.deepEqual(normalized.likes, []);
  assert.equal(normalized.format, 'math-analysis-tutor-backup');
});
