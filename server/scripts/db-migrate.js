#!/usr/bin/env node
import { config } from '../src/config.js';
import { createStore } from '../src/lib/store-factory.js';

async function main() {
  if (config.dbDriver !== 'mysql') {
    throw new Error('当前不是 MySQL 模式，请在 server/.env 设置 DB_DRIVER=mysql。');
  }
  const store = await createStore(config);
  try {
    console.log(`数据库结构已就绪：${store.description}（schema v${store.schemaVersion}）`);
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(`[db:migrate] 失败：${error.message}`);
  process.exit(1);
});
