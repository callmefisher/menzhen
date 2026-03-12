#!/bin/bash

# Backup daemon: dual-loop for MySQL and MinIO backups
# MySQL interval: BACKUP_INTERVAL_MYSQL (default 7200s = 2 hours)
# MinIO interval: BACKUP_INTERVAL_MINIO (default 43200s = 12 hours)

BACKUP_DIR="${BACKUP_DIR:-/backups}"
MYSQL_INTERVAL="${BACKUP_INTERVAL_MYSQL:-7200}"
MINIO_INTERVAL="${BACKUP_INTERVAL_MINIO:-43200}"

echo "[$(date)] Backup daemon started"
echo "  MySQL interval: ${MYSQL_INTERVAL}s ($(( MYSQL_INTERVAL / 3600 ))h$(( (MYSQL_INTERVAL % 3600) / 60 ))m)"
echo "  MinIO interval: ${MINIO_INTERVAL}s ($(( MINIO_INTERVAL / 3600 ))h$(( (MINIO_INTERVAL % 3600) / 60 ))m)"

# --- MySQL backup loop ---
mysql_loop() {
    # Startup check: if last backup is recent enough, skip immediate
    latest=$(find "${BACKUP_DIR}" -maxdepth 1 -name "*.sql" -type f -exec stat -c '%Y' {} \; 2>/dev/null | sort -rn | head -1)
    if [ -n "${latest}" ]; then
        age=$(( $(date +%s) - ${latest%.*} ))
        echo "[$(date)] MySQL: last backup ${age}s ago"
        if [ "${age}" -lt "${MYSQL_INTERVAL}" ]; then
            echo "[$(date)] MySQL: recent backup exists, skipping immediate"
        else
            echo "[$(date)] MySQL: backup is stale, triggering immediate..."
            /scripts/backup.sh
        fi
    else
        echo "[$(date)] MySQL: no backup found, triggering immediate..."
        /scripts/backup.sh
    fi
    while true; do
        sleep ${MYSQL_INTERVAL}
        echo "[$(date)] MySQL: triggering scheduled backup..."
        /scripts/backup.sh
    done
}

# --- MinIO backup loop ---
minio_loop() {
    MINIO_BACKUP_DIR="${BACKUP_DIR}/minio"
    latest=$(find "${MINIO_BACKUP_DIR}" -name "minio_*.tar.gz" -type f -exec stat -c '%Y' {} \; 2>/dev/null | sort -rn | head -1)
    if [ -n "${latest}" ]; then
        age=$(( $(date +%s) - ${latest%.*} ))
        echo "[$(date)] MinIO: last backup ${age}s ago"
        if [ "${age}" -lt "${MINIO_INTERVAL}" ]; then
            echo "[$(date)] MinIO: recent backup exists, skipping immediate"
        else
            echo "[$(date)] MinIO: backup is stale, triggering immediate..."
            /scripts/backup-minio.sh
        fi
    else
        echo "[$(date)] MinIO: no backup found, triggering immediate..."
        /scripts/backup-minio.sh
    fi
    while true; do
        sleep ${MINIO_INTERVAL}
        echo "[$(date)] MinIO: triggering scheduled backup..."
        /scripts/backup-minio.sh
    done
}

mysql_loop &
minio_loop &
wait
