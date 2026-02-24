#!/bin/bash
set -e

# Can be called manually: backup.sh [--now]
# Or from backup-loop.sh

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-menzhen}"
DB_PASSWORD="${DB_PASSWORD:-menzhen123}"
DB_NAME="${DB_NAME:-menzhen}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-minio:9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
MINIO_BUCKET="${MINIO_BUCKET:-menzhen}"

DATE=$(date +%Y-%m-%d)
BACKUP_PATH="${BACKUP_DIR}/backup-${DATE}"

echo "[$(date)] Starting backup to ${BACKUP_PATH}..."

# Create backup directory
mkdir -p "${BACKUP_PATH}"

# 1. MySQL dump
echo ">> Dumping MySQL..."
mysqldump -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" \
    --single-transaction --routines --triggers \
    "${DB_NAME}" > "${BACKUP_PATH}/database.sql"
echo "MySQL dump complete: $(wc -c < "${BACKUP_PATH}/database.sql") bytes"

# 2. MinIO file sync
echo ">> Syncing MinIO files..."
mc alias set backup "http://${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" --api S3v4 2>/dev/null
mc mirror --overwrite "backup/${MINIO_BUCKET}" "${BACKUP_PATH}/files/" 2>/dev/null || true
echo "MinIO sync complete"

# 3. Clean old oplog (keep 3 months)
echo ">> Cleaning old operation logs (>3 months)..."
mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" \
    -e "DELETE FROM op_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 3 MONTH);" 2>/dev/null || true

# 4. Record backup metadata
echo "{\"date\":\"${DATE}\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "${BACKUP_PATH}/metadata.json"

echo "[$(date)] Backup completed: ${BACKUP_PATH}"
