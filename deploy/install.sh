#!/usr/bin/env bash
# Instala o Voka. Não mexe em swap, firewall, proxy reverso nem em outros contentores.
#   1ª vez:  sudo bash deploy/install.sh      → cria deploy/.env e para, para revisão
#   2ª vez:  sudo bash deploy/install.sh      → mostra o plano, pede SIM e liga o Voka
set -euo pipefail
. "$(dirname "$0")/lib.sh"
command -v docker >/dev/null && docker compose version >/dev/null 2>&1 || { echo "Docker com 'docker compose' é necessário."; exit 1; }
rand() { openssl rand -hex "$1"; }

if [ ! -f .env ]; then
  domain="${VOKA_DOMAIN:-}"
  while [ -z "$domain" ]; do read -rp "Domínio do Voka (ex.: vokaapp.com.br): " domain; done
  domain="${domain#http://}"; domain="${domain#https://}"; domain="${domain%%/*}"
  ip="${VOKA_PUBLIC_IP:-$(curl -fs4 --max-time 8 https://api.ipify.org || true)}"
  sed -e "s|^VOKA_DOMAIN=.*|VOKA_DOMAIN=$domain|" -e "s|^VOKA_PUBLIC_IP=.*|VOKA_PUBLIC_IP=$ip|" \
      -e "s|^DB_PASSWORD=.*|DB_PASSWORD=$(rand 24)|" -e "s|^JWT_SECRET=.*|JWT_SECRET=$(rand 32)|" \
      -e "s|^LIVEKIT_API_KEY=.*|LIVEKIT_API_KEY=voka$(rand 6)|" -e "s|^LIVEKIT_API_SECRET=.*|LIVEKIT_API_SECRET=$(rand 32)|" \
      .env.example > .env
  chmod 600 .env
  echo "Criado deploy/.env (com senhas novas). Revise-o (domínio, IP, portas, SMTP) e rode este script de novo."
  exit 0
fi

lock
load_env
[ -n "${VOKA_ADMIN_OK:-}${NEXO_ADMIN_EMAILS:-}${NEXO_ADMINS:-}" ] || { echo "Defina NEXO_ADMIN_EMAILS no deploy/.env (e-mail de quem administra o Voka)."; exit 1; }
[ -n "${VOKA_PUBLIC_IP:-}" ] || { echo "Preencha VOKA_PUBLIC_IP no deploy/.env (o preflight.sh mostra o valor)."; exit 1; }
for v in VOKA_DOMAIN DB_PASSWORD JWT_SECRET LIVEKIT_API_KEY LIVEKIT_API_SECRET; do [ -n "${!v:-}" ] || { echo "Falta $v no deploy/.env"; exit 1; }; done

bash preflight.sh || { echo; echo "O preflight encontrou erros. Corrija antes de instalar."; exit 1; }

cat <<PLAN

== O que vai acontecer
  · construir a imagem voka-app (código desta pasta)
  · criar (se não existirem) a rede voka_net e os volumes voka_pgdata e voka_uploads
  · ligar os contentores voka-app, voka-postgres, voka-livekit e voka-backup
      site      → 127.0.0.1:${VOKA_APP_PORT:-3001}     voz (sinal) → 127.0.0.1:${VOKA_LIVEKIT_PORT:-7880}
      chamadas  → TCP ${VOKA_RTC_TCP_PORT:-7881} e UDP ${VOKA_RTC_UDP_PORT:-7882} em todas as interfaces
  · NÃO altera: swap, firewall, proxy reverso (nginx), outros contentores ou bancos
PLAN
confirm "Instalar o Voka nesta VPS?"

sed -e "s/__KEY__/$LIVEKIT_API_KEY/" -e "s/__SECRET__/$LIVEKIT_API_SECRET/" -e "s/__PUBLIC_IP__/$VOKA_PUBLIC_IP/" \
    -e "s/__TCP_PORT__/${VOKA_RTC_TCP_PORT:-7881}/" -e "s/__UDP_PORT__/${VOKA_RTC_UDP_PORT:-7882}/" livekit.yaml.template > livekit.yaml
chmod 600 livekit.yaml .env
mkdir -p backups && chmod 700 backups

step "Construindo e ligando (a primeira vez demora alguns minutos)"
"${DC[@]}" build app
"${DC[@]}" up -d
wait_healthy || { echo "O voka-app não ficou saudável. Veja: ${DC[*]} logs app"; exit 1; }
for n in voka-livekit voka-backup; do
  for _ in $(seq 1 40); do [ "$(docker inspect -f '{{.State.Health.Status}}' $n)" = healthy ] && break; sleep 3; done
done
if bash smoke-test.sh --local; then
  echo; echo "Voka ligado e aprovado nos testes locais. Próximo passo: proxy reverso (LEIA-ME.md, passo 4) e  bash deploy/smoke-test.sh"
else
  echo; echo "Os testes locais FALHARAM. Veja acima. Para desfazer: sudo bash deploy/uninstall.sh"; exit 1
fi
