#!/usr/bin/env bash
# Testes depois da instalação/atualização. Só lê.   bash deploy/smoke-test.sh [--local]
set -uo pipefail
. "$(dirname "$0")/lib.sh"
load_env
APP="http://127.0.0.1:${VOKA_APP_PORT:-3001}"; LK="http://127.0.0.1:${VOKA_LIVEKIT_PORT:-7880}"

step "Contentores (todos devem estar running + healthy, sem reinícios)"
for n in voka-app voka-postgres voka-livekit voka-backup; do
  st=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}sem-healthcheck{{end}} {{.RestartCount}}' "$n" 2>/dev/null || echo "ausente - -")
  read -r run health restarts <<<"$st"
  if [ "$run" = running ] && [ "$health" = healthy ] && [ "$restarts" = 0 ]; then ok "$n: running, healthy"
  else fail "$n: estado=$run saúde=$health reinícios=$restarts"; fi
done
pub=$(docker port voka-postgres 2>/dev/null); [ -z "$pub" ] && ok "PostgreSQL sem porta publicada" || fail "PostgreSQL publicado: $pub"
docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' voka-app voka-postgres voka-livekit voka-backup | grep -vqx 'voka_net ' \
  && fail "algum contentor do Voka está fora da rede voka_net (ou noutra rede)" || ok "todos só na rede voka_net"

step "Limites efetivos (docker inspect)"
tot_cpu=0; tot_mem=0
for n in voka-app voka-postgres voka-livekit voka-backup; do
  read -r cpu mem <<<"$(docker inspect -f '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}' "$n" 2>/dev/null || echo "0 0")"
  [ "$cpu" -gt 0 ] && [ "$mem" -gt 0 ] || fail "$n sem limite de CPU/memória"
  info "$n: $(awk "BEGIN{print $cpu/1e9}") vCPU, $((mem/1024/1024)) MB"
  tot_cpu=$((tot_cpu+cpu)); tot_mem=$((tot_mem+mem))
done
if [ "$tot_cpu" -le 2000000000 ] && [ "$tot_mem" -le $((4*1024*1024*1024)) ]; then ok "total: $(awk "BEGIN{print $tot_cpu/1e9}") vCPU, $((tot_mem/1024/1024)) MB (limite combinado: 2 vCPU / 4096 MB)"
else fail "total acima do combinado: $(awk "BEGIN{print $tot_cpu/1e9}") vCPU, $((tot_mem/1024/1024)) MB"; fi

step "Administração (sem mostrar valores)"
envs=$(docker exec voka-app printenv 2>/dev/null | cut -d= -f1)
n=$(docker exec voka-app printenv NEXO_ADMIN_EMAILS 2>/dev/null | tr ',' '\n' | grep -c @ || true)
[ "$n" -gt 0 ] && ok "NEXO_ADMIN_EMAILS com $n e-mail(s)" || fail "NEXO_ADMIN_EMAILS vazio no voka-app"
grep -qx NEXO_ADMINS <<< "$envs" && fail "NEXO_ADMINS definido (remova; em produção só vale NEXO_ADMIN_EMAILS)" || ok "sem NEXO_ADMINS"
grep -qx NEXO_FIRST_USER_ADMIN <<< "$envs" && fail "NEXO_FIRST_USER_ADMIN definido (remova)" || ok "primeira conta não vira admin"
[ "$(docker exec voka-app printenv NODE_ENV 2>/dev/null)" = production ] && ok "NODE_ENV=production" || fail "NODE_ENV não é production"

step "Backup"
last=$(ls -1t backups/voka-????-??-??.sql.gz 2>/dev/null | head -1)
if [ -f backups/FALHOU-ultimo-backup.txt ]; then fail "o último backup automático falhou: $(cat backups/FALHOU-ultimo-backup.txt)"
elif [ -z "$last" ]; then warn "ainda não há backup automático"
elif ! verify_dump "$last"; then fail "backup $last inválido"
elif [ -n "$(find "$last" -mmin +1560)" ]; then fail "último backup tem mais de 26 h: $last"
else ok "último backup válido: $last ($(du -h "$last" | cut -f1))"; fi
if [ -f backups/FALHOU-copia-externa.txt ]; then fail "a última cópia externa falhou: $(cat backups/FALHOU-copia-externa.txt)"
elif [ -z "${VOKA_OFFSITE_DEST:-}" ]; then warn "cópia externa dos backups ainda não configurada (LEIA-ME.md, \"Cópia externa\")"
elif [ ! -f backups/.copia-externa-ok ]; then warn "cópia externa configurada, mas ainda não rodou"
elif [ -n "$(find backups/.copia-externa-ok -mmin +1560)" ]; then fail "última cópia externa tem mais de 26 h ($(cat backups/.copia-externa-ok))"
else ok "cópia externa em dia ($(cat backups/.copia-externa-ok))"; fi
[ "$(stat -c %a backups)" = 700 ] && ok "pasta backups com permissão 700" || warn "pasta backups com permissão $(stat -c %a backups) (esperado 700)"
for f in .env livekit.yaml; do [ "$(stat -c %a "$f" 2>/dev/null)" = 600 ] && ok "$f com permissão 600" || fail "$f sem permissão 600"; done

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
