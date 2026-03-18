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
SITE_ID="${SITE_ID:-default}"

echo "[$(date)] Backup daemon started (SITE_ID=${SITE_ID})"
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
    local prev_interval=""
    # Skip immediate backup on first boot — wait one full interval first.
    # This prevents upload storms when SITE_ID changes (redeploy).
    local first_run=true
    while true; do
        reload_env
        SITE_ID="${SITE_ID:-default}"
        MYSQL_INTERVAL="${BACKUP_INTERVAL_MYSQL:-7200}"
        # Log when interval changes (config hot-reload)
        if [ "${MYSQL_INTERVAL}" != "${prev_interval}" ]; then
            echo "[$(date)] MySQL: interval changed: ${prev_interval:-<init>} -> ${MYSQL_INTERVAL}s"
            prev_interval="${MYSQL_INTERVAL}"
        fi
        # Check both .sql.gz (new) and .sql (legacy), use the youngest
        age_gz=$(get_backup_age "${BACKUP_DIR}" "${SITE_ID}_*.sql.gz")
        age_sql=$(get_backup_age "${BACKUP_DIR}" "${SITE_ID}_*.sql")
        if [ -n "${age_gz}" ] && [ -n "${age_sql}" ]; then
            age=$(( age_gz < age_sql ? age_gz : age_sql ))
        elif [ -n "${age_gz}" ]; then
            age="${age_gz}"
        else
            age="${age_sql}"
        fi
        if [ -z "${age}" ]; then
            if [ "${first_run}" = true ]; then
                echo "[$(date)] MySQL: no backup found for SITE_ID=${SITE_ID}, waiting one interval before first backup..."
                first_run=false
            else
                echo "[$(date)] MySQL: no backup found, triggering..."
                /scripts/backup.sh
            fi
        elif [ "${age}" -ge "${MYSQL_INTERVAL}" ]; then
            echo "[$(date)] MySQL: last backup ${age}s ago (>= ${MYSQL_INTERVAL}s), triggering backup..."
            /scripts/backup.sh
        fi
        first_run=false
        sleep ${POLL_INTERVAL}
    done
}

# --- MinIO backup loop ---
minio_loop() {
    MINIO_BACKUP_DIR="${BACKUP_DIR}/minio"
    local prev_interval=""
    # Skip immediate backup on first boot — same reason as mysql_loop
    local first_run=true
    while true; do
        reload_env
        SITE_ID="${SITE_ID:-default}"
        MINIO_INTERVAL="${BACKUP_INTERVAL_MINIO:-43200}"
        # Log when interval changes (config hot-reload)
        if [ "${MINIO_INTERVAL}" != "${prev_interval}" ]; then
            echo "[$(date)] MinIO: interval changed: ${prev_interval:-<init>} -> ${MINIO_INTERVAL}s"
            prev_interval="${MINIO_INTERVAL}"
        fi
        age=$(get_backup_age "${MINIO_BACKUP_DIR}" "${SITE_ID}_minio_*.tar.gz")
        if [ -z "${age}" ]; then
            if [ "${first_run}" = true ]; then
                echo "[$(date)] MinIO: no backup found for SITE_ID=${SITE_ID}, waiting one interval before first backup..."
                first_run=false
            else
                echo "[$(date)] MinIO: no backup found, triggering..."
                /scripts/backup-minio.sh
            fi
        elif [ "${age}" -ge "${MINIO_INTERVAL}" ]; then
            echo "[$(date)] MinIO: last backup ${age}s ago (>= ${MINIO_INTERVAL}s), triggering backup..."
            /scripts/backup-minio.sh
        fi
        first_run=false
        sleep ${POLL_INTERVAL}
    done
}

mysql_loop &
minio_loop &
wait
