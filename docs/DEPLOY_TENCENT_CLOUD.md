# 腾讯云部署指南

目标架构：

```text
微信小程序 ──HTTPS──┐
                    ├── Nginx ── Node/Express ── TencentDB for MySQL
教师浏览器 ──HTTPS──┘                    │
                                        └── COS（应用级备份）
```

适用的部署组合：

- 腾讯云轻量应用服务器 / CVM（Ubuntu 22.04）
- TencentDB for MySQL 8.0（与服务器同 VPC、内网互通）
- 腾讯云 COS 私有 Bucket
- 已备案域名 + HTTPS 证书

> 如果域名没有完成 ICP 备案，正式小程序无法稳定使用大陆服务器。可先用微信开发者工具本地调试，或改用微信云开发。

---

## 1. 购买与网络

### 服务器

购买轻量应用服务器或 CVM，建议：

- Ubuntu 22.04 LTS
- 2 核 2 GB 起步
- 与数据库同地域、同 VPC
- 防火墙只放行：`22`（限制来源 IP）、`80`、`443`

不要对公网开放 `3000` 和 `3306`。

### MySQL

在腾讯云控制台创建 **TencentDB for MySQL 8.0**：

1. 地域与服务器一致。
2. 网络选择同一个 VPC；记录**内网地址**。
3. 创建数据库：

```sql
CREATE DATABASE math_tutor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

4. 创建业务账号，例如 `math_tutor`，只授权该数据库：

```sql
CREATE USER 'math_tutor'@'10.%' IDENTIFIED BY '替换成强密码';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON math_tutor.* TO 'math_tutor'@'10.%';
FLUSH PRIVILEGES;
```

5. 数据库安全组只允许应用服务器的内网 IP 访问 `3306`。
6. 开启腾讯云数据库的**自动备份**，这是数据库层面的第一层保护；本项目的 COS 备份是第二层。

> 服务器使用数据库内网地址时，`MYSQL_SSL=false`。如果通过公网访问数据库，应开启 SSL 并配置 CA，同时限制公网访问。

---

## 2. COS 备份

1. 创建 COS Bucket：
   - 私有读写
   - 地域与服务器一致，例如 `ap-guangzhou`
   - 记录 Bucket 名称，例如 `math-tutor-backup-1250000000`
2. 在「访问管理 CAM」创建子用户，只授予该 Bucket 的：
   - `PutObject`
   - `GetObject`
   - `DeleteObject`（教学资源删除或替换文件时需要）
3. 保存子用户的 `SecretId` / `SecretKey`，只写入服务器 `.env`，不要写进代码或小程序。
4. 在 COS 控制台为该前缀设置生命周期，参考 [backup-cos-lifecycle.md](../deploy/backup-cos-lifecycle.md)。

应用备份路径：

```text
math-analysis-tutor/backups/YYYY/MM/DD/math-analysis-backup-YYYYMMDD-HHmmssSSS.json.gz
```

教学资源路径（同一 Bucket，建议单独设置版本控制）：

```text
math-analysis-tutor/resources/<resource-id>/<file>
```

---

## 3. 域名与 HTTPS

1. 域名完成 ICP 备案。
2. 添加 DNS A 记录，例如：

```text
math.example.com → 服务器公网 IP
```

3. 安装 Nginx、Certbot：

```bash
sudo apt update
sudo apt install -y nginx certbot
```

4. 首次申请证书（此时 Nginx 未占用 80 端口或先停止 Nginx）：

```bash
sudo systemctl stop nginx
sudo certbot certonly --standalone -d math.example.com
sudo systemctl start nginx
```

5. 复制项目提供的 Nginx 配置：

```bash
sudo cp deploy/nginx-math-tutor.conf /etc/nginx/sites-available/math-tutor
sudo ln -s /etc/nginx/sites-available/math-tutor /etc/nginx/sites-enabled/math-tutor
```

把文件里的 `math.example.com` 和证书路径改成你的域名，然后：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

6. 验证：

```bash
curl -I https://math.example.com/admin
```

项目 Nginx 示例已把 `client_max_body_size` 设为 `35m`，用于 30MB 教学资源上传；如果调大 `RESOURCE_MAX_SIZE_MB`，Nginx 也要同步调大。

> 首次部署时 HSTS 建议先不加，确认 HTTPS 正常后再启用；否则证书配置错误会让域名难以访问。

---

## 4. 部署 Node 服务

### 安装 Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

### 上传项目

在本地把项目上传到服务器（建议用 `rsync` 或私有 Git 仓库），例如：

```bash
sudo mkdir -p /opt/math-analysis-tutor
sudo chown -R "$USER":"$USER" /opt/math-analysis-tutor
rsync -av --delete \
  --exclude node_modules \
  --exclude .env \
  --exclude data \
  ./math-analysis-tutor/ ubuntu@服务器IP:/opt/math-analysis-tutor/
```

在服务器安装依赖：

```bash
cd /opt/math-analysis-tutor/server
npm ci --omit=dev
```

### 配置 `.env`

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

至少填写：

```dotenv
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_VISION_MODEL=deepseek-flash
ADMIN_TOKEN=至少32位随机字符串
TEACHER_REGISTER_CODE=教师邮箱注册码
COMMENTS_PER_MINUTE=20
CLIENT_HASH_SALT=至少32位随机字符串

# 服务号评论推送（可选）
WECHAT_PUSH_ENABLED=false
MINIPROGRAM_APPID=小程序 AppID
MINIPROGRAM_SECRET=小程序 AppSecret
WECHAT_MP_APPID=同主体服务号 AppID
WECHAT_MP_TEMPLATE_ID=服务号评论模板 ID
WECHAT_MP_TEMPLATE_URL=https://weixin.qq.com/

DB_DRIVER=mysql
MYSQL_HOST=腾讯云数据库内网地址
MYSQL_PORT=3306
MYSQL_USER=math_tutor
MYSQL_PASSWORD=数据库强密码
MYSQL_DATABASE=math_tutor

BACKUP_ENABLED=true
COS_SECRET_ID=...
COS_SECRET_KEY=...
COS_BUCKET=math-tutor-backup-1250000000
COS_REGION=ap-guangzhou
COS_BACKUP_PREFIX=math-analysis-tutor/backups
BACKUP_CRON=0 3 * * *
BACKUP_TIMEZONE=Asia/Shanghai

# 教学资源/答疑图片：生产使用 COS
RESOURCE_STORAGE=cos
COS_RESOURCE_PREFIX=math-analysis-tutor/resources
COS_QUESTION_IMAGE_PREFIX=math-analysis-tutor/question-images
RESOURCE_MAX_SIZE_MB=30
QUESTION_IMAGE_MAX_SIZE_MB=8
```

生成随机值：

```bash
openssl rand -base64 32
```

注意：

- 教师端支持邮箱注册/登录、资料和密码修改；旧 `ADMIN_TOKEN` 仍可应急登录，但不能修改资料。
- 注册码默认使用 `TEACHER_REGISTER_CODE`，未设置则使用 `ADMIN_TOKEN`；请使用长随机值，不要复用数据库密码。
- 服务号推送需要同主体服务号、模板消息和用户关注；未配置时评论仍会保存，只跳过推送。
- `CLIENT_HASH_SALT` 一旦上线不要随意更换，否则旧记录无法归属到原学生。
- 如果不想用 COS，可以设置 `BACKUP_LOCAL_DIR=/var/backups/math-analysis-tutor` 做本地备份，但仍建议配置 COS 异地备份。
- `BACKUP_LOCAL_DIR` 目录必须对运行用户可写。

### 初始化数据库

```bash
npm run db:migrate
```

项目会自动建以下表：

- `students`
- `questions`
- `likes`
- `backup_runs`
- `schema_migrations`

### 导入旧 JSON 数据（可选）

如果之前使用本地 JSON 模式：

```bash
npm run db:import-json -- --file /opt/math-analysis-tutor/server/data/questions.json
```

该命令只允许导入空数据库，并保留原 JSON 文件不变。导入前建议先复制一份旧数据。

### 启动

```bash
npm start
```

确认输出：

```text
数据存储：MySQL math_tutor@内网地址:3306/math_tutor
备份：cos · 0 3 * * * (Asia/Shanghai)
```

浏览器打开：

```text
https://math.example.com/admin
```

---

## 5. 配置 systemd

复制服务文件并修改 `User`、项目路径：

```bash
sudo cp deploy/math-tutor.service /etc/systemd/system/math-tutor.service
sudo nano /etc/systemd/system/math-tutor.service
sudo systemctl daemon-reload
sudo systemctl enable --now math-tutor
sudo systemctl status math-tutor
```

日志：

```bash
sudo journalctl -u math-tutor -f
```

重启：

```bash
sudo systemctl restart math-tutor
```

停止服务时应等待 Node 完成 MySQL 连接池关闭和 3 秒以内的收尾。

---

## 6. 小程序配置

编辑 `miniprogram/config.js`：

```js
module.exports = {
  apiBaseUrl: 'https://math.example.com',
  requestTimeout: 90000,
};
```

在微信公众平台：

1. 「开发管理 → 开发设置 → 服务器域名」把 `https://math.example.com` 加入 **request 合法域名**。
2. 同时把同一域名加入 **downloadFile 合法域名**（教学资源/答疑图片预览）和 **uploadFile 合法域名**（图片提问）。
3. 重新编译上传小程序。
4. 开发者工具中的「不校验合法域名」只用于本地开发，正式版不要依赖它。

---

## 7. 备份与恢复

### 自动备份

`BACKUP_ENABLED=true` 后，服务会按 `BACKUP_CRON` 自动执行，默认每天北京时间 03:00：

- 导出 MySQL 全量快照
- gzip 压缩
- 上传 COS
- 如配置了 `BACKUP_LOCAL_DIR`，同时写一份本地文件
- 结果记录到 `backup_runs`

### 手动备份

教师后台右上角云朵图标，或：

```bash
cd /opt/math-analysis-tutor/server
npm run backup
```

### 恢复

恢复只允许导入**空数据库**，避免误覆盖数据。

```bash
# 1. 从 COS 下载备份文件
# 2. 创建一个新的空数据库，例如 math_tutor_restore
# 3. 临时把 .env 的 MYSQL_DATABASE 指向新库
npm run restore -- /path/to/math-analysis-backup-xxxx.json.gz --yes
```

恢复后先验证：

```bash
node -e "import('./src/lib/store-factory.js').then(async ({createStore}) => {
  const {config} = await import('./src/config.js');
  const store = await createStore(config);
  console.log(await store.stats());
  await store.close();
})"
```

确认无误后再把线上 `.env` 切回/切到恢复库并重启服务。

### COS 生命周期

参见 [backup-cos-lifecycle.md](../deploy/backup-cos-lifecycle.md)。同时保留腾讯云数据库自身的自动备份。

---

## 8. 上线检查清单

- [ ] 域名已备案，HTTPS 正常
- [ ] 3000、3306 未对公网开放
- [ ] MySQL 使用内网连接，业务账号权限最小化
- [ ] `.env` 权限为 600，未提交 Git
- [ ] `ADMIN_TOKEN`、数据库密码、COS 密钥均为随机强密码
- [ ] `CLIENT_HASH_SALT` 已固定并备份
- [ ] `npm run db:migrate` 成功
- [ ] 旧 JSON 数据已导入并核对数量
- [ ] 教师邮箱注册/登录、资料/密码修改验证
- [ ] 教师评论、学生评论、评论点赞、教师评论置顶验证
- [ ] 服务号推送（如配置）实际收到模板消息
- [ ] 教师登录、小程序提问、点赞、导出均验证
- [ ] 教师后台上传一次 PDF/PPT，学生端「资源」能打开
- [ ] COS 资源前缀可写，替换/删除文件正常
- [ ] 手动备份成功，COS 上能看到对象
- [ ] 已演练一次“空库恢复”
- [ ] 腾讯云数据库自动备份已开启
- [ ] 微信 request + downloadFile + uploadFile 合法域名已配置
- [ ] 图片提问、图片预览、历史回看验证
- [ ] `journalctl` 无持续报错
- [ ] 已配置健康检查/告警

---

## 9. 常见问题

**MySQL 连接超时**  
检查服务器和数据库是否同 VPC、数据库安全组是否放行服务器内网 IP、是否误填公网地址。

**Access denied**  
检查用户名、密码、授权 host 是否为 `10.%` 或实际内网网段。

**建表失败：REFERENCES command denied**  
业务账号缺少 `REFERENCES` 权限；临时授权后重新执行 `npm run db:migrate`。

**COS 备份失败**  
确认子用户有 `PutObject` 权限、Bucket 与 Region 正确、服务器能访问外网。资源上传还需要检查 `RESOURCE_STORAGE=cos` 和 `COS_RESOURCE_PREFIX`，删除/替换需要 `DeleteObject`。

**备份成功但教师后台显示旧状态**  
刷新页面；状态接口会从 `backup_runs` 读取最近一次记录。

**恢复提示目标库不是空库**  
这是安全保护。请创建新数据库恢复，不要直接覆盖线上库。

**小程序请求失败**  
检查 HTTPS 证书、request 合法域名、Nginx 反向代理和 `apiBaseUrl`；微信开发者工具中可先看 Network 面板。

**想换数据库密码**  
修改腾讯云数据库密码 → 更新 `.env` → `systemctl restart math-tutor`，无需改代码。

---

## 10. 升级流程

```bash
cd /opt/math-analysis-tutor
# 拉取或上传新代码
cd server
npm ci --omit=dev
npm run db:migrate
sudo systemctl restart math-tutor
curl -fsS https://math.example.com/api/health
```

升级前先做一次手动备份。当前版本是单实例应用；如果以后需要多台应用服务器，应把进程内限流迁移到 Redis，并确保备份任务只在一台实例上运行。
