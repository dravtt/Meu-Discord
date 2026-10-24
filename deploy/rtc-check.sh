#!/usr/bin/env bash
# Verificação das chamadas (WebRTC). Só lê; o token gerado vale 10 minutos e só entra na sala "teste-conexao".
#   bash deploy/rtc-check.sh
set -uo pipefail
. "$(dirname "$0")/lib.sh"
load_env
TCP="${VOKA_RTC_TCP_PORT:-7881}"; UDP="${VOKA_RTC_UDP_PORT:-7882}"

step "Publicação das portas de mídia"
ports=$(docker port voka-livekit 2>/dev/null)
echo "$ports" | grep -q "^$TCP/tcp -> 0.0.0.0:$TCP" && ok "TCP $TCP publicada" || fail "TCP $TCP não publicada"
echo "$ports" | grep -q "^$UDP/udp -> 0.0.0.0:$UDP" && ok "UDP $UDP publicada" || fail "UDP $UDP não publicada"
echo "$ports" | grep -q "^7880/tcp -> 127.0.0.1:" && ok "sinal (7880) só em 127.0.0.1" || fail "porta 7880 exposta além de 127.0.0.1"

step "IP anunciado às chamadas"
cfg_ip=$(awk '/node_ip:/{print $2}' livekit.yaml)
info "livekit.yaml node_ip: $cfg_ip"
[ "$cfg_ip" = "${VOKA_PUBLIC_IP:-}" ] && ok "igual ao VOKA_PUBLIC_IP" || fail "diferente do VOKA_PUBLIC_IP (${VOKA_PUBLIC_IP:-vazio}): rode install.sh de novo"

step "Sinal pelo domínio"
code=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "https://$VOKA_DOMAIN/rtc/validate")
[ "$code" = 401 ] && ok "https://$VOKA_DOMAIN/rtc chega ao LiveKit" || fail "https://$VOKA_DOMAIN/rtc devolveu $code (esperado 401)"
ws=$(curl -s -o /dev/null --http1.1 --max-time 5 -w '%{http_code}' -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "https://$VOKA_DOMAIN/rtc")
[ "$ws" = 401 ] || [ "$ws" = 101 ] && ok "WebSocket /rtc atravessa o nginx (resposta $ws do LiveKit)" || fail "WebSocket /rtc devolveu $ws"

step "Teste de conexão completo (de fora da VPS)"
token=$(docker exec voka-app node -e "import('livekit-server-sdk').then(async ({ AccessToken }) => {
  const t = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: 'teste-' + Date.now(), ttl: '10m' });
  t.addGrant({ roomJoin: true, room: 'teste-conexao' }); console.log(await t.toJwt());
})" 2>/dev/null)
if [ -n "$token" ]; then
  info "1. De um computador FORA da VPS, abra o teste oficial do LiveKit:  https://livekit.io/connection-test"
  info "   URL:   wss://$VOKA_DOMAIN"
  info "   Token: $token"
  info "   Ele testa WebSocket, UDP $UDP e TCP $TCP. Faça-o em duas redes (Wi-Fi e 4G)."
else fail "não deu para gerar o token de teste"; fi
info "2. Porta TCP de outro computador:  nc -vz ${VOKA_PUBLIC_IP:-IP} $TCP"
info "3. Chamada real no Voka entre duas pessoas em redes diferentes, com áudio nos dois sentidos."
step "Resumo"; echo "  $ERRORS erro(s)."
[ "$ERRORS" = 0 ]
