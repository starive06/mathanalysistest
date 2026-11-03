# COS 备份生命周期建议

备份对象路径：

```text
math-analysis-tutor/backups/YYYY/MM/DD/math-analysis-backup-YYYYMMDD-HHmmssSSS.json.gz
```

建议在 COS 控制台为该前缀配置生命周期规则：

- 保留最近 **30 天**的每日备份。
- 每月 1 日的备份可转低频存储，保留 **180 天**。
- 课程结束后，按学校数据留存要求整体导出或删除。
- Bucket 必须设为 **私有读写**，不要开启公有读。
- COS 只负责备份，不代替腾讯云数据库自身的自动备份；两者都要开启。

恢复步骤：

```bash
cd /opt/math-analysis-tutor/server
# 从 COS 控制台下载备份文件到服务器
npm run restore -- /path/to/math-analysis-backup-xxxx.json.gz --yes
```

恢复工具只允许导入**空数据库**，避免误覆盖线上数据。恢复前先在腾讯云控制台创建一个新的空数据库，并把 `.env` 的 `MYSQL_DATABASE` 临时指向它，确认数据后再切换线上连接。
