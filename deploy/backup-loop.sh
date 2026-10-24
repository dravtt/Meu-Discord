#!/usr/bin/env bash
# Runs inside the voka-backup container: one verified dump per day, keeping 14 days.
# A dump only becomes voka-AAAA-MM-DD.sql.gz after passing verify; a failure leaves FALHOU-ultimo-backup.txt.
set -uo pipefail
. /voka/backup-lib.sh
HOUR="${VOKA_BACKUP_TIME:-03:30}"
# Seconds until the next HH:MM, so the daily backup does not drift.
until_next() { local now next; now=$(date +%s); next=$(date -d "today $HOUR" +%s); [ "$next" -le "$now" ] && next=$(date -d "tomorrow $HOUR" +%s); echo $((next - now)); }
first=1
while true; do
  # First pass right after start (so a fresh install has a backup), then every day at $HOUR.
  [ -n "$first" ] || sleep "$(until_next)"; first=""
  f="/backups/voka-$(date +%F).sql.gz"
  if dump_db "$f" -h voka-postgres; then
    rm -f /backups/FALHOU-ultimo-backup.txt
    find /backups -maxdepth 1 -name 'voka-????-??-??.sql.gz' -mtime +14 -delete
    echo "$(date -Is) backup ok: $f"
  else
    echo "$(date -Is) backup FALHOU" | tee /backups/FALHOU-ultimo-backup.txt
  fi
done
