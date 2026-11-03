import crypto from 'node:crypto';
import path from 'node:path';
import { AppError } from './errors.js';

export const RESOURCE_CATEGORIES = [
  '讲义',
  '课件',
  '作业题',
  '作业题答案',
  '练习题',
  '模拟试卷',
];

export const RESOURCE_FILE_TYPES = {
  ppt: {
    mimeType: 'application/vnd.ms-powerpoint',
    label: 'PPT',
  },
  pptx: {
    mimeType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    label: 'PPT',
  },
  doc: {
    mimeType: 'application/msword',
    label: 'Word',
  },
  docx: {
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word',
  },
  pdf: {
    mimeType: 'application/pdf',
    label: 'PDF',
  },
};

function badRequest(code, message) {
  return new AppError(400, code, message);
}

function normalizeText(value, maxLength, fieldName) {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) {
    throw badRequest('RESOURCE_INVALID_TEXT', `${fieldName}不能超过 ${maxLength} 个字符`);
  }
  return text;
}

function validateCategory(category) {
  const value = String(category || '').trim();
  if (!RESOURCE_CATEGORIES.includes(value)) {
    throw badRequest('RESOURCE_INVALID_CATEGORY', '资源分类不合法');
  }
  return value;
}

/**
 * multipart 的 filename 在部分 Node/浏览器组合下会被按 latin1 解码。
 * 这里将典型的 UTF-8 乱码还原；已经是中文的名字保持不变。
 */
function decodeMultipartFileName(value) {
  const raw = String(value || '');
  if (!/[\u0080-\u00FF]/.test(raw) || /[\u3400-\u9FFF]/.test(raw)) return raw;
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? raw : decoded;
}

function validateFile(file, maxSizeBytes) {
  if (!file || !file.buffer || !file.originalname) {
    throw badRequest('RESOURCE_FILE_REQUIRED', '请选择要上传的资源文件');
  }
  const originalName = decodeMultipartFileName(file.originalname)
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 255);
  const extension = path.extname(originalName).replace(/^\./, '').toLowerCase();
  const type = RESOURCE_FILE_TYPES[extension];
  if (!type) {
    throw badRequest(
      'RESOURCE_FILE_TYPE',
      '只支持 PPT、Word（doc/docx）和 PDF 文件',
    );
  }
  if (!file.buffer.length) {
    throw badRequest('RESOURCE_EMPTY_FILE', '上传的文件为空');
  }
  if (file.buffer.length > maxSizeBytes) {
    throw new AppError(
      413,
      'RESOURCE_TOO_LARGE',
      `资源文件不能超过 ${Math.round(maxSizeBytes / 1024 / 1024)} MB`,
    );
  }
  return {
    originalName,
    extension,
    mimeType: type.mimeType,
    fileTypeLabel: type.label,
    sizeBytes: file.buffer.length,
  };
}

function publicResource(resource) {
  return {
    id: resource.id,
    title: resource.title,
    category: resource.category,
    description: resource.description || '',
    fileName: resource.fileName,
    extension: resource.extension,
    fileTypeLabel:
      RESOURCE_FILE_TYPES[resource.extension]?.label ||
      String(resource.extension || '').toUpperCase(),
    mimeType: resource.mimeType,
    sizeBytes: Number(resource.sizeBytes || 0),
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  };
}

export class ResourceService {
  constructor({ store, storage, config, logger = console }) {
    this.store = store;
    this.storage = storage;
    this.config = config;
    this.logger = logger;
    const maxSizeMb = Number(config.resourceMaxSizeMb) || 30;
    this.maxSizeBytes = maxSizeMb * 1024 * 1024;
  }

  async listPublic(category = '') {
    const normalizedCategory = category ? validateCategory(category) : '';
    const resources = await this.store.listResources({ category: normalizedCategory });
    return resources.map(publicResource);
  }

  async listAdmin() {
    const resources = await this.store.listResources({});
    return resources.map(publicResource);
  }

  async create({ title, category, description, file }) {
    const normalizedTitle = normalizeText(title, 200, '标题');
    if (!normalizedTitle) throw badRequest('RESOURCE_TITLE_REQUIRED', '请填写资源标题');
    const normalizedCategory = validateCategory(category);
    const normalizedDescription = normalizeText(description, 1000, '简介');
    const fileInfo = validateFile(file, this.maxSizeBytes);
    const id = `res_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
    const storageKey = this.storage.createStorageKey(id, fileInfo.extension);
    const provider = this.storage.provider;

    await this.storage.put(provider, storageKey, file.buffer, fileInfo.mimeType);
    try {
      const created = await this.store.createResource({
        id,
        title: normalizedTitle,
        category: normalizedCategory,
        description: normalizedDescription,
        fileName: fileInfo.originalName,
        extension: fileInfo.extension,
        mimeType: fileInfo.mimeType,
        sizeBytes: fileInfo.sizeBytes,
        storageProvider: provider,
        storageKey,
      });
      this.logger.info(`[resources] created id=${id} provider=${provider} size=${fileInfo.sizeBytes}`);
      return publicResource(created);
    } catch (error) {
      await this.storage.remove(provider, storageKey);
      throw error;
    }
  }

  async update(id, { title, category, description, file }) {
    const existing = await this.store.getResource(id);
    if (!existing) {
      throw new AppError(404, 'RESOURCE_NOT_FOUND', '教学资源不存在或已被删除');
    }
    const normalizedTitle =
      title === undefined ? existing.title : normalizeText(title, 200, '标题');
    if (!normalizedTitle) throw badRequest('RESOURCE_TITLE_REQUIRED', '请填写资源标题');
    const normalizedCategory =
      category === undefined ? existing.category : validateCategory(category);
    const normalizedDescription =
      description === undefined
        ? existing.description
        : normalizeText(description, 1000, '简介');

    let fileFields = {
      fileName: existing.fileName,
      extension: existing.extension,
      mimeType: existing.mimeType,
      sizeBytes: existing.sizeBytes,
      storageProvider: existing.storageProvider,
      storageKey: existing.storageKey,
    };
    let newStorage = null;

    if (file) {
      const fileInfo = validateFile(file, this.maxSizeBytes);
      const provider = this.storage.provider;
      const storageKey = this.storage.createStorageKey(id, fileInfo.extension);
      await this.storage.put(provider, storageKey, file.buffer, fileInfo.mimeType);
      newStorage = { provider, storageKey };
      fileFields = {
        fileName: fileInfo.originalName,
        extension: fileInfo.extension,
        mimeType: fileInfo.mimeType,
        sizeBytes: fileInfo.sizeBytes,
        storageProvider: provider,
        storageKey,
      };
    }

    try {
      const updated = await this.store.updateResource(id, {
        title: normalizedTitle,
        category: normalizedCategory,
        description: normalizedDescription,
        ...fileFields,
      });
      if (!updated) {
        if (newStorage) await this.storage.remove(newStorage.provider, newStorage.storageKey);
        throw new AppError(404, 'RESOURCE_NOT_FOUND', '教学资源不存在或已被删除');
      }
      if (
        newStorage &&
        (existing.storageProvider !== newStorage.provider ||
          existing.storageKey !== newStorage.storageKey)
      ) {
        await this.storage.remove(existing.storageProvider, existing.storageKey);
      }
      this.logger.info(`[resources] updated id=${id}${newStorage ? ' file=replaced' : ''}`);
      return publicResource(updated);
    } catch (error) {
      if (newStorage) {
        await this.storage.remove(newStorage.provider, newStorage.storageKey);
      }
      throw error;
    }
  }

  async delete(id) {
    const existing = await this.store.getResource(id);
    if (!existing) {
      throw new AppError(404, 'RESOURCE_NOT_FOUND', '教学资源不存在或已被删除');
    }
    const deleted = await this.store.deleteResource(id);
    if (!deleted) {
      throw new AppError(404, 'RESOURCE_NOT_FOUND', '教学资源不存在或已被删除');
    }
    await this.storage.remove(existing.storageProvider, existing.storageKey);
    this.logger.info(`[resources] deleted id=${id}`);
    return true;
  }

  async getFile(id) {
    const resource = await this.store.getResource(id);
    if (!resource) {
      throw new AppError(404, 'RESOURCE_NOT_FOUND', '教学资源不存在或已被删除');
    }
    const buffer = await this.storage.getBuffer(
      resource.storageProvider,
      resource.storageKey,
    );
    return {
      buffer,
      fileName: resource.fileName,
      mimeType: resource.mimeType,
      extension: resource.extension,
      title: resource.title,
    };
  }
}
