#!/usr/bin/env node
import path from 'node:path';
import { config } from '../src/config.js';
import { readBackupFile } from '../src/lib/backup.js';
import { createStore } from '../src/lib/store-factory.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  const positional = args.filter((arg, index) => {
    if (arg === '--yes' || arg === '--file') return false;
    return fileIndex < 0 || index !== fileIndex + 1;
  });
  const filePath = fileIndex >= 0 ? args[fileIndex + 1] : positional[0];
  return {
    filePath: filePath ? path.resolve(filePath) : '',
    confirmed: args.includes('--yes'),
  };
}

async function main() {
  if (config.dbDriver !== 'mysql') {
    throw new Error('恢复备份需要 DB_DRIVER=mysql。');
  }
  const { filePath, confirmed } = parseArgs();
  if (!filePath) {
    throw new Error('用法：npm run restore -- /path/to/backup.json.gz --yes');
  }
  if (!confirmed) {
    throw new Error(
      '恢复是破坏性操作，只允许导入空数据库。确认目标库为空后追加 --yes。',
    );
  }

  const snapshot = await readBackupFile(filePath);
  console.log(
    `备份内容：${snapshot.students.length} 位学生、${snapshot.questions.length} 条问题、${snapshot.likes.length} 个点赞`,
  );
  const store = await createStore(config);
  try {
    const result = await store.importSnapshot(snapshot);
    console.log(
      `恢复完成：${result.students} 位学生、${result.questions} 条问题、${result.likes} 个点赞`,
    );
    console.log('请重启后端服务，并再次检查教师后台数据。');
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(`[restore] 失败：${error.message}`);
  process.exit(1);
});
