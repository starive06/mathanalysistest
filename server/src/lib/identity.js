import crypto from 'node:crypto';

/**
 * 学生匿名身份只保存加盐哈希，避免把可用于关联的原始 clientId 写入数据库。
 */
export function hashClientId(salt, clientId) {
  return crypto
    .createHash('sha256')
    .update(`${salt}:${clientId}`)
    .digest('hex');
}

export function aliasCodeFor(ownerHash) {
  return String(ownerHash || '').slice(0, 4).toUpperCase() || '????';
}

export function aliasFor(ownerHash) {
  return `匿名同学 ${aliasCodeFor(ownerHash)}`;
}
