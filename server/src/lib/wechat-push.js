import { AppError } from './errors.js';

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const UNIFORM_SEND_URL =
  'https://api.weixin.qq.com/cgi-bin/message/wxopen/template/uniform_send';

function truncate(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`微信接口 HTTP ${response.status}`);
  }
  return payload;
}

class MiniProgramAccessToken {
  constructor({ appId, appSecret, logger }) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.logger = logger;
    this.token = '';
    this.expiresAt = 0;
    this.pending = null;
  }

  async get() {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    if (this.pending) return this.pending;
    this.pending = this.refresh().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async refresh() {
    const url = new URL(TOKEN_URL);
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', this.appId);
    url.searchParams.set('secret', this.appSecret);
    const payload = await fetchJson(url);
    if (!payload?.access_token) {
      throw new Error(
        `获取小程序 access_token 失败：${payload?.errcode || ''} ${payload?.errmsg || ''}`.trim(),
      );
    }
    this.token = payload.access_token;
    this.expiresAt = Date.now() + Math.max(60, Number(payload.expires_in || 7200) - 300) * 1000;
    this.logger.info('[push] 已刷新小程序 access_token');
    return this.token;
  }
}

export class WeChatPushService {
  constructor({ config, store, logger = console }) {
    this.config = config;
    this.store = store;
    this.logger = logger;
    this.configured = Boolean(
      config.wechatPushEnabled &&
        config.miniprogramAppId &&
        config.miniprogramSecret &&
        config.wechatMpAppId &&
        config.wechatMpTemplateId,
    );
    this.tokenClient = this.configured
      ? new MiniProgramAccessToken({
          appId: config.miniprogramAppId,
          appSecret: config.miniprogramSecret,
          logger,
        })
      : null;
  }

  async notifyTeacherComment({ question, comment, studentOwnerHash }) {
    if (!this.configured) {
      this.logger.info('[push] 未配置服务号推送，跳过');
      return { status: 'not_configured' };
    }

    let openid = '';
    try {
      openid = await this.store.getStudentMiniOpenid(studentOwnerHash);
      if (!openid) {
        await this.store.recordPushNotification({
          commentId: comment.id,
          studentOwnerHash,
          status: 'skipped_no_openid',
          errorMessage: '学生尚未绑定微信 openid（未执行 wx.login 或服务端未配置小程序密钥）',
        });
        this.logger.warn(`[push] 学生未绑定 openid comment=${comment.id}`);
        return { status: 'skipped_no_openid' };
      }

      const accessToken = await this.tokenClient.get();
      const payload = await fetchJson(`${UNIFORM_SEND_URL}?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: openid,
          mp_template_msg: {
            appid: this.config.wechatMpAppId,
            template_id: this.config.wechatMpTemplateId,
            url: this.config.wechatMpTemplateUrl || 'https://weixin.qq.com/',
            miniprogram: {
              appid: this.config.miniprogramAppId,
              pagepath: `pages/history/history?focus=${encodeURIComponent(question.id)}`,
            },
            data: {
              first: {
                value: '老师评论了你的提问',
                color: '#173326',
              },
              keyword1: {
                value: truncate(question.question, 20),
                color: '#173326',
              },
              keyword2: {
                value: truncate(comment.content, 50),
                color: '#173326',
              },
              remark: {
                value: '点击进入小程序查看完整评论',
                color: '#7f9386',
              },
            },
          },
        }),
      });

      if (payload?.errcode !== 0) {
        throw new Error(
          `服务号模板消息失败：${payload?.errcode || ''} ${payload?.errmsg || ''}`.trim(),
        );
      }

      await this.store.recordPushNotification({
        commentId: comment.id,
        studentOwnerHash,
        status: 'sent',
        sentAt: new Date(),
      });
      this.logger.info(`[push] 服务号评论通知已发送 comment=${comment.id}`);
      return { status: 'sent' };
    } catch (error) {
      await this.store
        .recordPushNotification({
          commentId: comment.id,
          studentOwnerHash,
          status: 'failed',
          errorMessage: error.message,
        })
        .catch(() => {});
      this.logger.warn(`[push] 服务号通知失败 comment=${comment.id}：${error.message}`);
      return { status: 'failed', message: error.message };
    }
  }
}

export function createWeChatPushService({ config, store, logger = console }) {
  return new WeChatPushService({ config, store, logger });
}

export function ensurePushConfigured(service) {
  if (!service?.configured) {
    throw new AppError(503, 'PUSH_NOT_CONFIGURED', '服务号推送未配置。');
  }
  return service;
}
