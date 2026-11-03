import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import COS from 'cos-nodejs-sdk-v5';
import { AppError } from './errors.js';

function resourceError(code, message, status = 500) {
  return new AppError(status, code, message);
}

/**
 * 教学资源文件存储：
 * - cos：生产环境，文件进入私有 COS，经后端鉴权代理下载
 * - local：本地开发，文件写入 server/uploads/resources
 */
export class ResourceStorage {
  constructor({ config, logger = console, cosClient = null }) {
    this.config = config;
    this.logger = logger;
    this.localRoot = config.resourceLocalDir;
    this.cosConfigured = Boolean(
      config.cosSecretId &&
        config.cosSecretKey &&
        config.cosBucket &&
        config.cosRegion,
    );
    const mode = String(config.resourceStorage || 'auto').toLowerCase();
    if (!['auto', 'cos', 'local'].includes(mode)) {
      throw new Error(`RESOURCE_STORAGE 只能是 auto/cos/local，当前为 ${mode}`);
    }
    if (mode === 'cos' && !this.cosConfigured) {
      throw new Error('RESOURCE_STORAGE=cos，但 COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION 未配置');
    }
    this.provider =
      mode === 'cos' || (mode === 'auto' && this.cosConfigured) ? 'cos' : 'local';
    this.cos =
      cosClient ||
      (this.cosConfigured
        ? new COS({
            SecretId: config.cosSecretId,
            SecretKey: config.cosSecretKey,
          })
        : null);
  }

  async init() {
    await fs.mkdir(this.localRoot, { recursive: true });
    return this;
  }

  createStorageKey(resourceId, extension) {
    const fileName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${extension}`;
    if (this.provider === 'cos') {
      return `${this.config.cosResourcePrefix}${resourceId}/${fileName}`;
    }
    return `${resourceId}/${fileName}`;
  }

  _localPath(key) {
    const target = path.resolve(this.localRoot, key);
    const root = path.resolve(this.localRoot);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw resourceError('RESOURCE_INVALID_PATH', '资源文件路径不合法');
    }
    return target;
  }

  async put(provider, key, buffer, mimeType) {
    if (provider === 'local') {
      const target = this._localPath(key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, buffer);
      return;
    }
    if (provider !== 'cos') {
      throw resourceError('RESOURCE_STORAGE_INVALID', '未知的资源存储类型');
    }
    if (!this.cos || !this.cosConfigured) {
      throw resourceError(
        'RESOURCE_COS_NOT_CONFIGURED',
        '资源存储在 COS，但服务端未配置 COS 凭据。',
        503,
      );
    }
    await new Promise((resolve, reject) => {
      this.cos.putObject(
        {
          Bucket: this.config.cosBucket,
          Region: this.config.cosRegion,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
          ContentLength: buffer.length,
        },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  async getBuffer(provider, key) {
    if (provider === 'local') {
      try {
        return await fs.readFile(this._localPath(key));
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw resourceError('RESOURCE_FILE_MISSING', '资源文件不存在', 404);
        }
        throw error;
      }
    }
    if (provider !== 'cos') {
      throw resourceError('RESOURCE_STORAGE_INVALID', '未知的资源存储类型');
    }
    if (!this.cos || !this.cosConfigured) {
      throw resourceError(
        'RESOURCE_COS_NOT_CONFIGURED',
        '资源存储在 COS，但服务端未配置 COS 凭据。',
        503,
      );
    }

    const signedUrl = await new Promise((resolve, reject) => {
      this.cos.getObjectUrl(
        {
          Bucket: this.config.cosBucket,
          Region: this.config.cosRegion,
          Key: key,
          Sign: true,
          Expires: 300,
        },
        (error, data) => {
          if (error) reject(error);
          else resolve(data.Url);
        },
      );
    });

    let response;
    try {
      response = await fetch(signedUrl, {
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw resourceError(
        'RESOURCE_DOWNLOAD_FAILED',
        `从 COS 下载资源失败：${error.message}`,
        502,
      );
    }
    if (!response.ok) {
      throw resourceError(
        'RESOURCE_DOWNLOAD_FAILED',
        `从 COS 下载资源失败（HTTP ${response.status}）`,
        502,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async remove(provider, key) {
    try {
      if (provider === 'local') {
        await fs.unlink(this._localPath(key));
        return;
      }
      if (provider === 'cos' && this.cos && this.cosConfigured) {
        await new Promise((resolve, reject) => {
          this.cos.deleteObject(
            {
              Bucket: this.config.cosBucket,
              Region: this.config.cosRegion,
              Key: key,
            },
            (error) => (error ? reject(error) : resolve()),
          );
        });
      }
    } catch (error) {
      if (error.code === 'ENOENT') return;
      this.logger.warn(`[resources] 删除旧文件失败 key=${key}：${error.message}`);
    }
  }
}
