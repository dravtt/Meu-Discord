#!/usr/bin/env bash
# Baixa o código novo do GitHub e atualiza o Voka (backup + build limitado + testes; rollback.sh volta atrás).
# Pensado para rodar por SSH, de outro computador, com o usuário "voka" (ver LEIA-ME.md, "Atualizar de longe"):
#   ssh -t voka@IP "sudo bash /opt/voka/deploy/atualizar.sh"
# Só aceita avançar o histórico (git pull --ff-only): se a pasta tiver alterações locais, para sem mexer.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
cd deploy
exec bash update.sh
