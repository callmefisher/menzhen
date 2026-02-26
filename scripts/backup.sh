#!/bin/bash
set -e

# Hourly database backup script
# Output: BACKUP_DIR/YYYYMMDD_HHMMSS.sql
# Retention: 3 days
# After backup: upload to Qiniu cloud storage

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

# 1. MySQL dump
echo ">> Dumping MySQL to ${BACKUP_FILE}..."
mysqldump -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" \
    --single-transaction --routines --triggers --no-tablespaces \
    "${DB_NAME}" > "${BACKUP_FILE}"
echo ">> MySQL dump complete: $(wc -c < "${BACKUP_FILE}") bytes"

# 2. Clean old oplog (keep 3 months)
echo ">> Cleaning old operation logs (>3 months)..."
mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" \
    -e "DELETE FROM op_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 3 MONTH);" 2>/dev/null || true

# 3. Clean backups older than 3 days
echo ">> Cleaning backups older than 3 days..."
find "${BACKUP_DIR}" -name "*.sql" -type f -mtime +3 -delete 2>/dev/null || true
REMAINING=$(find "${BACKUP_DIR}" -name "*.sql" -type f | wc -l)
echo ">> Remaining backup files: ${REMAINING}"

# 4. Upload to Qiniu cloud storage
echo ">> Uploading to Qiniu..."
if python3 /scripts/upload_to_qiniu.py "${BACKUP_FILE}"; then
    echo ">> Qiniu upload complete"
else
    echo ">> WARNING: Qiniu upload failed (backup is still saved locally)"
fi

echo "[$(date)] Backup completed: ${BACKUP_FILE}"
