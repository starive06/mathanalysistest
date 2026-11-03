import crypto from 'node:crypto';
import { AppError } from './errors.js';

const IMAGE_TYPES = {
  jpg: { mimeType: 'image/jpeg', extensions: ['jpg', 'jpeg'] },
  png: { mimeType: 'image/png', extensions: ['png'] },
  gif: { mimeType: 'image/gif', extensions: ['gif'] },
  webp: { mimeType: 'image/webp', extensions: ['webp'] },
};

export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', mimeType: IMAGE_TYPES.jpg.mimeType };
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { extension: 'png', mimeType: IMAGE_TYPES.png.mimeType };
  }
  const gifHeader = buffer.subarray(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return { extension: 'gif', mimeType: IMAGE_TYPES.gif.mimeType };
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: 'webp', mimeType: IMAGE_TYPES.webp.mimeType };
  }
  return null;
}

export class QuestionImageService {
  constructor({ config, store, storage, logger = console }) {
    this.config = config;
    this.store = store;
    this.storage = storage;
    this.logger = logger;
    this.maxSizeBytes = (Number(config.questionImageMaxSizeMb) || 8) * 1024 * 1024;
  }

  validate(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
      throw new AppError(400, 'IMAGE_EMPTY', '图片为空，请重新选择。');
    }
    if (buffer.length > this.maxSizeBytes) {
      throw new AppError(
        413,
        'IMAGE_TOO_LARGE',
        `图片不能超过 ${Math.round(this.maxSizeBytes / 1024 / 1024)} MB，请压缩后重试。`,
      );
    }
    const type = detectImageType(buffer);
    if (!type) {
      throw new AppError(
        400,
        'IMAGE_FORMAT_UNSUPPORTED',
        '只支持 JPEG、PNG、GIF、WebP 图片。',
      );
    }
    return type;
  }

  async save(buffer) {
    const type = this.validate(buffer);
    const token = crypto.randomBytes(24).toString('hex');
    const provider = this.storage.provider;
    const storageKey = this.storage.createStorageKey(`qimg_${token}`, type.extension);
    await this.storage.put(provider, storageKey, buffer, type.mimeType);
    return {
      token,
      storageProvider: provider,
      storageKey,
      mimeType: type.mimeType,
      extension: type.extension,
      sizeBytes: buffer.length,
    };
  }

  async getByToken(token) {
    if (!/^[a-f0-9]{48}$/.test(String(token || ''))) return null;
    const record = await this.store.getQuestionByImageToken(token);
    if (!record) return null;
    const buffer = await this.storage.getBuffer(
      record.imageProvider,
      record.imageKey,
    );
    return {
      buffer,
      mimeType: record.imageMimeType,
      sizeBytes: record.imageSizeBytes || buffer.length,
      fileName: `question-${token}.${record.imageMimeType.split('/')[1] || 'jpg'}`,
    };
  }

  async remove(image) {
    if (!image) return;
    await this.storage.remove(image.storageProvider, image.storageKey);
  }
}
