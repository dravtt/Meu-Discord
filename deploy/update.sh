#!/usr/bin/env bash
# Atualiza o Voka para o código desta pasta (ex.: depois de git pull).
#   sudo bash deploy/update.sh
# Antes de trocar: backup verificado do banco e registo da versão exata em uso (deploy/.ultima-atualizacao),
# que o rollback.sh usa para voltar.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
load_env
voka_running || { echo "O Voka não está ligado. Para instalar use install.sh."; exit 1; }
prev_id=$(docker inspect -f '{{.Image}}' voka-app)
lock
confirm "Atualizar o Voka? (backup do banco + nova versão; o site fica indisponível ~30 s)"

step "Backup verificado do banco"
bk=$(backup_now antes-update); echo "  $bk"

step "Registando a versão atual para rollback"
docker tag "$prev_id" "voka-app:antes-$(date +%Y%m%d-%H%M%S)"
docker tag "$prev_id" voka-app:previous
cat > "$STATE" <<S
QUANDO=$(date -Is)
IMAGEM_ANTERIOR=$prev_id
BACKUP_ANTERIOR=$bk
S
echo "  imagem anterior: ${prev_id:7:12}"

step "Construindo a versão nova"
build_app
"${DC[@]}" up -d --no-deps --no-build app
if wait_healthy && bash smoke-test.sh --local; then
  echo; echo "Atualizado. Para voltar:  sudo bash deploy/rollback.sh"
else
  echo; echo "A versão nova NÃO ficou saudável. Volte com:  sudo bash deploy/rollback.sh"; exit 1
fi
