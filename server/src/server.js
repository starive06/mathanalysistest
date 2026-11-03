import os from 'node:os';
import { createApp } from './app.js';
import { config } from './config.js';
import { createBackupService } from './lib/backup.js';
import { DeepSeekClient } from './lib/deepseek.js';
import { QuestionImageService } from './lib/question-image-service.js';
import { ResourceService } from './lib/resource-service.js';
import { ResourceStorage } from './lib/resource-storage.js';
import { createStore } from './lib/store-factory.js';
import { createWeChatPushService } from './lib/wechat-push.js';

function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

async function main() {
  const store = await createStore(config);
  const backupService = createBackupService({ config, store });
  await backupService.init();
  backupService.start();

  const resourceStorage = new ResourceStorage({ config });
  await resourceStorage.init();
  const resourceService = new ResourceService({
    store,
    storage: resourceStorage,
    config,
  });
  const questionImageStorage = new ResourceStorage({
    config: {
      ...config,
      resourceLocalDir: config.questionImageLocalDir,
      cosResourcePrefix: config.cosQuestionImagePrefix,
      resourceMaxSizeMb: config.questionImageMaxSizeMb,
    },
  });
  await questionImageStorage.init();
  const questionImageService = new QuestionImageService({
    config,
    store,
    storage: questionImageStorage,
  });
  const pushService = createWeChatPushService({ config, store });

  const deepseek = new DeepSeekClient({
    apiKey: config.deepseekApiKey,
    baseUrl: config.deepseekBaseUrl,
    model: config.deepseekModel,
    visionModel: config.deepseekVisionModel,
    timeoutMs: config.deepseekTimeoutMs,
    maxContextMessages: config.maxContextMessages,
  });

  const app = createApp({
    config,
    store,
    deepseek,
    backupService,
    resourceService,
    questionImageService,
    pushService,
  });
  const server = app.listen(config.port, config.host, () => {
    const localUrl = `http://127.0.0.1:${config.port}`;
    console.log('');
    console.log('  数学分析答疑服务已启动');
    console.log(`  教师端：${localUrl}/admin`);
    console.log(`  健康检查：${localUrl}/api/health`);
    console.log(`  数据存储：${store.description}`);
    console.log(`  教学资源存储：${resourceStorage.provider}`);
    console.log(`  答疑图片存储：${questionImageStorage.provider}`);
    console.log(
      `  服务号推送：${pushService.configured ? '已启用' : '未配置'}`,
    );
    if (config.host === '0.0.0.0') {
      for (const address of lanAddresses()) {
        console.log(`  局域网：http://${address}:${config.port}`);
      }
    }
    console.log('');
    if (store.backendType === 'json') {
      console.warn('  ⚠ 当前使用 JSON 本地存储，仅适合开发/演示。上线请设置 DB_DRIVER=mysql。');
    } else {
      console.log(
        `  MySQL：已连接 · 业务时区 UTC+${config.businessTimezoneOffsetMinutes / 60}`,
      );
    }
    if (!deepseek.configured) {
      console.warn('  ⚠ DEEPSEEK_API_KEY 未配置，小程序提问会返回“服务未配置”。');
      console.warn('    请在 server/.env 中填写后重启。');
    } else {
      console.log(
        `  DeepSeek：${config.deepseekModel} / 图片 ${config.deepseekVisionModel}（已配置）`,
      );
    }
    const backupStatus = backupService.getStatus();
    if (backupStatus.configured) {
      console.log(
        `  备份：${backupStatus.provider}${backupStatus.automatic ? ` · ${config.backupCron} (${config.backupTimezone})` : ' · 仅手动'}`,
      );
      if (backupStatus.lastRun?.createdAt) {
        console.log(
          `  最近备份：${backupStatus.lastRun.status} · ${backupStatus.lastRun.createdAt}`,
        );
      }
    } else if (config.backupEnabled) {
      console.warn('  ⚠ BACKUP_ENABLED=true，但备份目标尚未配置。');
    } else {
      console.log('  备份：未启用（可配置 COS 后使用教师后台手动备份）');
    }
    if (config.adminTokenGenerated) {
      console.warn('  ⚠ 未设置 ADMIN_TOKEN，本次使用临时教师口令：');
      console.warn(`    ${config.adminToken}`);
      console.warn('    重启后会变化，请在 .env 中固定。');
    } else {
      console.log('  教师口令：已配置（见 server/.env 的 ADMIN_TOKEN）');
      if (config.adminToken.length < 16) {
        console.warn('  ⚠ 教师口令少于 16 位，建议换成更长的随机字符串。');
      }
    }
    if (config.clientHashSaltGenerated) {
      console.warn('  ⚠ 未设置 CLIENT_HASH_SALT，本次使用临时盐值，重启后历史归属会变化。');
    }
    console.log('');
  });

  server.on('error', (error) => {
    console.error('[server] 启动失败：', error.message);
    process.exitCode = 1;
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[server] 收到 ${signal}，正在停止...`);
    backupService.stop();
    server.close(async () => {
      await store.close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[server] 初始化失败：', error);
  process.exit(1);
});
