#!/usr/bin/env bash
# Restaura o banco do Voka a partir de um backup, de forma segura:
#   1. confere o arquivo;  2. guarda o estado atual num backup;  3. carrega o backup num banco TEMPORÁRIO;
#   4. só se tudo correu bem, troca os nomes (o banco antigo fica guardado como voka_antigo_<data>).
#   sudo bash deploy/restore.sh backups/voka-AAAA-MM-DD.sql.gz
set -euo pipefail
. "$(dirname "$0")/lib.sh"
f="${1:?Informe o backup, ex.: backups/voka-2026-10-24.sql.gz}"
verify_dump "$f" || { echo "Backup inválido ou incompleto: $f. Nada foi alterado."; exit 1; }
lock
confirm "Substituir os dados atuais do Voka pelos de $f?"
ts=$(date +%Y%m%d_%H%M%S)

step "Guardando o estado atual"
safety=$(backup_now antes-restore); echo "  $safety"

step "Carregando o backup num banco temporário (voka_restaurando)"
psql_voka postgres -q -c "DROP DATABASE IF EXISTS voka_restaurando" -c "CREATE DATABASE voka_restaurando OWNER voka"
if ! gzip -dc "$f" | psql_voka voka_restaurando -q --single-transaction >/dev/null; then
  psql_voka postgres -q -c "DROP DATABASE voka_restaurando"
  echo "ERRO ao carregar o backup. O banco atual não foi tocado."; exit 1
fi

step "Trocando os bancos (o Voka fica parado alguns segundos)"
app_was_running=$(docker inspect -f '{{.State.Running}}' voka-app 2>/dev/null || echo false)
# If anything below fails, put the original database back under its name and turn the services on again.
recover() {
  echo "ERRO na troca. Recuperando o estado anterior…"
  if psql_voka postgres -tAc "SELECT 1 FROM pg_database WHERE datname='voka_antigo_$ts'" | grep -q 1; then
    psql_voka postgres -tAc "SELECT 1 FROM pg_database WHERE datname='voka'" | grep -q 1 \
      && psql_voka postgres -q -c "ALTER DATABASE voka RENAME TO voka_falhou_$ts"
    psql_voka postgres -q -c "ALTER DATABASE voka_antigo_$ts RENAME TO voka"
  fi
  psql_voka postgres -q -c "DROP DATABASE IF EXISTS voka_restaurando" >/dev/null 2>&1 || true
  docker start voka-backup >/dev/null || true
  [ "$app_was_running" = true ] && docker start voka-app >/dev/null || true
  echo "Banco original de volta. Cópia de segurança extra: $safety"
  exit 1
}
trap recover ERR
docker stop voka-app voka-backup >/dev/null
psql_voka postgres -q -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('voka','voka_restaurando') AND pid <> pg_backend_pid()" >/dev/null
psql_voka postgres -q -c "ALTER DATABASE voka RENAME TO voka_antigo_$ts"
[ -z "${VOKA_TESTE_FALHA_TROCA:-}" ]   # test hook: simulates a failure between the two renames
psql_voka postgres -q -c "ALTER DATABASE voka_restaurando RENAME TO voka"
trap - ERR
docker start voka-backup >/dev/null
echo "  banco anterior guardado como voka_antigo_$ts"
echo "  (quando tiver certeza, apague com: docker exec voka-postgres dropdb -U voka voka_antigo_$ts)"
if [ "${2:-}" != "--sem-ligar" ]; then
  docker start voka-app >/dev/null
  wait_healthy && echo "Restaurado e ligado." || { echo "O voka-app não ficou saudável depois da restauração. Veja os logs."; exit 1; }
fi
