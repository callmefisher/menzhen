#!/bin/bash

# Backup daemon: runs backup every hour
# On startup: checks if last backup is older than 1 hour, triggers immediately if so

BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL=3600  # 1 hour in seconds

echo "[$(date)] Backup daemon started. Interval: every ${INTERVAL}s (1 hour)"

# --- Startup check: if last backup > 1 hour ago, backup immediately ---
need_immediate_backup=true
latest=$(find "${BACKUP_DIR}" -name "*.sql" -type f -exec stat -c '%Y' {} \; 2>/dev/null | sort -rn | head -1)
if [ -n "${latest}" ]; then
    now=$(date +%s)
    latest_int=${latest%.*}
    age=$((now - latest_int))
    echo "[$(date)] Last backup age: ${age}s"
    if [ "${age}" -lt "${INTERVAL}" ]; then
        need_immediate_backup=false
        echo "[$(date)] Last backup is recent (< 1 hour). Skipping immediate backup."
    fi
fi

if [ "${need_immediate_backup}" = true ]; then
    echo "[$(date)] No recent backup found. Triggering immediate backup..."
    /scripts/backup.sh
    echo "[$(date)] Immediate backup completed."
fi

# --- Main loop: backup every hour ---
while true; do
    sleep ${INTERVAL}
    echo "[$(date)] Triggering hourly backup..."
    /scripts/backup.sh
    echo "[$(date)] Hourly backup completed."
done
