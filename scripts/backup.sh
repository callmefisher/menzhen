#!/bin/bash
set -e

# Hourly database backup script
# Output: BACKUP_DIR/YYYYMMDD_HHMMSS.sql
# Retention: keep latest N files (QINIU_RETAIN_MYSQL, default 5)
# After backup: upload to Qiniu cloud storage

# Re-read .env so config changes take effect without container restart
[ -f /app/.env ] && set -a && . /app/.env && set +a

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-menzhen}"
DB_PASSWORD="${DB_PASSWORD:-menzhen123}"
DB_NAME="${DB_NAME:-menzhen}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${TIMESTAMP}.sql"

echo "[$(date)] Starting backup..."

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# 1. MySQL dump (write to temp file first, rename on success to avoid empty backups)
TEMP_FILE="${BACKUP_FILE}.tmp"
echo ">> Dumping MySQL to ${BACKUP_FILE}..."
if mysqldump -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" \
    --single-transaction --routines --triggers --no-tablespaces \
    "${DB_NAME}" > "${TEMP_FILE}" 2>&1; then
    DUMP_SIZE=$(wc -c < "${TEMP_FILE}")
    if [ "${DUMP_SIZE}" -lt 1024 ]; then
        echo ">> ERROR: dump too small (${DUMP_SIZE} bytes), likely failed"
        rm -f "${TEMP_FILE}"
        exit 1
    fi
    mv "${TEMP_FILE}" "${BACKUP_FILE}"
    echo ">> MySQL dump complete: ${DUMP_SIZE} bytes"
else
    echo ">> ERROR: mysqldump failed"
    rm -f "${TEMP_FILE}"
    exit 1
fi

# 2. Clean old oplog (keep 3 months)
echo ">> Cleaning old operation logs (>3 months)..."
mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" \
    -e "DELETE FROM op_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 3 MONTH);" 2>/dev/null || true

# 3. Clean old local backups, keep latest N (same as cloud retention)
LOCAL_RETAIN="${QINIU_RETAIN_MYSQL:-5}"
echo ">> Cleaning local MySQL backups, keeping latest ${LOCAL_RETAIN}..."
BACKUP_FILES=$(find "${BACKUP_DIR}" -maxdepth 1 -name "*.sql" -type f | sort -r)
REMAINING=$(echo "${BACKUP_FILES}" | wc -l | tr -d ' ')
if [ "${REMAINING}" -gt "${LOCAL_RETAIN}" ]; then
    echo "${BACKUP_FILES}" | tail -n +$((LOCAL_RETAIN + 1)) | xargs rm -f
fi
REMAINING=$(find "${BACKUP_DIR}" -maxdepth 1 -name "*.sql" -type f | wc -l)
echo ">> Remaining backup files: ${REMAINING}"

# 4. Upload to Qiniu cloud storage (retry up to 10 times)
MYSQL_UPLOAD_MAX=10
MYSQL_UPLOAD_OK=false
for attempt in $(seq 1 ${MYSQL_UPLOAD_MAX}); do
    echo ">> Uploading to Qiniu (attempt ${attempt}/${MYSQL_UPLOAD_MAX})..."
    if python3 /scripts/upload_to_qiniu.py "${BACKUP_FILE}"; then
        echo ">> Qiniu upload complete"
        MYSQL_UPLOAD_OK=true
        break
    fi
    if [ "${attempt}" -lt "${MYSQL_UPLOAD_MAX}" ]; then
        echo ">> Upload failed, retrying in 10s..."
        sleep 10
    fi
done
if [ "${MYSQL_UPLOAD_OK}" = false ]; then
    echo ">> WARNING: Qiniu upload failed after ${MYSQL_UPLOAD_MAX} attempts (backup saved locally)"
fi

# 5. Always clean up old backups on Qiniu (regardless of upload result)
python3 /scripts/cleanup_qiniu.py --type mysql || echo ">> WARNING: Qiniu cleanup failed (non-fatal)"

echo "[$(date)] Backup completed: ${BACKUP_FILE}"
