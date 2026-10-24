#!/usr/bin/env bash
# Testes depois da instalação/atualização. Só lê.   bash deploy/smoke-test.sh [--local]
set -uo pipefail
. "$(dirname "$0")/lib.sh"
load_env
APP="http://127.0.0.1:${VOKA_APP_PORT:-3001}"; LK="http://127.0.0.1:${VOKA_LIVEKIT_PORT:-7880}"

step "Contentores"
for n in voka-app voka-postgres voka-livekit voka-backup; do
  st=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$n" 2>/dev/null || echo "ausente")
  case "$st" in running*unhealthy*|ausente|exited*|restarting*) fail "$n: $st";; *) ok "$n: $st";; esac
done
pub=$(docker port voka-postgres 2>/dev/null); [ -z "$pub" ] && ok "PostgreSQL não está publicado" || fail "PostgreSQL publicado: $pub"

step "Acesso local (127.0.0.1)"
curl -fs "$APP/api/health" | grep -q '"ok":true' && ok "site/API em $APP" || fail "site/API não responde em $APP"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$LK/")" = 200 ] && ok "voz em $LK" || fail "voz não responde em $LK"

if [ "${1:-}" != "--local" ]; then
  D="https://$VOKA_DOMAIN"
  step "Pelo domínio (proxy reverso + HTTPS)"
  curl -fs --max-time 10 "$D/api/health" | grep -q '"ok":true' && ok "$D/api/health" || fail "$D/api/health não responde (proxy reverso ou DNS)"
  code=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "$D/rtc/validate")
  [ "$code" = 401 ] && ok "$D/rtc chega na voz (401 sem token é o esperado)" || fail "$D/rtc devolveu $code (esperado 401: falta a regra /rtc no proxy)"
  ws=$(curl -s -o /dev/null --http1.1 --max-time 5 -w '%{http_code}' -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
       -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$D/socket.io/?EIO=4&transport=websocket")
  [ "$ws" = 101 ] && ok "WebSocket do chat passa pelo proxy" || fail "WebSocket do chat devolveu $ws (esperado 101: falta 'Upgrade' no proxy)"
  exp=$(echo | timeout 8 openssl s_client -connect "$VOKA_DOMAIN:443" -servername "$VOKA_DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  [ -n "$exp" ] && ok "certificado válido até $exp" || fail "sem certificado HTTPS em $VOKA_DOMAIN"
  info "Portas das chamadas: teste de OUTRO computador:  nc -vz ${VOKA_PUBLIC_IP:-IP} ${VOKA_RTC_TCP_PORT:-7881}"
  info "e faça uma chamada de voz entre duas pessoas em redes diferentes (ex.: Wi-Fi e 4G)."
fi
step "Resumo"; echo "  $ERRORS erro(s), $WARNINGS aviso(s)."
[ "$ERRORS" = 0 ]
