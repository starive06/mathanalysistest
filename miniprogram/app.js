const config = require('./config');
const api = require('./utils/api');
const { getClientId } = require('./utils/client');

App({
  globalData: {
    pendingQuestionId: null,
    clientId: '',
    transport: config.transport,
  },

  onLaunch() {
    this.globalData.clientId = getClientId();
    if (config.transport === 'cloud') {
      if (!wx.cloud || typeof wx.cloud.init !== 'function') {
        console.error('当前基础库不支持 wx.cloud，无法使用微信云托管调用模式。');
        return;
      }
      wx.cloud.init({
        env: config.cloudEnv || undefined,
        traceUser: true,
      });
    }
    this.bindWeChatIdentity();
  },

  bindWeChatIdentity() {
    if (typeof wx.login !== 'function') return;
    wx.login({
      success: (result) => {
        if (!result.code) return;
        api.bindWeChatIdentity(result.code).catch(() => {
          // 推送未配置时不打扰学生；教师评论仍可在历史页查看。
        });
      },
    });
  },

  onShow() {
    if (!this.globalData.clientId) {
      this.globalData.clientId = getClientId();
    }
  },
});
