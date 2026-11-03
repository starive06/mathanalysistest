# 微信云托管部署指南（方案 A）

目标：保留现有 **Express + 教师后台 + TencentDB MySQL + COS**，把运行环境从轻量服务器改成**微信云托管**。小程序用 `wx.cloud.callContainer` 处理 15 秒内的快速请求；由于 `callContainer` 超时上限为 15 秒，DeepSeek 长问答、图片上传和资源下载复用云托管的公网 HTTPS 域名，并需要配置 request/downloadFile/uploadFile 合法域名。

> 微信云托管需要真实小程序 AppID，并开通微信云开发/云托管。测试号不能用于正式云托管部署。  
> 官方前置条件：小程序需与目标云开发环境关联，且环境中已部署云托管服务。
>
> 官方参考：[微信云托管](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/)、[小程序调用云托管](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/development/call/mini.html)、[Dockerfile 构建](https://docs.cloudbase.net/run/develop/builds/dockerfile)。

```text
微信小程序
   │ wx.cloud.callContainer / X-WX-SERVICE
   ▼
微信云托管 math-tutor 容器
   ├── Express API
   ├── 教师后台 /admin
   ├── TencentDB MySQL（VPC 内网）
   └── COS 备份
```

---

## 1. 需要准备的资源

1. 真实小程序 AppID（个人主体可以）。
2. 微信云开发环境，例如 `prod-xxxxxx`。
3. 微信云托管服务，例如命名为 `math-tutor`。
4. TencentDB for MySQL 8.0。
5. 私有 COS Bucket 和最小权限子账号。
6. 一个可以访问数据库的临时环境，用于首次迁移/导入（或使用腾讯云 DTS）。

> 云托管控制台当前常见地域为上海，实际以你控制台可选地域为准。数据库和 COS 尽量选同一地域，数据库必须和云托管环境 VPC 互通。

---

## 2. 配置数据库

创建数据库：

```sql
CREATE DATABASE math_tutor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

创建业务账号：

```sql
CREATE USER 'math_tutor'@'10.%' IDENTIFIED BY '替换成强密码';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON math_tutor.* TO 'math_tutor'@'10.%';
FLUSH PRIVILEGES;
```

云托管容器需要访问数据库：

- 在云托管/云开发控制台为环境配置 VPC、子网和安全组。
- 在 TencentDB 安全组中放行云托管所在的网段。
- 使用数据库**内网地址**，不要填公网地址。
- 容器内 `MYSQL_SSL=false`（内网）。

具体网络入口名称可能因控制台版本不同而不同，核心是：**云托管环境必须和 TencentDB 在同一个 VPC，或通过云联网/对等连接打通。**

---

## 3. 创建 COS 备份桶

1. Bucket 设为私有读写。
2. 创建 CAM 子用户，授予该 Bucket 的 `PutObject`、`GetObject`、`DeleteObject`（资源删除/替换需要删除对象；答疑图片使用同一组权限）。
3. 记录 `SecretId`、`SecretKey`、Bucket、Region。
4. 设置生命周期，参考 [backup-cos-lifecycle.md](../deploy/backup-cos-lifecycle.md)。

容器文件系统是临时的，**不要使用 `BACKUP_LOCAL_DIR` 做生产备份**，备份必须进 COS。  
教学资源和答疑图片也必须设置 `RESOURCE_STORAGE=cos`，否则容器重启后上传的文件会丢失。建议为资源/图片前缀开启 COS 版本控制。`COS_QUESTION_IMAGE_PREFIX` 默认 `math-analysis-tutor/question-images`。

---

## 4. 部署容器

项目根目录已经包含：

- [Dockerfile](../Dockerfile)
- [.dockerignore](../.dockerignore)

Dockerfile 的特点：

- Node.js 22
- 只安装生产依赖
- 不包含 `.env`、`node_modules`、data、backups
- 非 root 用户运行
- 监听 `0.0.0.0:3000`
- 健康检查 `/api/health`

### 控制台步骤

1. 打开微信云托管控制台。
2. 创建云开发环境，例如 `prod-xxxxxx`。
3. 新建服务：
   - 服务名称：`math-tutor`
   - 部署方式：代码仓库 / 上传代码
   - Dockerfile 路径：`Dockerfile`
   - 构建上下文：项目根目录
4. 服务配置：

| 配置 | 值 |
| --- | --- |
| 容器端口 | `3000` |
| 健康检查路径 | `/api/health` |
| 请求超时 | `120s`（DeepSeek 可能较慢） |
| 最小实例数 | `1` |
| 最大实例数 | `1` |
| 公网访问 | 开启 |
| 微信访问/内网访问 | 开启 |

> 初期务必设置为 **1 个实例**。当前限流和自动备份定时器是进程内实现，多实例会造成备份重复和限流不共享。等改为分布式锁/Redis 后再扩容。

5. 配置环境变量（不要上传 `.env`）：

```text
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_VISION_MODEL=deepseek-flash

ADMIN_TOKEN=足够长的随机字符串
TEACHER_REGISTER_CODE=教师邮箱注册码
COMMENTS_PER_MINUTE=20
CLIENT_HASH_SALT=足够长的随机字符串

# 服务号评论推送（可选；不配置时评论正常保存，只跳过推送）
WECHAT_PUSH_ENABLED=false
MINIPROGRAM_APPID=小程序 AppID
MINIPROGRAM_SECRET=小程序 AppSecret
WECHAT_MP_APPID=同主体服务号 AppID
WECHAT_MP_TEMPLATE_ID=服务号评论模板 ID
WECHAT_MP_TEMPLATE_URL=https://weixin.qq.com/

PORT=3000
HOST=0.0.0.0
DB_DRIVER=mysql
MYSQL_HOST=TencentDB 内网地址
MYSQL_PORT=3306
MYSQL_USER=math_tutor
MYSQL_PASSWORD=...
MYSQL_DATABASE=math_tutor
MYSQL_SSL=false
DB_AUTO_MIGRATE=true

BUSINESS_TIMEZONE_OFFSET_MINUTES=480

BACKUP_ENABLED=true
COS_SECRET_ID=...
COS_SECRET_KEY=...
COS_BUCKET=...
COS_REGION=ap-shanghai
COS_BACKUP_PREFIX=math-analysis-tutor/backups
BACKUP_CRON=0 3 * * *
BACKUP_TIMEZONE=Asia/Shanghai
BACKUP_LOCAL_DIR=

# 教学资源/答疑图片必须使用 COS，容器本地文件不持久化
RESOURCE_STORAGE=cos
COS_RESOURCE_PREFIX=math-analysis-tutor/resources
COS_QUESTION_IMAGE_PREFIX=math-analysis-tutor/question-images
RESOURCE_MAX_SIZE_MB=30
QUESTION_IMAGE_MAX_SIZE_MB=8
```

6. 点击部署，观察构建日志。

首次启动时：

- 自动连接 MySQL
- 自动执行 `schema_migrations` 建表/增量迁移（当前 v4：教师账号、会话、评论、评论点赞、推送记录、答疑图片）
- 健康检查通过后开始接流量

如果数据库尚未初始化，服务日志会明确提示 MySQL 连接/建表错误。

---

## 5. 小程序调用配置

云托管服务部署成功并和当前小程序关联后，修改 [miniprogram/config.js](../miniprogram/config.js)：

```js
const TRANSPORT = 'cloud';

module.exports = {
  transport: TRANSPORT,
  apiBaseUrl: 'http://192.168.1.155:3000', // cloud 模式下不使用
  cloudEnv: 'prod-xxxxxx',                 // 云开发环境 ID
  cloudService: 'math-tutor',              // 云托管服务名称
  // 云托管公网 HTTPS 域名，和教师后台同一域名
  cloudPublicBaseUrl: 'https://math-tutor-xxxxxx.ap-shanghai.app.tcloudbase.com',
  requestTimeout: 90000,
};
```

然后：

1. 重新编译小程序。
2. 在微信公众平台「开发管理 → 开发设置 → 服务器域名」把 `cloudPublicBaseUrl` 加入 **request 合法域名**、**downloadFile 合法域名**；图片提问还要加入 **uploadFile 合法域名**。
3. `app.js` 会在 `onLaunch` 调用 `wx.cloud.init`。
4. 快速业务请求（健康检查、历史、社区、资源列表）通过 `wx.cloud.callContainer`，请求头里带：
   - `X-WX-SERVICE: math-tutor`
   - `X-Client-Id`
5. **DeepSeek 问答**、**图片上传**和**资源文件下载**改走 `cloudPublicBaseUrl`，因为 `callContainer` 的 `timeout` 最大只有 15 秒：
   - 文字问答用 `wx.request`，超时上限 60 秒；
   - 图片提问用 `wx.uploadFile`（`image` 字段）；
   - 下载用 `wx.downloadFile`，再调用 `wx.openDocument`；
   - 三者都需要上面的 request/downloadFile/uploadFile 合法域名配置。
6. 云环境必须已经关联当前小程序；否则 `callContainer` 会返回无权访问。

> 如果没有配置 `cloudPublicBaseUrl`，问答会明确报 `CLOUD_PUBLIC_URL_MISSING`；资源下载会退回 `callContainer` 二进制模式，但超过 15 秒或较大文件可能失败。  
> 资源文件默认最大 30 MB。云托管入口/网关如有请求体大小限制，需要同步调大。

### 切换回本地调试

```js
const TRANSPORT = 'http';
module.exports = {
  transport: TRANSPORT,
  apiBaseUrl: 'http://127.0.0.1:3000',
  cloudEnv: 'prod-xxxxxx',
  cloudService: 'math-tutor',
  cloudPublicBaseUrl: 'https://math-tutor-xxxxxx.ap-shanghai.app.tcloudbase.com',
  requestTimeout: 90000,
};
```

本地模式继续使用 `wx.request`，需要在开发者工具里勾选“不校验合法域名”。

---

## 6. 教师后台

云托管开启公网访问后，控制台会提供 HTTPS 公网域名，例如：

```text
https://math-tutor-xxxxxx.ap-shanghai.app.tcloudbase.com/admin
```

教师用浏览器打开 `/admin`，输入 `ADMIN_TOKEN`。

- 教师后台需要公网访问，因此不要关闭公网入口。
- 这个公网域名同时用于小程序的长问答、图片上传和资源下载，需加入 request + downloadFile + uploadFile 合法域名。
- `wx.cloud.callContainer` 使用私网，只承担 15 秒内的快速请求；它不受教师后台域名影响。
- 如果绑定自定义域名，需要按腾讯云/微信要求完成域名备案。
- 不要公开 `ADMIN_TOKEN`。

> 如果控制台只显示私网域名，请开启“公网访问”或绑定自定义域名后再访问教师端。

### 6.1 教师邮箱账号与服务号推送

首次部署后打开 `/admin`，点「注册教师账号」，注册码填 `TEACHER_REGISTER_CODE`（未设置则用 `ADMIN_TOKEN`）。注册成功后即可用邮箱登录；右上角头像可修改教师名称、对外展示 ID、登录邮箱和密码。

服务号评论推送需要：

1. 云托管环境变量配置 `MINIPROGRAM_APPID` / `MINIPROGRAM_SECRET`，且与 `project.config.json` 的 AppID 一致；
2. 一个与小程序**同主体且已绑定**的服务号，配置 `WECHAT_MP_APPID`；
3. 服务号模板消息模板，字段包含 `first / keyword1 / keyword2 / remark`，配置 `WECHAT_MP_TEMPLATE_ID`；
4. 设置 `WECHAT_PUSH_ENABLED=true`；
5. 学生打开小程序时，服务端用 `wx.login` code 换 openid，并关联匿名身份；
6. 学生关注该服务号，否则公众号模板消息无法送达。

教师评论不会因为推送失败而丢失；推送结果写入 `push_notifications`。未配置时教师端仍可正常评论，学生会通过「我的」和「同学圈」看到评论。

---

## 7. 数据迁移

### 新库、无历史数据

不需要额外操作。部署后第一次启动自动建表。

### 从旧 JSON 导入

在能访问 TencentDB 的机器上运行：

```bash
cd server
DB_DRIVER=mysql \
MYSQL_HOST=数据库地址 \
MYSQL_USER=math_tutor \
MYSQL_PASSWORD=... \
MYSQL_DATABASE=math_tutor \
npm run db:import-json -- --file ./data/questions.json
```

导入脚本只允许写入空数据库，不会覆盖已有数据。

### 从旧 MySQL 迁移

优先使用腾讯云 DTS 迁移到新的 TencentDB 实例；或使用本项目的备份/恢复工具。

---

## 8. 备份

### 自动备份

云托管容器里 `BACKUP_ENABLED=true` 后，按 `BACKUP_CRON` 每天 03:00 上传 COS。

- 最大实例数必须为 `1`，否则多个实例会各自执行 cron。
- 本地备份目录在容器重启后会丢失，生产只使用 COS。
- 备份状态可以继续在教师后台查看，并支持手动触发。
- 备份包含教师账号、评论、评论点赞和答疑图片元数据；教师密码在备份中是 scrypt 哈希，备份文件仍按敏感数据管理；图片/资源文件本体保存在 COS。

### 手动备份

教师后台右上角云朵按钮，或进入云托管实例终端运行：

```bash
npm run backup
```

### 恢复

在能访问数据库的机器或容器终端运行：

```bash
npm run restore -- /path/to/backup.json.gz --yes
```

只允许恢复到空数据库。完整说明见 [腾讯云部署指南](DEPLOY_TENCENT_CLOUD.md) 的备份章节。

---

## 9. 发布与更新

```text
修改代码 → 上传/推送代码 → 云托管重新构建 → 灰度/全量发布
```

发布前：

1. 先做一次手动 COS 备份。
2. 确认环境变量没有把真实 Key 写入镜像。
3. 观察服务日志和 `/api/health`。
4. 验证小程序提问、历史、点赞、教师导出。
5. 在教师后台「教学资源」上传一份 PDF/PPT，确认小程序第四个「资源」Tab 能打开。

`.dockerignore` 已经排除：

- `server/.env`
- `server/data`
- `server/backups`
- `server/uploads`
- `node_modules`
- 小程序、文档、部署文件

---

## 10. 常见问题

**小程序调用 404**  
检查 `path` 是否以 `/api/...` 开头，`X-WX-SERVICE` 是否等于云托管服务名。

**小程序调用无权限/环境错误**  
确认小程序与云开发环境已关联，`cloudEnv` 是环境 ID 而不是环境名称。

**问答提示 `CLOUD_PUBLIC_URL_MISSING` 或 15 秒超时**  
`callContainer` 单次请求上限是 15 秒，DeepSeek 问答不能走它。填写 `cloudPublicBaseUrl`，把该 HTTPS 域名加入 request 合法域名；资源下载还要加入 downloadFile 合法域名。

**资源下载提示域名不合法**  
云托管模式如果配置了 `cloudPublicBaseUrl`，文件下载会走 `wx.downloadFile`；到微信后台把该域名加入 downloadFile 合法域名，或改用开发者工具调试。

**图片上传失败 / 图片不显示**  
把 `cloudPublicBaseUrl` 加入 uploadFile 和 downloadFile 合法域名；检查 `QUESTION_IMAGE_MAX_SIZE_MB`、`RESOURCE_STORAGE=cos` 和 `COS_QUESTION_IMAGE_PREFIX`。图片请求使用 `DEEPSEEK_VISION_MODEL`（默认 `deepseek-flash`）。

**本地能跑，云托管启动失败**  
看构建日志和服务日志；常见原因是数据库 VPC 不通、环境变量缺失、端口不是 3000。

**健康检查 503**  
`/api/health` 在数据库不可用时返回 503。检查 MySQL 内网地址、安全组和账号权限。

**教师后台打不开**  
云托管公网访问未开启，或使用了私网域名；开启公网访问并使用控制台提供的 HTTPS 地址。

**COS 备份失败**  
检查容器到 COS 的出网、子账号权限、Bucket/Region；容器本地备份不是持久化存储。

**资源上传 413 / 学生打开失败**  
检查 `RESOURCE_MAX_SIZE_MB`、云托管入口请求体限制；资源必须 `RESOURCE_STORAGE=cos`，并确认子账号有 `PutObject/GetObject/DeleteObject`。学生端通过 `callContainer` 以 `arraybuffer` 下载，超大文件建议改 COS 签名 URL。

**小程序真机还是旧地址**  
确认 `transport: 'cloud'`、重新编译/上传，并在基础库支持 `wx.cloud` 的环境运行。

---

## 11. 限制

- 云托管需要真实小程序 AppID，测试号不支持正式部署。
- 腾讯云开发云托管官方当前支持地域为上海，具体以控制台为准。
- 当前为单实例设计：限流、备份定时器均为进程内状态。
- 支持多个教师邮箱账号，但所有教师共用同一管理权限，没有角色/审计分级；旧 `ADMIN_TOKEN` 仍可应急登录。
- 学生身份仍是本机匿名 `clientId`；小程序 openid 只用于服务号评论推送，不是跨设备登录。
- 服务号模板消息要求用户已关注服务号，未关注时推送会失败，但评论仍会保存并在小程序内显示。
