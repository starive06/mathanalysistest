import assert from 'node:assert/strict';
import test from 'node:test';
import { WeChatPushService } from '../src/lib/wechat-push.js';

function makeConfig(overrides = {}) {
  return {
    wechatPushEnabled: true,
    miniprogramAppId: 'wx-mini-test',
    miniprogramSecret: 'mini-secret',
    wechatMpAppId: 'wx-mp-test',
    wechatMpTemplateId: 'template-comment-test',
    wechatMpTemplateUrl: 'https://example.com/notice',
    ...overrides,
  };
}

test('教师评论服务号推送使用小程序 openid 和公众号模板', async (t) => {
  const notifications = [];
  const store = {
    async getStudentMiniOpenid(ownerHash) {
      assert.equal(ownerHash, 'student-owner-hash');
      return 'mini-openid-1';
    },
    async recordPushNotification(record) {
      notifications.push(record);
    },
  };
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/cgi-bin/token')) {
      return new Response(
        JSON.stringify({ access_token: 'access-token-1', expires_in: 7200 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const service = new WeChatPushService({
    config: makeConfig(),
    store,
    logger: { info() {}, warn() {}, error() {} },
  });
  const result = await service.notifyTeacherComment({
    question: { id: 'q_1', question: '为什么这个极限存在？' },
    comment: { id: 'cm_1', content: '先看左右极限是否相等。' },
    studentOwnerHash: 'student-owner-hash',
  });
  assert.equal(result.status, 'sent');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /cgi-bin\/token/);
  assert.match(calls[1].url, /uniform_send/);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.touser, 'mini-openid-1');
  assert.equal(body.mp_template_msg.appid, 'wx-mp-test');
  assert.equal(body.mp_template_msg.template_id, 'template-comment-test');
  assert.equal(body.mp_template_msg.miniprogram.appid, 'wx-mini-test');
  assert.equal(body.mp_template_msg.miniprogram.pagepath, 'pages/history/history?focus=q_1');
  assert.match(body.mp_template_msg.data.keyword2.value, /左右极限/);
  assert.equal(notifications[0].status, 'sent');
});

test('没有小程序 openid 时记录跳过状态', async () => {
  const notifications = [];
  const service = new WeChatPushService({
    config: makeConfig(),
    store: {
      async getStudentMiniOpenid() {
        return '';
      },
      async recordPushNotification(record) {
        notifications.push(record);
      },
    },
    logger: { info() {}, warn() {}, error() {} },
  });
  const result = await service.notifyTeacherComment({
    question: { id: 'q_2', question: '问题' },
    comment: { id: 'cm_2', content: '评论' },
    studentOwnerHash: 'owner',
  });
  assert.equal(result.status, 'skipped_no_openid');
  assert.equal(notifications[0].status, 'skipped_no_openid');
});

test('未配置推送时不调用微信接口', async () => {
  const service = new WeChatPushService({
    config: makeConfig({ wechatPushEnabled: false }),
    store: {},
    logger: { info() {}, warn() {}, error() {} },
  });
  assert.equal(service.configured, false);
  const result = await service.notifyTeacherComment({
    question: { id: 'q_3', question: '问题' },
    comment: { id: 'cm_3', content: '评论' },
    studentOwnerHash: 'owner',
  });
  assert.equal(result.status, 'not_configured');
});
