# OpLog 增加备份/恢复操作记录

## 目标

在现有 OpLog 系统中记录备份和恢复操作，展示谁在什么时间做了什么操作，包括备份类型（全量/MySQL/MinIO）和恢复详情（来源、文件名）。

## 数据设计

复用现有 OpLog 模型，新增 action 类型，无需改表。

| 字段 | 备份 | 恢复 |
|------|------|------|
| action | `backup` | `restore` |
| resource_type | `system` | `system` |
| resource_id | `0` | `0` |
| old_data | `null` | `null` |
| new_data | 见下方 | 见下方 |

### backup new_data

```json
{
  "backup_type": "full",
  "backup_type_label": "全量备份",
  "status": "success",
  "tenant_name": "XX诊所"
}
```

backup_type 取值：`full` / `mysql` / `minio`
backup_type_label 对应：`全量备份` / `仅备份MySQL` / `仅备份MinIO`

### restore new_data

```json
{
  "source": "cloud",
  "source_label": "云端恢复",
  "mysql_file": "site_20260318_120000.sql.gz",
  "minio_file": "site_minio_20260318_120000.tar.gz",
  "status": "success",
  "tenant_name": "XX诊所"
}
```

source 取值：`local` / `cloud`
source_label 对应：`本地恢复` / `云端恢复`
mysql_file/minio_file 可为空（至少一个有值）

## 后端改动

### 1. BackupHandler 增加 db 引用

当前 `BackupHandler` 只持有 `*service.BackupService`，需要增加 `db *gorm.DB` 以便记录 OpLog。修改 `NewBackupHandler(db)` 接收 db 参数。

### 2. TriggerBackup / TriggerRestore 增加 onComplete 回调

`BackupService.TriggerBackup` 和 `TriggerRestore` 增加 `onComplete func(status string)` 参数。异步任务完成后调用回调。

Handler 在调用时构造闭包，捕获从 gin.Context 提取的 tenantID/userID/userName 和 db，在回调中调用 `OpLogService.CreateOpLog`。

### 3. Tenant 名称获取

在 handler 中查询 `model.Tenant` 获取 Name，存入 new_data.tenant_name。

## 前端改动

### OpLogList.tsx

1. **ACTION_MAP** 新增：
   - `backup` → `{ label: '备份', color: 'purple' }`
   - `restore` → `{ label: '恢复', color: 'magenta' }`

2. **RESOURCE_TYPE_MAP** 新增：
   - `system` → `'系统操作'`

3. **新增 BackupRestoreView 组件**：用于展开行显示备份/恢复详情
   - 备份：显示备份类型、状态、诊所名称
   - 恢复：显示恢复来源、MySQL文件、MinIO文件、状态、诊所名称

4. **DiffView** 增加 backup/restore 分支，调用 BackupRestoreView

5. **getResourceDisplayName** 对 system 类型返回 tenant_name

6. **rowExpandable** 增加 backup/restore 判断

## 涉及文件

| 文件 | 改动 |
|------|------|
| `server/handler/backup.go` | 增加 db 字段，构造 OpLog 回调 |
| `server/service/backup.go` | TriggerBackup/TriggerRestore 增加 onComplete 参数 |
| `server/router/router.go` | NewBackupHandler 传入 db |
| `web/src/pages/OpLogList.tsx` | 新增 backup/restore 展示逻辑 |
