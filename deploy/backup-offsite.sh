#!/usr/bin/env bash
# Cópia dos backups do Voka para FORA da VPS (outra máquina), por rsync sobre SSH.
# Não é ligada pelos scripts: o administrador agenda no cron depois de aprovar (ver LEIA-ME.md, "Cópia externa").
#   sudo bash deploy/backup-offsite.sh
# Configuração no deploy/.env:
#   VOKA_OFFSITE_DEST=usuario@maquina:/caminho/voka-backups/   (destino; conta própria, só para isto)
#   VOKA_OFFSITE_SSH_KEY=/root/.ssh/voka_offsite                (chave só para esta cópia)
#   VOKA_OFFSITE_SSH_PORT=22
# O que faz:
#   1. confere o último backup diário do banco;
#   2. empacota os uploads (volume voka_uploads) em backups/uploads/, confere o pacote;
#   3. envia deploy/backups/ com rsync (sem --delete: apagar aqui nunca apaga lá);
#   4. confere que o destino ficou igual (rsync --checksum --dry-run sem diferenças).
# Sucesso: backups/.copia-externa-ok. Falha: backups/FALHOU-copia-externa.txt (o smoke-test.sh acusa).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
load_env
: "${VOKA_OFFSITE_DEST:?Defina VOKA_OFFSITE_DEST no deploy/.env}"
KEY="${VOKA_OFFSITE_SSH_KEY:-/root/.ssh/voka_offsite}"
SSH="ssh -p ${VOKA_OFFSITE_SSH_PORT:-22} -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20"
MARK_OK=backups/.copia-externa-ok MARK_FAIL=backups/FALHOU-copia-externa.txt
log() { echo "$(date -Is) $*"; }
failed() { log "copia externa FALHOU: $1"; echo "$(date -Is) $1" > "$MARK_FAIL"; exit 1; }

exec 8>.voka-offsite.lock
flock -n 8 || { log "outra cópia externa já está em andamento"; exit 1; }
command -v rsync >/dev/null || failed "rsync não está instalado"
[ -r "$KEY" ] || failed "chave SSH $KEY não encontrada"

last=$(ls -1t backups/voka-????-??-??.sql.gz 2>/dev/null | head -1)
[ -n "$last" ] && verify_dump "$last" || failed "não há backup diário válido para enviar"
[ -z "$(find "$last" -mmin +1560)" ] || failed "o último backup diário tem mais de 26 h ($last)"

mkdir -p backups/uploads
up="backups/uploads/voka-uploads-$(date +%F).tgz"
docker exec voka-app tar czf - -C /data/uploads . > "$up.parcial" || { rm -f "$up.parcial"; failed "não foi possível empacotar os uploads"; }
tar -tzf "$up.parcial" >/dev/null || { rm -f "$up.parcial"; failed "pacote dos uploads inválido"; }
mv "$up.parcial" "$up"
find backups/uploads -name 'voka-uploads-*.tgz' -mtime +7 -delete

rsync -a --partial --exclude '*.parcial' --exclude '.copia-externa-ok' --exclude 'FALHOU-*' -e "$SSH" backups/ "$VOKA_OFFSITE_DEST" \
  || failed "rsync para o destino falhou"
diff=$(rsync -a --checksum --dry-run --itemize-changes --exclude '*.parcial' --exclude '.copia-externa-ok' --exclude 'FALHOU-*' \
  -e "$SSH" backups/ "$VOKA_OFFSITE_DEST") || failed "não foi possível conferir o destino"
[ -z "$diff" ] || failed "o destino ficou diferente da origem depois do envio"

rm -f "$MARK_FAIL"; date -Is > "$MARK_OK"
log "copia externa ok: $(basename "$last") e $(basename "$up") ($(du -sh backups | cut -f1) no total)"
