#!/usr/bin/env bash
# Instala ou atualiza o Voka nesta VPS. Rode dentro da pasta do projeto:  sudo bash deploy/install.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ "$(id -u)" -ne 0 ]; then echo "Rode com sudo:  sudo bash deploy/install.sh"; exit 1; fi

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "==> Instalando o Docker…"
  curl -fsSL https://get.docker.com | sh
fi

rand() { openssl rand -hex "$1"; }

if [ ! -f .env ]; then
  echo "==> Primeira instalação: vamos criar a configuração."
  domain="${VOKA_DOMAIN:-}"
  while [ -z "$domain" ]; do read -rp "Domínio do Voka (ex.: vokaapp.com.br): " domain; done
  domain="${domain#http://}"; domain="${domain#https://}"; domain="${domain%%/*}"
  profile="caddy"
  if [ -z "${VOKA_NO_CADDY:-}" ] && ss -ltn '( sport = :80 or sport = :443 )' 2>/dev/null | grep -q LISTEN; then
    echo "!! Já existe um programa usando a porta 80 ou 443 nesta VPS."
    echo "   O Voka vai ficar em 127.0.0.1:3001 (site) e 127.0.0.1:7880 (voz), e esse programa deve repassar o domínio para lá."
    echo "   Veja a seção 'Portas 80/443 ocupadas' no deploy/LEIA-ME.md."
    profile=""
  fi
  [ -n "${VOKA_NO_CADDY:-}" ] && profile=""
  cat > .env <<CFG
# Configuração do Voka. Não mande este arquivo para ninguém: ele tem senhas.
VOKA_DOMAIN=$domain
COMPOSE_PROFILES=$profile
DB_PASSWORD=$(rand 24)
JWT_SECRET=$(rand 32)
LIVEKIT_API_KEY=voka$(rand 6)
LIVEKIT_API_SECRET=$(rand 32)
# Portas internas (só mude se já estiverem em uso nesta VPS)
VOKA_APP_PORT=3001
VOKA_LIVEKIT_PORT=7880

# E-mails de verificação. Com Gmail: senha de app, sem espaços, e o @ escrito como %40.
# SMTP_URL=smtps://seuemail%40gmail.com:SENHADEAPP@smtp.gmail.com:465
# MAIL_FROM=Voka <seuemail@gmail.com>
# Contas que veem Configurações > Administração (separe por vírgula). Vazio: a primeira conta criada.
# NEXO_ADMINS=
CFG
  chmod 600 .env
  echo "==> Configuração criada em deploy/.env"
fi

set -a; . ./.env; set +a
# Public IP for calls: VOKA_PUBLIC_IP in .env, else asked from the internet, else LiveKit finds it by STUN.
ip="${VOKA_PUBLIC_IP:-$(curl -fs4 --max-time 10 https://api.ipify.org || true)}"
if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then rtc_ip="node_ip: $ip"; echo "==> IP público da VPS: $ip"; else rtc_ip="use_external_ip: true"; fi
sed -e "s/__KEY__/$LIVEKIT_API_KEY/" -e "s/__SECRET__/$LIVEKIT_API_SECRET/" -e "s/__RTC_IP__/$rtc_ip/" livekit.yaml.template > livekit.yaml
chmod 600 livekit.yaml
mkdir -p backups

# Swap: protege contra travamentos se a memória acabar. Só cria se ainda não existir nenhuma.
if [ -z "${VOKA_NO_SWAP:-}" ] && [ "$(swapon --noheadings | wc -l)" = 0 ] && [ ! -f /swapfile ]; then
  echo "==> Criando 4 GB de swap…"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Construindo e ligando o Voka (a primeira vez demora uns minutos)…"
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null

echo
echo "Pronto! O Voka está ligado."
if [ -n "${COMPOSE_PROFILES:-}" ]; then
  echo "Abra: https://$VOKA_DOMAIN  (o cadeado HTTPS pode levar 1 minuto na primeira vez)"
else
  echo "Site em 127.0.0.1:${VOKA_APP_PORT:-3001} e voz em 127.0.0.1:${VOKA_LIVEKIT_PORT:-7880}: configure o servidor web da VPS."
fi
echo "Lembre de liberar no firewall: TCP 80, 443 e 7881, e UDP 443 e 7882."
