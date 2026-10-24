#!/usr/bin/env bash
# Valida o kit SEM tocar em nada (pode rodar em qualquer máquina com bash e docker):
# quebras de linha, sintaxe dos scripts e o docker-compose.yml interpretado.
set -uo pipefail
cd "$(dirname "$0")"
rc=0
crlf=$(grep -l $'\r' ../Dockerfile ../.dockerignore ./*.sh ./*.yml ./*.template ./.env.example ./proxy-examples/* 2>/dev/null)
[ -z "$crlf" ] && echo "OK    sem CRLF" || { echo "ERRO  CRLF em: $crlf"; rc=1; }
for f in ./*.sh; do if bash -n "$f"; then echo "OK    bash -n $f"; else echo "ERRO  bash -n $f"; rc=1; fi; done
if command -v docker >/dev/null; then
  tmp=$(mktemp -d); cp .env.example "$tmp/.env"
  sed -i 's/^DB_PASSWORD=.*/DB_PASSWORD=x/;s/^VOKA_PUBLIC_IP=.*/VOKA_PUBLIC_IP=203.0.113.1/' "$tmp/.env"
  if VOKA_ENV_FILE="$tmp/.env" docker compose -f docker-compose.yml --env-file "$tmp/.env" config -q; then echo "OK    docker compose config"; else echo "ERRO  docker compose config"; rc=1; fi
  rm -rf "$tmp"
fi
exit $rc
