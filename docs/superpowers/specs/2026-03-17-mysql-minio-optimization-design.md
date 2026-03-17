# MySQL & MinIO 存储/性能优化设计

> 日期: 2026-03-17
> 方案: A（备份压缩 + 性能调优）+ C（InnoDB 表压缩）
> 核心目标: 减小云端备份体积，优化 MySQL 性能，新部署默认启用

## 1. MySQL 备份 gzip 压缩

### 改动文件
- `scripts/backup.sh`
- `scripts/restore.sh`
- `scripts/backup-loop.sh`（文件匹配模式更新）
- `scripts/download_from_qiniu.py`（文件过滤 `.sql` → `.sql`+`.sql.gz`）
- `scripts/cleanup_qiniu.py`（同上）

### 备份侧
- `mysqldump ... | gzip > ${SITE_ID}_${TIMESTAMP}.sql.gz`
- 最小文件验证: `.sql.gz` ≥ 256 bytes（压缩后自然更小，gzip header 10 bytes + 压缩内容）
- 本地清理匹配 `${SITE_ID}_*.sql.gz` **和** `${SITE_ID}_*.sql`（过渡期清理旧格式）
- 七牛上传文件名改为 `.sql.gz`

### 恢复侧
- **所有恢复路径**（`--auto`、`--sql`、legacy）统一检测扩展名:
  - `.sql.gz` → `gunzip -c file.sql.gz | mysql ...`
  - `.sql` → `mysql ... < file.sql`（兼容旧备份）
- `--auto` 模式优先找 `.sql.gz`，找不到降级找 `.sql`

### backup-loop.sh
- MySQL 轮询匹配模式改为 `${SITE_ID}_*.sql.gz`，同时兼容 `${SITE_ID}_*.sql`
- 取两者中最新的文件计算 age

### 七牛云脚本
- `download_from_qiniu.py`: `.endswith(".sql")` → `.endswith((".sql", ".sql.gz"))`
- `cleanup_qiniu.py`: 同上，匹配 `.sql` 和 `.sql.gz` 一起计入保留数

### 预期效果
- SQL 文本压缩率 80-90%（100MB → 10-20MB）

---

## 2. MinIO 备份压缩优化

### 改动文件
- `scripts/backup-minio.sh`

### 改动
- `tar czf` → `tar -cf - . | gzip -9 > ${BACKUP_FILE}`
- 恢复脚本无需改动（`tar xzf` 兼容所有 gzip 级别）

### 预期效果
- 额外减小 2-5%（JPEG 已压缩，提升有限）

---

## 3. MySQL 性能调优（my.cnf）

### 新建文件
- `mysql/my.cnf`

### 改动文件
- `docker-compose.yml`（挂载 `./mysql/my.cnf:/etc/mysql/conf.d/custom.cnf`）

### 配置内容

```ini
[mysqld]
# 存储引擎
innodb_buffer_pool_size = 256M
innodb_log_file_size = 64M
innodb_flush_log_at_trx_commit = 2
innodb_flush_method = O_DIRECT

# 连接
max_connections = 300
table_open_cache = 256
thread_cache_size = 16

# 日志
general_log = 0
slow_query_log = 0
long_query_time = 10

# 字符集
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
```

### 平台注意
- `innodb_flush_method = O_DIRECT` 在 macOS Docker Desktop（virtiofs/gRPC-FUSE）上可能不支持，导致 MySQL 启动失败。生产 Linux 环境无此问题。开发环境如遇问题可注释此行。

### MySQL 版本注意
- `innodb_log_file_size` 在 MySQL 8.0.30+ 已标记为 deprecated（仍生效但会产生警告）。如使用 8.0.30+，可改用 `innodb_redo_log_capacity = 128M`。

---

## 4. InnoDB 表压缩

### 改动文件
- `server/database/database.go`

### 前置条件
- 需要 `innodb_file_per_table = ON`（MySQL 8.0 默认值，无需额外配置）

### 实现
AutoMigrate 之后，对含 TEXT/LONGTEXT 字段的 15 张表执行:
```sql
ALTER TABLE <table> ROW_FORMAT=COMPRESSED KEY_BLOCK_SIZE=8
```

### 目标表（15 张）
`medical_records`, `formulas`, `hexagrams`, `clinical_experiences`,
`ai_analyses`, `solar_terms`, `wuyun_liuqis`, `herbs`, `pulses`,
`follow_ups`, `prescriptions`, `patients`, `meridian_resources`,
`inventory_drugs`, `users`

### 排除说明
- `op_logs`: 虽含 JSON 列（MySQL 8.0 存储为 LONGTEXT），但数据为临时性质（3 个月自动清理），压缩收益低
- `billings`, `daily_stats`, `record_attachments` 等: 无 TEXT 字段，压缩无意义

### 幂等性
- 使用 `information_schema.tables` 检查 `ROW_FORMAT` 是否已经是 `Compressed`
- 已压缩则跳过，避免重复 ALTER TABLE

### 预期效果
- 磁盘占用减少约 50%
- 读性能不受影响，写性能降低 5-10%（诊所写入量极小，可忽略）

---

## 5. 新部署默认启用

所有优化对新部署自动生效:
- `mysql/my.cnf` 通过 docker-compose 挂载，无需手动配置
- InnoDB 表压缩在 `InitDB()` 中自动执行（幂等，已压缩则跳过）
- 备份脚本默认产出 `.sql.gz`

---

## 改动文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `mysql/my.cnf` | 新建 | MySQL 性能配置 |
| `docker-compose.yml` | 修改 | 挂载 my.cnf |
| `scripts/backup.sh` | 修改 | mysqldump + gzip |
| `scripts/backup-minio.sh` | 修改 | gzip -9 压缩 |
| `scripts/restore.sh` | 修改 | 支持 .sql.gz 恢复（所有路径） |
| `scripts/backup-loop.sh` | 修改 | 文件匹配模式兼容 .sql.gz |
| `scripts/download_from_qiniu.py` | 修改 | 文件过滤兼容 .sql.gz |
| `scripts/cleanup_qiniu.py` | 修改 | 清理匹配兼容 .sql.gz |
| `server/database/database.go` | 修改 | InnoDB 表压缩 |

## 向后兼容

- 恢复流程兼容旧备份（.sql / .tar.gz）
- 本地清理同时匹配 .sql 和 .sql.gz（过渡期清理旧格式）
- 七牛云下载/清理兼容两种格式
- MinIO 磁盘存储不变（图片不压缩）
