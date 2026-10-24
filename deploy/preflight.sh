#!/usr/bin/env bash
# Verificação ANTES da instalação. Só LÊ: não cria, não apaga e não altera nada na VPS.
# Comandos usados: docker ps/network ls/volume ls, nproc, free, df, swapon --show, ss, ufw status,
# iptables -S (só listagem), getent, docker buildx version/inspect, command -v rsync, curl (IP público, só se VOKA_PUBLIC_IP estiver vazio), openssl s_client.
#   bash deploy/preflight.sh [dominio]        (com sudo, também lista as regras de firewall)
set -uo pipefail
. "$(dirname "$0")/lib.sh"
load_env
DOMAIN="${1:-${VOKA_DOMAIN:-}}"
APP_PORT="${VOKA_APP_PORT:-3001}"; LK_PORT="${VOKA_LIVEKIT_PORT:-7880}"
TCP_PORT="${VOKA_RTC_TCP_PORT:-7881}"; UDP_PORT="${VOKA_RTC_UDP_PORT:-7882}"

step "Arquivos do kit"
crlf=$(grep -l $'\r' ../Dockerfile ./*.sh ./*.yml ./*.template ./.env.example ./proxy-examples/* 2>/dev/null)
[ -z "$crlf" ] && ok "sem quebras de linha do Windows (CRLF)" || fail "arquivos com CRLF (vieram do Windows): $(echo $crlf). Gere o kit com 'git archive' (LEIA-ME.md, passo 0)"
for f in ./*.sh; do bash -n "$f" 2>/dev/null || fail "erro de sintaxe em $f"; done; ok "sintaxe dos scripts (bash -n)"

step "Docker"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  ok "$(docker --version | cut -d, -f1), $(docker compose version --short 2>/dev/null | sed 's/^/compose /')"
else fail "Docker ou o plugin 'docker compose' não encontrado"; fi
if docker buildx version >/dev/null 2>&1; then ok "buildx $(docker buildx version | awk '{print $2}'): build num contentor próprio com teto de CPU/RAM"
else ok "sem buildx: o build usa o builder clássico do Docker, com o mesmo teto de CPU/RAM (nada a instalar)"; fi
docker buildx inspect voka-builder >/dev/null 2>&1 && info "builder voka-builder já existe (cache do build do Voka)"
for n in voka-app voka-postgres voka-livekit voka-backup; do
  docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$n" && info "contentor $n já existe (instalação anterior do Voka)"
done
docker network ls --format '{{.Name}}' 2>/dev/null | grep -qx voka_net && info "rede voka_net já existe"
for v in voka_pgdata voka_uploads; do docker volume ls --format '{{.Name}}' 2>/dev/null | grep -qx "$v" && info "volume $v já existe (dados preservados)"; done

step "Recursos"
info "CPU: $(nproc) vCPU · RAM livre: $(free -h | awk '/^Mem/{print $7}') de $(free -h | awk '/^Mem/{print $2}')"
avail_gb=$(df -BG --output=avail . | tail -1 | tr -dc 0-9)
[ "${avail_gb:-0}" -ge 20 ] && ok "disco livre: ${avail_gb} GB" || warn "disco livre: ${avail_gb} GB (recomendado: 20 GB ou mais)"
if [ "$(swapon --noheadings | wc -l)" = 0 ]; then warn "sem swap. Proposta (só com aprovação do administrador): ver 'Swap' no LEIA-ME.md"; else ok "swap ativa: $(swapon --noheadings --show=SIZE | paste -sd+)"; fi

step "Portas internas do Voka (devem estar livres; só 127.0.0.1)"
for p in "$APP_PORT" "$LK_PORT"; do
  if port_busy_tcp "$p"; then
    if voka_running; then info "TCP $p em uso (pelo próprio Voka já instalado)"; else fail "TCP $p já está em uso por '$(who_port "$p")'. Mude no deploy/.env"; fi
  else ok "TCP 127.0.0.1:$p livre"; fi
done

step "Portas públicas das chamadas"
if port_busy_tcp "$TCP_PORT" && ! voka_running; then fail "TCP $TCP_PORT já está em uso por '$(who_port "$TCP_PORT")'"; else ok "TCP $TCP_PORT livre na VPS"; fi
if port_busy_udp "$UDP_PORT" && ! voka_running; then fail "UDP $UDP_PORT já está em uso"; else ok "UDP $UDP_PORT livre na VPS"; fi

step "Proxy reverso existente (portas 80/443, não será alterado)"
for p in 80 443; do
  if port_busy_tcp "$p"; then info "TCP $p: '$(who_port "$p")'"; else warn "nada escutando na porta $p"; fi
done
if who_port 443 | grep -q docker-proxy; then
  warn "a porta 443 é de um contentor Docker, mas este kit supõe o nginx instalado na VPS (fora do Docker)."
  info "   Não instale: os exemplos de proxy-examples/ apontam para 127.0.0.1. Reveja o plano do proxy antes."
fi

step "Firewall do servidor"
[ "$(id -u)" = 0 ] || info "sem sudo: as regras de firewall não podem ser listadas (rode com sudo para vê-las; continua só leitura)"
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  for rule in "$TCP_PORT/tcp" "$UDP_PORT/udp"; do
    ufw status | grep -q "^$rule .*ALLOW" && ok "ufw libera $rule" || warn "ufw ativo e sem regra para $rule"
  done
else info "ufw inativo"; fi
if command -v iptables >/dev/null && iptables -S INPUT 2>/dev/null | grep -qE -- '-j (REJECT|DROP)|-P INPUT DROP'; then
  info "iptables INPUT tem regras de bloqueio (comum nas imagens Oracle). Portas publicadas pelo Docker passam pela cadeia DOCKER, mas confira:"
  iptables -S INPUT 2>/dev/null | sed 's/^/             /' | head -12
fi
info "O firewall do PROVEDOR (HostGator/Oracle 'Security List') não pode ser visto daqui:"
info "   ele precisa liberar entrada TCP $TCP_PORT e UDP $UDP_PORT."

step "IP público e DNS"
PUBIP="${VOKA_PUBLIC_IP:-$(curl -fs4 --max-time 8 https://api.ipify.org || true)}"
[ -n "$PUBIP" ] && ok "IP público: $PUBIP" || warn "não deu para descobrir o IP público (preencha VOKA_PUBLIC_IP no .env)"
if [ -n "$DOMAIN" ]; then
  dns=$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u | paste -sd' ')
  if [ -z "$dns" ]; then warn "$DOMAIN ainda não resolve no DNS"
  elif [ -n "$PUBIP" ] && echo " $dns " | grep -q " $PUBIP "; then ok "$DOMAIN → $dns"
  else warn "$DOMAIN → $dns (esperado: $PUBIP)"; fi

  step "Certificado HTTPS de $DOMAIN (emitido pelo proxy existente)"
  cert=$(echo | timeout 8 openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -subject -enddate 2>/dev/null)
  if [ -n "$cert" ]; then
    echo "$cert" | sed 's/^/  ·        /'
    echo | timeout 8 openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" -verify_return_error 2>/dev/null </dev/null | grep -q "Verify return code: 0" \
      && ok "certificado válido para $DOMAIN" || warn "certificado não é válido para $DOMAIN (o proxy ainda precisa emitir)"
  else warn "sem certificado em $DOMAIN:443 ainda (normal antes de configurar o proxy)"; fi
else info "sem domínio informado: rode  bash deploy/preflight.sh vokaapp.com.br  para checar DNS e certificado"; fi

step "Cópia externa dos backups"
command -v rsync >/dev/null && ok "rsync instalado" || warn "rsync não instalado (necessário para backup-offsite.sh)"
if [ -n "${VOKA_OFFSITE_DEST:-}" ]; then info "destino: ${VOKA_OFFSITE_DEST%%:*} (conexão testada só pelo backup-offsite.sh)"
else warn "VOKA_OFFSITE_DEST vazio: os backups ficam só nesta VPS (ver LEIA-ME.md, \"Cópia externa\")"; fi

step "Resumo"
echo "  $ERRORS erro(s), $WARNINGS aviso(s). Nada foi alterado."
[ "$ERRORS" = 0 ]
