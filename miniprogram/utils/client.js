const STORAGE_KEY = 'math_tutor_client_id_v1';
const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function createClientId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let randomPart = '';
  for (let index = 0; index < 24; index += 1) {
    randomPart += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `stu_${Date.now().toString(36)}_${randomPart}`;
}

/**
 * 本机匿名身份。后端只保存它的加盐 SHA-256 哈希。
 * 清理小程序缓存/存储后，旧提问将无法再归属到这台设备。
 */
function getClientId() {
  try {
    const stored = wx.getStorageSync(STORAGE_KEY);
    if (typeof stored === 'string' && ID_PATTERN.test(stored)) return stored;
  } catch (error) {
    // 存储不可用时继续生成临时身份，保证本次会话能提问。
  }

  const clientId = createClientId();
  try {
    wx.setStorageSync(STORAGE_KEY, clientId);
  } catch (error) {
    // 忽略写入失败。
  }
  return clientId;
}

module.exports = {
  getClientId,
};
