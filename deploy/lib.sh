# Shared helpers for the Voka deploy scripts (sourced, not run).
cd "$(dirname "${BASH_SOURCE[0]}")"
DC=(docker compose -f docker-compose.yml)
ok()   { printf '  \e[32mOK\e[0m       %s\n' "$*"; }
warn() { printf '  \e[33mATENÇÃO\e[0m  %s\n' "$*"; WARNINGS=$((WARNINGS+1)); }
fail() { printf '  \e[31mERRO\e[0m     %s\n' "$*"; ERRORS=$((ERRORS+1)); }
info() { printf '  ·        %s\n' "$*"; }
step() { printf '\n\e[1m== %s\e[0m\n' "$*"; }
WARNINGS=0; ERRORS=0
. ./backup-lib.sh
# On the host, pg_dump/psql run inside the Voka database container.
pg_dump() { docker exec voka-postgres pg_dump "$@"; }
psql_voka() { docker exec -i voka-postgres psql -v ON_ERROR_STOP=1 -U voka "$@"; }
# backup_now LABEL: verified dump in backups/voka-LABEL-<timestamp>.sql.gz, prints the path; fails loudly.
backup_now() {
  mkdir -p backups
  local f="backups/voka-$1-$(date +%F-%H%M%S).sql.gz"
  dump_db "$f" || { echo "ERRO: o backup do banco falhou. Nada foi alterado." >&2; return 1; }
  echo "$f"
}
STATE=.ultima-atualizacao
# Only one of install/update/rollback/restore at a time.
lock() {
  [ -n "${VOKA_LOCKED:-}" ] && return 0   # called from a script that already holds the lock
  exec 9>.voka.lock
  flock -n 9 && export VOKA_LOCKED=1 || { echo "Outra operação do Voka (install/update/rollback/restore) está em andamento. Tente depois."; exit 1; }
}
load_env() { if [ -f .env ]; then set -a; . ./.env; set +a; fi; }
confirm() {
  [ -n "${VOKA_YES:-}" ] && return 0
  read -rp "$1 Digite SIM para continuar: " a; [ "$a" = "SIM" ] || { echo "Cancelado. Nada foi alterado."; exit 1; }
}
port_busy_tcp() { ss -Hltn "( sport = :$1 )" 2>/dev/null | grep -q .; }
port_busy_udp() { ss -Hlun "( sport = :$1 )" 2>/dev/null | grep -q .; }
who_port() { ss -Hltnp "( sport = :$1 )" 2>/dev/null | grep -o 'users:(("[^"]*"' | head -1 | cut -d'"' -f2; }
voka_running() { docker ps --format '{{.Names}}' | grep -q '^voka-app$'; }
wait_healthy() {
  for _ in $(seq 1 40); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' voka-app 2>/dev/null)" = healthy ] && return 0; sleep 3
  done; return 1
}
# The image is built inside a dedicated BuildKit container ("voka-builder") with its own CPU/RAM ceiling,
# so the build (npm ci, vite) cannot take resources from the other TOWER services.
# It is stopped again right after the build; the build cache stays in its own volume.
BUILDER=voka-builder
build_app() {
  local cpus="${VOKA_BUILD_CPUS:-2}" mem="${VOKA_BUILD_MEMORY:-3g}"
  if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
    docker buildx create --name "$BUILDER" --driver docker-container \
      --driver-opt "cpu-period=100000" --driver-opt "cpu-quota=$(awk "BEGIN{print int($cpus*100000)}")" \
      --driver-opt "memory=$mem" --driver-opt "memory-swap=$mem" \
      ${VOKA_BUILDKIT_IMAGE:+--driver-opt "image=$VOKA_BUILDKIT_IMAGE"} ${VOKA_BUILDKIT_CONFIG:+--buildkitd-config "$VOKA_BUILDKIT_CONFIG"} >/dev/null
  fi
  info "build limitado a $cpus vCPU e $mem de RAM (contentor buildx_buildkit_${BUILDER}0)"
  local rc=0
  docker buildx build --builder "$BUILDER" --load -t voka-app:current -f ../Dockerfile .. || rc=$?
  docker buildx stop "$BUILDER" >/dev/null 2>&1 || true
  return $rc
}
