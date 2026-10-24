#!/usr/bin/env bash
# Baixa a versão nova do código e reinicia o Voka:  sudo bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
exec bash deploy/install.sh
