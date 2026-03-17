# MySQL & MinIO 存储/性能优化 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compress MySQL backups with gzip, tune MySQL performance via my.cnf, enable InnoDB table compression, and optimize MinIO backup compression — all defaulting on new deployments.

**Architecture:** 9 files changed across backup scripts (shell/python) and Go backend. Backup format changes from `.sql` to `.sql.gz` with full backward compatibility. MySQL gets a custom `my.cnf` mounted via docker-compose. InnoDB compression applied idempotently at startup.

**Tech Stack:** Bash, Python 3 (Qiniu SDK), Go (GORM), MySQL 8.0, Docker Compose

**Spec:** `docs/superpowers/specs/2026-03-17-mysql-minio-optimization-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `mysql/my.cnf` | Create | MySQL server performance tuning |
| `docker-compose.yml` | Modify | Mount my.cnf into MySQL container |
| `scripts/backup.sh` | Modify | mysqldump + gzip compression |
| `scripts/backup-minio.sh` | Modify | gzip -9 compression level |
| `scripts/backup-loop.sh` | Modify | File pattern matching for .sql.gz |
| `scripts/restore.sh` | Modify | Auto-detect .sql.gz / .sql for all restore paths |
| `scripts/download_from_qiniu.py` | Modify | Filter .sql + .sql.gz files |
| `scripts/cleanup_qiniu.py` | Modify | Match .sql + .sql.gz for retention |
| `server/database/database.go` | Modify | InnoDB ROW_FORMAT=COMPRESSED after AutoMigrate |

---

### Task 1: MySQL 性能配置 (my.cnf + docker-compose)

**Files:**
- Create: `mysql/my.cnf`
- Modify: `docker-compose.yml:31-48`

- [ ] **Step 1: Create mysql/my.cnf**

```ini
[mysqld]
# Storage engine
innodb_buffer_pool_size = 256M
# NOTE: innodb_log_file_size is deprecated in MySQL 8.0.30+.
# For 8.0.30+, replace with: innodb_redo_log_capacity = 128M
innodb_log_file_size = 64M
innodb_flush_log_at_trx_commit = 2
# NOTE: O_DIRECT may fail on macOS Docker Desktop (virtiofs/gRPC-FUSE).
# Comment out this line if MySQL fails to start in dev environment.
innodb_flush_method = O_DIRECT

# Connections
max_connections = 300
table_open_cache = 256
thread_cache_size = 16

# Logging
general_log = 0
slow_query_log = 0
long_query_time = 10

# Character set
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
```

- [ ] **Step 2: Mount my.cnf in docker-compose.yml**

In the `mysql` service, add to `volumes`:
```yaml
    volumes:
      - mysql-data:/var/lib/mysql
      - ./mysql/my.cnf:/etc/mysql/conf.d/custom.cnf
```

- [ ] **Step 3: Commit**

```bash
git add mysql/my.cnf docker-compose.yml
git commit -m "feat: add MySQL performance tuning config (my.cnf)"
```

---

### Task 2: MySQL 备份 gzip 压缩

**Files:**
- Modify: `scripts/backup.sh`

- [ ] **Step 1: Change backup output to .sql.gz**

Replace the backup file variable (line 27):
```bash
# Before
BACKUP_FILE="${BACKUP_DIR}/${SITE_ID}_${TIMESTAMP}.sql"

# After
BACKUP_FILE="${BACKUP_DIR}/${SITE_ID}_${TIMESTAMP}.sql.gz"
```

- [ ] **Step 2: Change mysqldump to pipe through gzip**

Replace the mysqldump block (lines 34-52). The temp file approach stays but now produces gzip output:
```bash
# 1. MySQL dump with gzip compression
TEMP_FILE="${BACKUP_FILE}.tmp"
echo ">> Dumping MySQL to ${BACKUP_FILE}..."
if mysqldump -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" \
    --single-transaction --routines --triggers --no-tablespaces \
    "${DB_NAME}" 2>/dev/null | gzip > "${TEMP_FILE}"; then
    DUMP_SIZE=$(wc -c < "${TEMP_FILE}")
    if [ "${DUMP_SIZE}" -lt 256 ]; then
        echo ">> ERROR: dump too small (${DUMP_SIZE} bytes), likely failed"
        rm -f "${TEMP_FILE}"
        exit 1
    fi
    mv "${TEMP_FILE}" "${BACKUP_FILE}"
    echo ">> MySQL dump complete (compressed): ${DUMP_SIZE} bytes"
else
    echo ">> ERROR: mysqldump failed"
    rm -f "${TEMP_FILE}"
    exit 1
fi
```

- [ ] **Step 3: Update local cleanup to match both .sql.gz and .sql**

Replace the cleanup section (lines 60-68):
```bash
# 3. Clean old local backups, keep latest N (same as cloud retention)
LOCAL_RETAIN="${QINIU_RETAIN_MYSQL:-5}"
echo ">> Cleaning local MySQL backups (SITE_ID=${SITE_ID}), keeping latest ${LOCAL_RETAIN}..."
# Match both .sql.gz (new) and .sql (legacy) for cleanup
BACKUP_FILES=$(find "${BACKUP_DIR}" -maxdepth 1 \( -name "${SITE_ID}_*.sql.gz" -o -name "${SITE_ID}_*.sql" \) -type f | sort -r)
if [ -n "${BACKUP_FILES}" ]; then
    REMAINING=$(echo "${BACKUP_FILES}" | wc -l | tr -d ' ')
    if [ "${REMAINING}" -gt "${LOCAL_RETAIN}" ]; then
        echo "${BACKUP_FILES}" | tail -n +$((LOCAL_RETAIN + 1)) | xargs rm -f
    fi
fi
REMAINING=$(find "${BACKUP_DIR}" -maxdepth 1 \( -name "${SITE_ID}_*.sql.gz" -o -name "${SITE_ID}_*.sql" \) -type f | wc -l)
echo ">> Remaining backup files: ${REMAINING}"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/backup.sh
git commit -m "feat: compress MySQL backups with gzip (.sql.gz)"
```

---

### Task 3: MinIO 备份 gzip -9 压缩

**Files:**
- Modify: `scripts/backup-minio.sh:50`

- [ ] **Step 1: Replace tar czf with gzip -9**

Replace line 50:
```bash
# Before
tar czf "${BACKUP_FILE}" -C "${TMP_DIR}" .

# After
tar -cf - -C "${TMP_DIR}" . | gzip -9 > "${BACKUP_FILE}"
```

- [ ] **Step 2: Commit**

```bash
git add scripts/backup-minio.sh
git commit -m "feat: use gzip -9 for MinIO backup compression"
```

---

### Task 4: backup-loop.sh 文件匹配模式

**Files:**
- Modify: `scripts/backup-loop.sh:46`

- [ ] **Step 1: Update MySQL backup age detection**

The `get_backup_age` function works with a single pattern. We need to check both patterns and take the most recent. Replace line 46:
```bash
# Before
age=$(get_backup_age "${BACKUP_DIR}" "${SITE_ID}_*.sql")

# After: check both .sql.gz (new) and .sql (legacy), use the youngest
age_gz=$(get_backup_age "${BACKUP_DIR}" "${SITE_ID}_*.sql.gz")
age_sql=$(get_backup_age "${BACKUP_DIR}" "${SITE_ID}_*.sql")
# Pick the smaller age (most recent backup), prefer .gz
if [ -n "${age_gz}" ] && [ -n "${age_sql}" ]; then
    age=$(( age_gz < age_sql ? age_gz : age_sql ))
elif [ -n "${age_gz}" ]; then
    age="${age_gz}"
else
    age="${age_sql}"
fi
```

- [ ] **Step 2: Commit**

```bash
git add scripts/backup-loop.sh
git commit -m "feat: backup-loop supports .sql.gz file detection"
```

---

### Task 5: restore.sh 支持 .sql.gz

**Files:**
- Modify: `scripts/restore.sh`

- [ ] **Step 1: Update --auto mode to prioritize .sql.gz**

Replace lines 37-38 (inside `--auto` case):
```bash
            # Find latest .sql.gz or .sql matching SITE_ID (prefer .sql.gz)
            SQL_FILE=$(find "${BACKUP_DIR}" -maxdepth 1 \( -name "${SITE_ID}_*.sql.gz" -o -name "${SITE_ID}_*.sql" \) -type f | sort -r | head -1)
```

Replace lines 43-44 (fallback inside `--auto`):
```bash
                SQL_FILE=$(find "${BACKUP_DIR}" -maxdepth 1 \( -name "*.sql.gz" -o -name "*.sql" \) -type f | sort -r | head -1)
```

Replace lines 50-51 (after Qiniu download):
```bash
                    SQL_FILE=$(find "${BACKUP_DIR}" -maxdepth 1 \( -name "${SITE_ID}_*.sql.gz" -o -name "${SITE_ID}_*.sql" \) -type f | sort -r | head -1)
```

Replace lines 53-54 (fallback after download):
```bash
                        SQL_FILE=$(find "${BACKUP_DIR}" -maxdepth 1 \( -name "*.sql.gz" -o -name "*.sql" \) -type f | sort -r | head -1)
```

- [ ] **Step 2: Create helper function for MySQL restore**

Add after the argument parsing block (after line 102), before the "Starting restore" echo:
```bash
# Helper: restore MySQL from .sql or .sql.gz
restore_mysql() {
    local file="$1"
    echo ">> Restoring MySQL database from ${file}..."
    if [[ "${file}" == *.sql.gz ]]; then
        gunzip -c "${file}" | mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}"
    else
        mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" < "${file}"
    fi
    echo "MySQL restore complete"
}
```

- [ ] **Step 3: Replace the MySQL restore section**

Replace lines 107-113:
```bash
# 1. Restore MySQL (skip if no SQL file)
if [ -n "${SQL_FILE}" ]; then
    restore_mysql "${SQL_FILE}"
else
    echo ">> 跳过 MySQL 恢复（未指定 SQL 文件）"
fi
```

- [ ] **Step 4: Commit**

```bash
git add scripts/restore.sh
git commit -m "feat: restore.sh supports .sql.gz with backward compatibility"
```

---

### Task 6: 七牛云脚本兼容 .sql.gz

**Files:**
- Modify: `scripts/download_from_qiniu.py`
- Modify: `scripts/cleanup_qiniu.py`

- [ ] **Step 1: Update download_from_qiniu.py — list_files_json function**

Replace lines 69-81 (the sql_files filter blocks):
```python
        sql_files = [
            item for item in items
            if (item["key"].endswith(".sql") or item["key"].endswith(".sql.gz"))
            and "/" not in item["key"][len(site_prefix):]
        ]
        # Fallback to legacy prefix
        if not sql_files:
            items = list_files(bucket_mgr, bucket_name, prefix=key_prefix)
            sql_files = [
                item for item in items
                if (item["key"].endswith(".sql") or item["key"].endswith(".sql.gz"))
                and "/" not in item["key"][len(key_prefix):]
            ]
```

- [ ] **Step 2: Update download_from_qiniu.py — main download section**

Replace lines 165-178 (the sql_files filter in download section):
```python
        sql_files = [
            item for item in items
            if (item["key"].endswith(".sql") or item["key"].endswith(".sql.gz"))
            and "/" not in item["key"][len(site_prefix):]
        ]
        # Fallback: try legacy prefix (no SITE_ID subdirectory)
        if not sql_files:
            print(f">> No MySQL backup in {site_prefix}, trying legacy prefix {key_prefix}...")
            items = list_files(bucket_mgr, bucket_name, prefix=key_prefix)
            sql_files = [
                item for item in items
                if (item["key"].endswith(".sql") or item["key"].endswith(".sql.gz"))
                and "/" not in item["key"][len(key_prefix):]
            ]
```

- [ ] **Step 3: Update cleanup_qiniu.py**

Replace lines 89-93 (mysql cleanup matched filter):
```python
        matched = [
            item for item in items
            if (item["key"].endswith(".sql") or item["key"].endswith(".sql.gz"))
            and "/" not in item["key"][len(key_prefix):]
        ]
```

- [ ] **Step 4: Commit**

```bash
git add scripts/download_from_qiniu.py scripts/cleanup_qiniu.py
git commit -m "feat: Qiniu scripts support .sql.gz format"
```

---

### Task 7: InnoDB 表压缩

**Files:**
- Modify: `server/database/database.go`

- [ ] **Step 1: Add InnoDB compression after AutoMigrate**

After the composite index block (after line 71), before the final log.Println, add:
```go
	// InnoDB table compression for tables with TEXT/LONGTEXT fields.
	// ROW_FORMAT=COMPRESSED KEY_BLOCK_SIZE=8 reduces disk usage ~50%.
	// Idempotent: skips tables already compressed.
	compressTables := []string{
		"medical_records", "formulas", "hexagrams", "clinical_experiences",
		"ai_analyses", "solar_terms", "wuyun_liuqis", "herbs", "pulses",
		"follow_ups", "prescriptions", "patients", "meridian_resources",
		"inventory_drugs", "users",
	}
	for _, table := range compressTables {
		var rowFormat string
		db.Raw("SELECT ROW_FORMAT FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
			cfg.DBName, table).Scan(&rowFormat)
		if rowFormat != "" && rowFormat != "Compressed" {
			if result := db.Exec("ALTER TABLE `" + table + "` ROW_FORMAT=COMPRESSED KEY_BLOCK_SIZE=8"); result.Error != nil {
				log.Printf("WARNING: failed to compress table %s: %v", table, result.Error)
			} else {
				log.Printf("Compressed table: %s", table)
			}
		}
	}
```

- [ ] **Step 2: Run Go build to verify**

```bash
cd server && go build ./...
```
Expected: SUCCESS, no errors.

- [ ] **Step 3: Commit**

```bash
git add server/database/database.go
git commit -m "feat: enable InnoDB compression for TEXT-heavy tables"
```

---

### Task 8: 验证与部署

- [ ] **Step 1: Run full Go build**

```bash
cd server && go build ./...
```

- [ ] **Step 2: Run Go tests**

```bash
cd server && go test ./... -v
```

- [ ] **Step 3: Run frontend build**

```bash
cd web && npm run build
```

- [ ] **Step 4: Deploy**

```bash
./deploy.sh
```

- [ ] **Step 5: Verify MySQL config loaded**

After deploy, check MySQL variables:
```bash
docker compose exec mysql mysql -u root -p"${DB_PASSWORD}" -e "SHOW VARIABLES LIKE 'innodb_buffer_pool_size'; SHOW VARIABLES LIKE 'max_connections'; SHOW VARIABLES LIKE 'innodb_flush_log_at_trx_commit';"
```
Expected: `innodb_buffer_pool_size` = 268435456 (256M), `max_connections` = 300, `innodb_flush_log_at_trx_commit` = 2

- [ ] **Step 6: Verify InnoDB compression applied**

```bash
docker compose exec mysql mysql -u root -p"${DB_PASSWORD}" -e "SELECT TABLE_NAME, ROW_FORMAT FROM information_schema.tables WHERE TABLE_SCHEMA='menzhen' AND ROW_FORMAT='Compressed';"
```
Expected: 15 tables listed with ROW_FORMAT = Compressed

- [ ] **Step 7: Trigger a test backup and verify .sql.gz output**

```bash
docker compose exec backup /scripts/backup.sh
ls -la backups/*.sql.gz
```
Expected: New `.sql.gz` file created, significantly smaller than previous `.sql` backups.
