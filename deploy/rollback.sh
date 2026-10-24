#!/usr/bin/env bash
# Volta à versão registada pela última atualização (deploy/.ultima-atualizacao).
#   sudo bash deploy/rollback.sh            → programa anterior + banco do backup feito antes da atualização
#   sudo bash deploy/rollback.sh --manter-banco → só o programa (use quando a atualização não mudou o banco)
set -euo pipefail
. "$(dirname "$0")/lib.sh"
[ -f "$STATE" ] || { echo "Não há atualização registada ($STATE)."; exit 1; }
. "./$STATE"
docker image inspect "$IMAGEM_ANTERIOR" >/dev/null 2>&1 || { echo "A imagem anterior ($IMAGEM_ANTERIOR) não existe mais."; exit 1; }
keep_db=""; [ "${1:-}" = "--manter-banco" ] && keep_db=1
[ -n "$keep_db" ] || verify_dump "$BACKUP_ANTERIOR" || { echo "Backup $BACKUP_ANTERIOR ausente ou inválido."; exit 1; }
echo "Atualização de $QUANDO"
echo "  voltar para a imagem ${IMAGEM_ANTERIOR:7:12}"
[ -n "$keep_db" ] && echo "  banco: mantido como está" || echo "  banco: restaurado de $BACKUP_ANTERIOR (o que foi gravado depois disso se perde; o estado atual fica guardado num backup)"
lock
confirm "Fazer o rollback?"

if [ -z "$keep_db" ]; then VOKA_YES=1 VOKA_LOCKED=1 bash restore.sh "$BACKUP_ANTERIOR" --sem-ligar; fi
docker tag "$IMAGEM_ANTERIOR" voka-app:current
"${DC[@]}" up -d --no-deps --no-build app
wait_healthy || { echo "O voka-app não ficou saudável. Veja: ${DC[*]} logs app"; exit 1; }
[ "$(docker inspect -f '{{.Image}}' voka-app)" = "$IMAGEM_ANTERIOR" ] && echo "Rollback concluído: a rodar a imagem ${IMAGEM_ANTERIOR:7:12}." \
  || { echo "ERRO: o contentor não está na imagem anterior."; exit 1; }
mv "$STATE" "$STATE.feito-$(date +%Y%m%d-%H%M%S)"
