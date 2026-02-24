#!/bin/bash
set -e

# Usage: restore.sh <backup-dir-path>

if [ -z "$1" ]; then
    echo "Usage: restore.sh <backup-directory>"
    echo "Example: restore.sh /backups/backup-2026-02-24"
    exit 1
fi

BACKUP_PATH="$1"
DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-menzhen}"
DB_PASSWORD="${DB_PASSWORD:-menzhen123}"
DB_NAME="${DB_NAME:-menzhen}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-minio:9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
MINIO_BUCKET="${MINIO_BUCKET:-menzhen}"

# Validate backup
if [ ! -f "${BACKUP_PATH}/database.sql" ]; then
    echo "错误: 备份文件不存在: ${BACKUP_PATH}/database.sql"
    exit 1
fi

echo "[$(date)] Starting restore from ${BACKUP_PATH}..."

# 1. Restore MySQL
echo ">> Restoring MySQL database..."
mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" < "${BACKUP_PATH}/database.sql"
echo "MySQL restore complete"

# 2. Restore MinIO files
if [ -d "${BACKUP_PATH}/files" ]; then
    echo ">> Restoring MinIO files..."
    mc alias set backup "http://${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" --api S3v4 2>/dev/null
    mc mb --ignore-existing "backup/${MINIO_BUCKET}" 2>/dev/null || true
    mc mirror --overwrite "${BACKUP_PATH}/files/" "backup/${MINIO_BUCKET}" 2>/dev/null || true
    echo "MinIO restore complete"
else
    echo ">> 无 MinIO 文件需要恢复"
fi

# 3. Verify
echo ">> Verifying data integrity..."
TABLE_COUNT=$(mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" \
    -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}';" 2>/dev/null)
echo "Tables found: ${TABLE_COUNT}"

PATIENT_COUNT=$(mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" \
    -N -e "SELECT COUNT(*) FROM patients;" 2>/dev/null || echo "0")
echo "Patients: ${PATIENT_COUNT}"

RECORD_COUNT=$(mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" \
    -N -e "SELECT COUNT(*) FROM medical_records;" 2>/dev/null || echo "0")
echo "Medical records: ${RECORD_COUNT}"

echo "[$(date)] Restore completed successfully"
