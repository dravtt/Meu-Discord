# Shared helpers for the Voka deploy scripts (sourced, not run).
cd "$(dirname "${BASH_SOURCE[0]}")"
DC=(docker compose -f docker-compose.yml)
ok()   { printf '  \e[32mOK\e[0m       %s\n' "$*"; }
warn() { printf '  \e[33mATENÇÃO\e[0m  %s\n' "$*"; WARNINGS=$((WARNINGS+1)); }
fail() { printf '  \e[31mERRO\e[0m     %s\n' "$*"; ERRORS=$((ERRORS+1)); }
info() { printf '  ·        %s\n' "$*"; }
step() { printf '\n\e[1m== %s\e[0m\n' "$*"; }
WARNINGS=0; ERRORS=0
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
