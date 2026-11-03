import { MySQLQuestionStore } from './mysql-store.js';
import { QuestionStore } from './store.js';

/**
 * 线上使用 MySQL；本地没有数据库时保留 JSON 模式，便于演示和自动化测试。
 */
export async function createStore(config, logger = console) {
  if (config.dbDriver === 'mysql') {
    const store = new MySQLQuestionStore({
      host: config.mysqlHost,
      port: config.mysqlPort,
      user: config.mysqlUser,
      password: config.mysqlPassword,
      database: config.mysqlDatabase,
      connectionLimit: config.mysqlConnectionLimit,
      ssl: config.mysqlSsl,
      autoMigrate: config.dbAutoMigrate,
      hashSalt: config.clientHashSalt,
      businessTimezoneOffsetMinutes: config.businessTimezoneOffsetMinutes,
      logger,
    });
    await store.init();
    return store;
  }

  const store = new QuestionStore({
    dataDir: config.dataDir,
    hashSalt: config.clientHashSalt,
    businessTimezoneOffsetMinutes: config.businessTimezoneOffsetMinutes,
  });
  await store.init();
  return store;
}
