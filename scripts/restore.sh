#!/bin/bash
set -eo pipefail

# Usage:
#   restore.sh <backup-dir-path>              # Legacy: directory with database.sql + files/
#   restore.sh --auto                         # Auto: find latest .sql + minio tar.gz in /backups/
#   restore.sh --sql <file.sql>               # Restore only MySQL from .sql file
#   restore.sh --sql <file.sql> --minio-tar <file.tar.gz>  # Restore both

DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-menzhen}"
DB_PASSWORD="${DB_PASSWORD:-menzhen123}"
DB_NAME="${DB_NAME:-menzhen}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-minio:9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
MINIO_BUCKET="${MINIO_BUCKET:-menzhen}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
SITE_ID="${SITE_ID:-default}"

# Validate SITE_ID
if ! echo "${SITE_ID}" | grep -qE '^[A-Za-z0-9_-]+$'; then
    echo ">> ERROR: SITE_ID contains invalid characters: ${SITE_ID}"
    exit 1
fi

SQL_FILE=""
MINIO_TAR=""
LEGACY_DIR=""

# --- Parse arguments ---
while [[ $# -gt 0 ]]; do
    case $1 in
        --auto)
            # Find latest .sql/.sql.gz matching SITE_ID
            SQL_FILE=$(find "${BACKUP_DIR}" -maxdepth 1 \( -name "${SITE_ID}_*.sql.gz" -o -name "${SITE_ID}_*.sql" \) -type f | sort -r | head -1)
            # Find latest minio tar.gz matching SITE_ID
            MINIO_TAR=$(find "${BACKUP_DIR}/minio" -name "${SITE_ID}_minio_*.tar.gz" -type f 2>/dev/null | sort -r | head -1)
            # Fallback: try legacy format (no SITE_ID prefix)
            if [ -z "${SQL_FILE}" ]; then
                echo "[$(date)] No SITE_ID=${SITE_ID} backups found, trying legacy format..."
                SQL_FILE=$(find "${BACKUP_DIR}" -maxdepth 1 \( -name "*.sql.gz" -o -name "*.sql" \) -type f | sort -r | head -1)
                MINIO_TAR=$(find "${BACKUP_DIR}/minio" -name "minio_*.tar.gz" -type f 2>/dev/null | sort -r | head -1)
            fi
            # If no local backups found, try downloading from Qiniu
            if [ -z "${SQL_FILE}" ]; then
                echo "[$(date)] No local backups found, trying to download from Qiniu..."
                if python3 /scripts/download_from_qiniu.py --type all; then
                    SQL_FILE=$(find "${BACKUP_DIR}" -maxdepth 1 \( -name "${SITE_ID}_*.sql.gz" -o -name "${SITE_ID}_*.sql" \) -type f | sort -r | head -1)
                    MINIO_TAR=$(find "${BACKUP_DIR}/minio" -name "${SITE_ID}_minio_*.tar.gz" -type f 2>/dev/null | sort -r | head -1)
                    # Fallback after download: try legacy format
                    if [ -z "${SQL_FILE}" ]; then
                        SQL_FILE=$(find "${BACKUP_DIR}" -maxdepth 1 \( -name "*.sql.gz" -o -name "*.sql" \) -type f | sort -r | head -1)
                        MINIO_TAR=$(find "${BACKUP_DIR}/minio" -name "minio_*.tar.gz" -type f 2>/dev/null | sort -r | head -1)
                    fi
                fi
            fi
            if [ -z "${SQL_FILE}" ]; then
                echo "错误: 本地和七牛云均未找到备份文件，请检查 QINIU_* 环境变量配置"
                exit 1
            fi
            shift
            ;;
        --sql)
            SQL_FILE="$2"
            shift 2
            ;;
        --minio-tar)
            MINIO_TAR="$2"
            shift 2
            ;;
        *)
            # Legacy mode: first positional arg is backup directory
            LEGACY_DIR="$1"
            shift
            ;;
    esac
done

# --- Legacy mode: directory with database.sql + files/ ---
if [ -n "${LEGACY_DIR}" ]; then
    if [ ! -f "${LEGACY_DIR}/database.sql" ]; then
        echo "错误: 备份文件不存在: ${LEGACY_DIR}/database.sql"
        exit 1
    fi
    SQL_FILE="${LEGACY_DIR}/database.sql"
    # Check for files/ directory (legacy MinIO backup)
    if [ -d "${LEGACY_DIR}/files" ]; then
        LEGACY_DIR_FILES="${LEGACY_DIR}/files"
    fi
fi

if [ -z "${SQL_FILE}" ] && [ -z "${MINIO_TAR}" ]; then
    echo "Usage:"
    echo "  restore.sh <backup-dir-path>                           # Legacy directory mode"
    echo "  restore.sh --auto                                      # Auto-detect latest backups"
    echo "  restore.sh --sql <file.sql>                            # MySQL only"
    echo "  restore.sh --sql <file.sql> --minio-tar <file.tar.gz>  # MySQL + MinIO"
    echo "  restore.sh --minio-tar <file.tar.gz>                   # MinIO only"
    exit 1
fi

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

echo "[$(date)] Starting restore..."

# 1. Restore MySQL (skip if no SQL file)
if [ -n "${SQL_FILE}" ]; then
    restore_mysql "${SQL_FILE}"
else
    echo ">> 跳过 MySQL 恢复（未指定 SQL 文件）"
fi

# 2. Restore MinIO files
mc alias set backup "http://${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" --api S3v4 2>/dev/null
mc mb --ignore-existing "backup/${MINIO_BUCKET}" 2>/dev/null || true

if [ -n "${MINIO_TAR}" ]; then
    # Restore from tar.gz
    echo ">> Restoring MinIO files from ${MINIO_TAR}..."
    TMP_DIR=$(mktemp -d)
    tar xzf "${MINIO_TAR}" -C "${TMP_DIR}"
    mc mirror --overwrite "${TMP_DIR}/" "backup/${MINIO_BUCKET}" 2>/dev/null || true
    rm -rf "${TMP_DIR}"
    echo "MinIO restore complete (from tar.gz)"
elif [ -n "${LEGACY_DIR_FILES}" ]; then
    # Legacy: restore from files/ directory
    echo ">> Restoring MinIO files from ${LEGACY_DIR_FILES}..."
    mc mirror --overwrite "${LEGACY_DIR_FILES}/" "backup/${MINIO_BUCKET}" 2>/dev/null || true
    echo "MinIO restore complete (from directory)"
else
    echo ">> 无 MinIO 文件需要恢复"
fi

# 3. Verify
if [ -n "${SQL_FILE}" ]; then
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
fi

echo "[$(date)] Restore completed successfully"
