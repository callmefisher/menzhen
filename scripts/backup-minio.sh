#!/bin/bash
set -e

# MinIO backup script
# Flow: mc mirror → tar.gz → upload to Qiniu → cleanup

BACKUP_DIR="${BACKUP_DIR:-/backups}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-minio:9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
MINIO_BUCKET="${MINIO_BUCKET:-menzhen}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
MINIO_BACKUP_DIR="${BACKUP_DIR}/minio"
TMP_DIR="${BACKUP_DIR}/.minio_tmp_${TIMESTAMP}"
BACKUP_FILE="${MINIO_BACKUP_DIR}/minio_${TIMESTAMP}.tar.gz"

mkdir -p "${MINIO_BACKUP_DIR}" "${TMP_DIR}"

echo "[$(date)] Starting MinIO backup..."

# 1. mc mirror MinIO → local temp directory
mc alias set backup "http://${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" --api S3v4 2>/dev/null
mc mirror "backup/${MINIO_BUCKET}" "${TMP_DIR}/" --overwrite 2>/dev/null || true

# 2. Check if there are files (skip empty bucket)
FILE_COUNT=$(find "${TMP_DIR}" -type f | wc -l)
if [ "${FILE_COUNT}" -eq 0 ]; then
    echo "[$(date)] MinIO bucket is empty, skipping backup"
    rm -rf "${TMP_DIR}"
    exit 0
fi

# 3. Create tar.gz
tar czf "${BACKUP_FILE}" -C "${TMP_DIR}" .
rm -rf "${TMP_DIR}"
echo "[$(date)] MinIO backup: ${BACKUP_FILE} ($(wc -c < "${BACKUP_FILE}") bytes, ${FILE_COUNT} files)"

# 4. Clean MinIO backups older than 3 days
find "${MINIO_BACKUP_DIR}" -name "minio_*.tar.gz" -type f -mtime +3 -delete 2>/dev/null || true
REMAINING=$(find "${MINIO_BACKUP_DIR}" -name "minio_*.tar.gz" -type f | wc -l)
echo ">> Remaining MinIO backup files: ${REMAINING}"

# 5. Upload to Qiniu (reuse upload_to_qiniu.py with minio/ sub-prefix)
ORIG_PREFIX="${QINIU_KEY_PREFIX}"
export QINIU_KEY_PREFIX="${QINIU_KEY_PREFIX:-menzhen-backup/}minio/"
if python3 /scripts/upload_to_qiniu.py "${BACKUP_FILE}"; then
    echo ">> Qiniu upload complete"
else
    echo ">> WARNING: Qiniu upload failed (backup saved locally)"
fi
export QINIU_KEY_PREFIX="${ORIG_PREFIX}"

echo "[$(date)] MinIO backup completed: ${BACKUP_FILE}"
