#!/bin/bash
set -eo pipefail

# Hourly database backup script
# Output: BACKUP_DIR/SITE_ID_YYYYMMDD_HHMMSS.sql.gz
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
SITE_ID="${SITE_ID:-default}"

# Validate SITE_ID: only allow alphanumeric, dash, underscore
if ! echo "${SITE_ID}" | grep -qE '^[A-Za-z0-9_-]+$'; then
    echo ">> ERROR: SITE_ID contains invalid characters (only A-Z, a-z, 0-9, -, _ allowed): ${SITE_ID}"
    exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${SITE_ID}_${TIMESTAMP}.sql.gz"

echo "[$(date)] Starting backup..."

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# 1. MySQL dump with gzip compression
TEMP_FILE="${BACKUP_FILE}.tmp"
echo ">> Dumping MySQL to ${BACKUP_FILE}..."
if mysqldump -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" \
    --single-transaction --routines --triggers --no-tablespaces \
    "${DB_NAME}" 2>&1 | grep -v '^\[Warning\]\|^mysqldump: \[Warning\]' | gzip -9 > "${TEMP_FILE}"; then
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

# 2. Clean old oplog (keep 3 months)
echo ">> Cleaning old operation logs (>3 months)..."
mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" \
    -e "DELETE FROM op_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 3 MONTH);" 2>/dev/null || true

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

# 4. Upload to Qiniu cloud storage (retry up to 10 times)
# Set Qiniu prefix to include SITE_ID subdirectory
ORIG_PREFIX="${QINIU_KEY_PREFIX}"
export QINIU_KEY_PREFIX="${QINIU_KEY_PREFIX:-menzhen-backup/}${SITE_ID}/"
trap 'export QINIU_KEY_PREFIX="${ORIG_PREFIX}"' EXIT
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
        echo ">> Upload failed, retrying in 30s..."
        sleep 30
    fi
done
if [ "${MYSQL_UPLOAD_OK}" = false ]; then
    echo ">> WARNING: Qiniu upload failed after ${MYSQL_UPLOAD_MAX} attempts (backup saved locally)"
fi

# 5. Always clean up old backups on Qiniu (regardless of upload result)
python3 /scripts/cleanup_qiniu.py --type mysql || echo ">> WARNING: Qiniu cleanup failed (non-fatal)"

echo "[$(date)] Backup completed: ${BACKUP_FILE}"
