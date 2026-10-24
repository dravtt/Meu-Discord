#!/usr/bin/env bash
# Atualiza o Voka para o código desta pasta, com backup antes e a versão anterior guardada para rollback.
#   (copie/baixe o código novo para esta pasta, ex.: git pull)   sudo bash deploy/update.sh
set -euo pipefail
. "$(dirname "$0")/lib.sh"
load_env
voka_running || { echo "O Voka não está instalado/ligado. Use install.sh."; exit 1; }
confirm "Atualizar o Voka (backup do banco + nova imagem)?"
mkdir -p backups
f="backups/voka-antes-update-$(date +%F-%H%M%S).sql.gz"
step "Backup do banco em $f"
docker exec voka-postgres pg_dump -U voka voka | gzip > "$f.tmp" && mv "$f.tmp" "$f"
step "Guardando a versão atual como voka-app:previous"
docker tag voka-app:current voka-app:previous
step "Construindo a versão nova"
"${DC[@]}" build app
"${DC[@]}" up -d app
if wait_healthy && bash smoke-test.sh --local; then
  echo "Atualizado. Se algo estiver errado: sudo bash deploy/rollback.sh"
else
  echo "A versão nova não ficou saudável. Volte com:  sudo bash deploy/rollback.sh $f"; exit 1
fi
