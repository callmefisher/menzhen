# 备份与恢复 - 设计规格

## 概述

在系统设置下新增"备份与恢复"页面，提供手动触发备份和数据恢复功能。复用现有备份脚本（backup.sh / backup-minio.sh / restore.sh），通过 API 调用执行。

## 页面布局

**方案 B：上下分区式**，移动端适配。

### 数据备份区（上部）
- 标题："📦 数据备份"
- 状态信息：上次备份时间、自动备份间隔
- 三个操作按钮：备份 MySQL / 备份 MinIO / 全量备份
- 点击后显示进度（脚本执行中 → 完成/失败）

### 数据恢复区（下部）
- 标题："♻️ 数据恢复"
- 警告提示：恢复将覆盖当前数据
- 两个入口卡片：从本地恢复 / 从云端恢复

### 云端恢复弹窗
- 桌面端：Ant Design Modal 居中弹窗（520px）
- 移动端：Ant Design Drawer 底部抽屉（全宽）
- 内容：分别选择 MySQL 备份文件和 MinIO 备份文件（MinIO 可选）
- 文件列表从七牛云 API 获取，显示文件名、大小、日期
- 二次确认：红色警告 + 确认恢复按钮

## 后端 API

权限：`user:manage`（超级管理员）

### POST /backup/trigger
触发备份操作。

请求体：
```json
{ "type": "mysql" | "minio" | "full" }
```

响应：
```json
{ "task_id": "uuid", "message": "备份已开始" }
```

实现：后台执行 `backup.sh`（mysql）/ `backup-minio.sh`（minio）/ 两者都执行（full）。

### GET /backup/status/:task_id
查询备份任务状态。

响应：
```json
{ "task_id": "uuid", "status": "running" | "success" | "failed", "output": "..." }
```

### GET /backup/list/local
列出本地备份文件。

响应：
```json
{
  "mysql": [{ "filename": "default_20260316_143000.sql", "size": 2300000, "modified": "2026-03-16T14:30:00Z" }],
  "minio": [{ "filename": "default_minio_20260316_143000.tar.gz", "size": 156000000, "modified": "2026-03-16T14:30:00Z" }]
}
```

### GET /backup/list/cloud
列出七牛云备份文件。使用七牛 Go SDK 列举 bucket 中 QINIU_KEY_PREFIX 下的文件。

响应格式同 `/backup/list/local`。

### POST /restore/trigger
触发恢复操作。

请求体：
```json
{
  "source": "local" | "cloud",
  "mysql_file": "filename.sql",
  "minio_file": "filename.tar.gz"  // 可选
}
```

- local：调用 `restore.sh --auto`（或指定文件）
- cloud：先从七牛下载文件，再调用 `restore.sh --sql <file> [--minio-tar <file>]`

响应：
```json
{ "task_id": "uuid", "message": "恢复已开始" }
```

### GET /restore/status/:task_id
查询恢复任务状态（同 backup status 格式）。

## 前端组件

### 新文件
- `web/src/pages/settings/BackupRestore.tsx` — 主页面
- `web/src/api/backup.ts` — API 客户端

### 修改文件
- `web/src/App.tsx` — 新增路由 `/settings/backup`
- `server/router/router.go` — 新增 backup/restore 路由组
- `server/handler/backup.go` — 新增 handler
- `server/service/backup.go` — 新增 service（执行脚本、七牛 SDK）

### 移动端适配
- 备份按钮：桌面横排 → 移动端纵向排列（flex-direction: column）
- 恢复卡片：桌面横排 → 移动端纵向
- 云端恢复：桌面 Modal → 移动端 Drawer（基于 `useBreakpoint` 判断）
- 文件列表：桌面横排信息 → 移动端分行

## 安全考虑

- 所有接口需 `user:manage` 权限
- 恢复操作前端二次确认
- 脚本执行使用 `exec.Command`，不拼接用户输入到命令行
- 备份任务状态存内存（map + mutex），重启后清除
