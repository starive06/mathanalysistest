#!/usr/bin/env node
import { config } from '../src/config.js';
import { createBackupService } from '../src/lib/backup.js';
import { createStore } from '../src/lib/store-factory.js';

async function main() {
  if (config.dbDriver !== 'mysql') {
    throw new Error('在线备份只支持 MySQL，请设置 DB_DRIVER=mysql。');
  }
  const store = await createStore(config);
  const service = createBackupService({ config, store });
  await service.init();
  if (!service.configured) {
    throw new Error('未配置 COS_* 或 BACKUP_LOCAL_DIR，无法备份。');
  }
  try {
    const result = await service.run({ reason: 'cli' });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(`[backup] 失败：${error.message}`);
  process.exit(1);
});
