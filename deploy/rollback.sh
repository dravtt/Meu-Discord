#!/usr/bin/env bash
# Volta o Voka para a versão anterior à última atualização.
#   sudo bash deploy/rollback.sh                       → só troca o programa
#   sudo bash deploy/rollback.sh backups/ARQUIVO.sql.gz → troca o programa E restaura o banco desse backup
# Restaure o banco quando a versão nova tiver mudado a estrutura dele (migrations).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
docker image inspect voka-app:previous >/dev/null 2>&1 || { echo "Não há versão anterior guardada (voka-app:previous)."; exit 1; }
confirm "Voltar o Voka para a versão anterior${1:+ e restaurar o banco de $1}?"
docker tag voka-app:previous voka-app:current
[ -n "${1:-}" ] && VOKA_YES=1 bash restore.sh "$1" --no-start
"${DC[@]}" up -d --no-build app
wait_healthy && echo "Rollback concluído." || { echo "O voka-app não ficou saudável. Veja: ${DC[*]} logs app"; exit 1; }
