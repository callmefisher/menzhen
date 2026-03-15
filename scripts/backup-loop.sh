#!/bin/bash

# Backup daemon: poll-based for MySQL and MinIO backups
# Checks every 60s if last backup exceeds the configured interval.
# This ensures backups trigger promptly after system wake from sleep,
# since sleep(1) uses monotonic clock which pauses during hibernation.

# Re-read .env on each iteration so config changes take effect without restart
reload_env() {
    [ -f /app/.env ] && set -a && . /app/.env && set +a
}

reload_env

BACKUP_DIR="${BACKUP_DIR:-/backups}"
POLL_INTERVAL=60

echo "[$(date)] Backup daemon started"
echo "  Poll interval: ${POLL_INTERVAL}s"

# Get age (in seconds) of the most recent backup file
# Usage: get_backup_age <dir> <pattern>
# Returns: age in seconds, or empty string if no file found
get_backup_age() {
    local dir="$1" pattern="$2"
    local latest
    latest=$(find "${dir}" -maxdepth 1 -name "${pattern}" -type f -exec stat -c '%Y' {} \; 2>/dev/null | sort -rn | head -1)
    if [ -n "${latest}" ]; then
        echo $(( $(date +%s) - ${latest%.*} ))
    fi
}

# --- MySQL backup loop ---
mysql_loop() {
    while true; do
        reload_env
        MYSQL_INTERVAL="${BACKUP_INTERVAL_MYSQL:-7200}"
        age=$(get_backup_age "${BACKUP_DIR}" "*.sql")
        if [ -z "${age}" ]; then
            echo "[$(date)] MySQL: no backup found, triggering immediate..."
            /scripts/backup.sh
        elif [ "${age}" -ge "${MYSQL_INTERVAL}" ]; then
            echo "[$(date)] MySQL: last backup ${age}s ago (>= ${MYSQL_INTERVAL}s), triggering backup..."
            /scripts/backup.sh
        fi
        sleep ${POLL_INTERVAL}
    done
}

# --- MinIO backup loop ---
minio_loop() {
    MINIO_BACKUP_DIR="${BACKUP_DIR}/minio"
    while true; do
        reload_env
        MINIO_INTERVAL="${BACKUP_INTERVAL_MINIO:-43200}"
        age=$(get_backup_age "${MINIO_BACKUP_DIR}" "minio_*.tar.gz")
        if [ -z "${age}" ]; then
            echo "[$(date)] MinIO: no backup found, triggering immediate..."
            /scripts/backup-minio.sh
        elif [ "${age}" -ge "${MINIO_INTERVAL}" ]; then
            echo "[$(date)] MinIO: last backup ${age}s ago (>= ${MINIO_INTERVAL}s), triggering backup..."
            /scripts/backup-minio.sh
        fi
        sleep ${POLL_INTERVAL}
    done
}

mysql_loop &
minio_loop &
wait
