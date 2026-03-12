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
if ! mc ls backup/ >/dev/null 2>&1; then
    echo ">> ERROR: cannot connect to MinIO at ${MINIO_ENDPOINT}"
    rm -rf "${TMP_DIR}"
    exit 1
fi
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

# 4. Clean old local MinIO backups, keep latest N (same as cloud retention)
LOCAL_RETAIN="${QINIU_RETAIN_MINIO:-5}"
echo ">> Cleaning local MinIO backups, keeping latest ${LOCAL_RETAIN}..."
BACKUP_FILES=$(find "${MINIO_BACKUP_DIR}" -name "minio_*.tar.gz" -type f | sort -r)
REMAINING=$(echo "${BACKUP_FILES}" | wc -l | tr -d ' ')
if [ "${REMAINING}" -gt "${LOCAL_RETAIN}" ]; then
    echo "${BACKUP_FILES}" | tail -n +$((LOCAL_RETAIN + 1)) | xargs rm -f
fi
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

# 6. Always clean up old backups on Qiniu (regardless of upload result)
python3 /scripts/cleanup_qiniu.py --type minio || echo ">> WARNING: Qiniu cleanup failed (non-fatal)"
export QINIU_KEY_PREFIX="${ORIG_PREFIX}"

echo "[$(date)] MinIO backup completed: ${BACKUP_FILE}"
