#!/bin/bash

BACKUP_HOUR="${BACKUP_HOUR:-2}"

echo "[$(date)] Backup daemon started. Backup hour: ${BACKUP_HOUR}:00"

while true; do
    CURRENT_HOUR=$(date +%H | sed 's/^0//')
    TODAY_MARKER="/tmp/backup-done-$(date +%Y%m%d)"

    if [ "${CURRENT_HOUR}" -eq "${BACKUP_HOUR}" ] && [ ! -f "${TODAY_MARKER}" ]; then
        echo "[$(date)] Triggering daily backup..."
        /scripts/backup.sh
        touch "${TODAY_MARKER}"
        # Clean old marker files
        find /tmp -name "backup-done-*" -mtime +1 -delete 2>/dev/null || true
        echo "[$(date)] Daily backup completed."
    fi

    sleep 3600
done
