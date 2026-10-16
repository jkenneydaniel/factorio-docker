#!/bin/sh
set -eu
cd -P "$(dirname "$0")"
# The secrets directory belongs to UID 845 and is intentionally private on Linux.
[ -d .panel-data/auth ] && [ -d data/config ] || { printf '%s\n' 'Run sh Setup.sh first.' >&2; exit 1; }
sh ./Setup.sh --check
docker compose up -d --build
docker compose ps
printf '%s\n' 'Stack start requested. Use the panel address configured in .env.'
