/**
 * 后端连接方式。
 *
 * transport = 'http'
 *   本地开发者工具或自建服务器。apiBaseUrl 填本机/局域网/HTTPS 地址。
 *   开发者工具调试时需勾选“不校验合法域名...”。
 *   真机打开教学资源/图片需要 downloadFile 合法域名；图片提问需要 uploadFile 合法域名。
 *
 * transport = 'cloud'
 *   微信云托管 CloudBase Run。通过 wx.cloud.callContainer 走私网调用，
 *   不占用 request 合法域名，也不需要单独给小程序配置公网域名。
 *   cloudEnv 填云开发环境 ID，cloudService 填云托管服务名称。
 */
const TRANSPORT = 'http'; // 上线微信云托管后改成 'cloud'

module.exports = {
  transport: TRANSPORT,

  // transport = 'http' 时使用
  apiBaseUrl: 'http://192.168.1.155:3000',

  // transport = 'cloud' 时使用
  cloudEnv: 'prod-xxxxxxxx', // 例如 prod-7gxxxxxx；以云开发控制台为准
  cloudService: 'math-tutor', // 云托管服务名称，必须和 X-WX-SERVICE 一致

  // 云托管的公网 HTTPS 域名（教师后台同一域名）。
  // callContainer 单次请求最长只有 15 秒，DeepSeek 问答和资源下载改走这个域名。
  // 需要在微信后台把该域名加入 request + downloadFile + uploadFile 合法域名。
  cloudPublicBaseUrl: '', // 例如 https://math-tutor-xxxx.ap-shanghai.run.tcloudbase.com

  requestTimeout: 90000,
};
