#!/usr/bin/env bash
# Desliga e remove os contentores e a rede do Voka. Os DADOS (volumes e backups) ficam guardados.
# Para apagar também os dados (irreversível), depois rode:  docker volume rm voka_pgdata voka_uploads
set -euo pipefail
. "$(dirname "$0")/lib.sh"
confirm "Desligar e remover os contentores do Voka (dados preservados)?"
"${DC[@]}" down
echo "Voka desligado. Volumes voka_pgdata e voka_uploads e a pasta deploy/backups continuam guardados."
