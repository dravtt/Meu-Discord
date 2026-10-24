#!/usr/bin/env bash
# Restaura o banco do Voka a partir de um backup. APAGA os dados atuais do Voka (só do Voka).
#   sudo bash deploy/restore.sh backups/voka-AAAA-MM-DD.sql.gz
set -euo pipefail
. "$(dirname "$0")/lib.sh"
f="${1:?Informe o arquivo de backup, ex.: backups/voka-2026-10-24.sql.gz}"
[ -f "$f" ] || { echo "Arquivo não encontrado: $f"; exit 1; }
gzip -t "$f" || { echo "Backup corrompido: $f"; exit 1; }
confirm "Isto apaga os dados atuais do Voka e restaura $f."
mkdir -p backups
safety="backups/voka-antes-restore-$(date +%F-%H%M%S).sql.gz"
docker exec voka-postgres pg_dump -U voka voka | gzip > "$safety" && echo "Cópia de segurança do estado atual: $safety"
docker stop voka-app voka-backup >/dev/null
docker exec voka-postgres sh -c 'dropdb -U voka --force voka && createdb -U voka voka'
gunzip -c "$f" | docker exec -i voka-postgres psql -q -v ON_ERROR_STOP=1 -U voka voka
docker start voka-backup >/dev/null
[ "${2:-}" = "--no-start" ] || { docker start voka-app >/dev/null; wait_healthy && echo "Restaurado e ligado."; }
