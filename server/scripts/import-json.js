#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { SCHEMA_VERSION } from '../src/db/schema.js';
import { aliasCodeFor } from '../src/lib/identity.js';
import { createStore } from '../src/lib/store-factory.js';

function parseFilePath() {
  const fileArgIndex = process.argv.indexOf('--file');
  if (fileArgIndex >= 0 && process.argv[fileArgIndex + 1]) {
    return path.resolve(process.argv[fileArgIndex + 1]);
  }
  return path.join(config.dataDir, 'questions.json');
}

function earliest(current, candidate) {
  if (!current) return candidate;
  if (!candidate) return current;
  return new Date(candidate).getTime() < new Date(current).getTime() ? candidate : current;
}

function latest(current, candidate) {
  if (!current) return candidate;
  if (!candidate) return current;
  return new Date(candidate).getTime() > new Date(current).getTime() ? candidate : current;
}

async function main() {
  if (config.dbDriver !== 'mysql') {
    throw new Error('请先在 server/.env 设置 DB_DRIVER=mysql，再执行迁移。');
  }
  const filePath = parseFilePath();
  const raw = await fs.readFile(filePath, 'utf8');
  const legacy = JSON.parse(raw);
  if (!Array.isArray(legacy.questions) || !Array.isArray(legacy.likes)) {
    throw new Error('旧数据文件结构不正确：需要 questions 和 likes 数组。');
  }

  const activity = new Map();
  const touch = (ownerHash, createdAt) => {
    if (!ownerHash) return;
    const item = activity.get(ownerHash) || { firstAt: null, lastAt: null };
    item.firstAt = earliest(item.firstAt, createdAt);
    item.lastAt = latest(item.lastAt, createdAt);
    activity.set(ownerHash, item);
  };
  for (const question of legacy.questions) {
    touch(question.ownerHash, question.createdAt);
  }
  for (const like of legacy.likes) {
    touch(like.ownerHash, like.createdAt);
  }

  const ownerHashes = [...activity.entries()]
    .sort(([hashA, a], [hashB, b]) => {
      const timeA = new Date(a.firstAt || 0).getTime();
      const timeB = new Date(b.firstAt || 0).getTime();
      return timeA - timeB || hashA.localeCompare(hashB);
    })
    .map(([ownerHash]) => ownerHash);

  const students = ownerHashes.map((ownerHash, index) => {
    const item = activity.get(ownerHash);
    return {
      id: index + 1,
      ownerHash,
      aliasCode: aliasCodeFor(ownerHash),
      createdAt: item.firstAt || new Date().toISOString(),
      lastSeenAt: item.lastAt || item.firstAt || new Date().toISOString(),
    };
  });
  const studentIdByOwner = new Map(students.map((student) => [student.ownerHash, student.id]));

  const questions = legacy.questions.map((question) => ({
    id: question.id,
    studentId: studentIdByOwner.get(question.ownerHash),
    question: question.question,
    answer: question.answer || '',
    model: question.model || null,
    status: question.answer ? 'answered' : 'pending',
    promptTokens: question.usage?.prompt_tokens ?? null,
    completionTokens: question.usage?.completion_tokens ?? null,
    latencyMs: question.latencyMs ?? null,
    createdAt: question.createdAt,
    deletedAt: null,
  }));

  const seenLikes = new Set();
  const likes = [];
  for (const like of legacy.likes) {
    const key = `${like.questionId}:${like.ownerHash}`;
    if (seenLikes.has(key)) continue;
    seenLikes.add(key);
    likes.push({
      questionId: like.questionId,
      studentId: studentIdByOwner.get(like.ownerHash),
      createdAt: like.createdAt,
    });
  }

  const invalidQuestion = questions.find(
    (question) => !question.studentId || !question.createdAt,
  );
  if (invalidQuestion) {
    throw new Error(`旧数据中的问题缺少有效学生或时间：${invalidQuestion.id}`);
  }
  const invalidLike = likes.find((like) => !like.studentId || !like.createdAt);
  if (invalidLike) {
    throw new Error(`旧数据中的点赞缺少有效学生或时间：${invalidLike.questionId}`);
  }

  console.log(`源文件：${filePath}`);
  console.log(
    `待导入：${students.length} 位学生、${questions.length} 条问题、${likes.length} 个点赞`,
  );
  const store = await createStore(config);
  try {
    const imported = await store.importSnapshot({
      schemaVersion: SCHEMA_VERSION,
      students,
      questions,
      likes,
    });
    console.log(
      `导入完成：${imported.students} 位学生、${imported.questions} 条问题、${imported.likes} 个点赞`,
    );
    console.log('旧 JSON 文件未修改。确认新库数据正常后，可自行归档旧文件。');
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(`[import-json] 失败：${error.message}`);
  process.exit(1);
});
