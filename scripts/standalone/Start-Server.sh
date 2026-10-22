#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root="$script_dir"
if [ "$(basename "$(dirname "$script_dir")")" = scripts ] && [ -f "$script_dir/../../panel/package.json" ] && [ -f "$script_dir/../../compose.yaml" ]; then
  root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
fi
cd -P "$root"
# The secrets directory belongs to UID 845 and is intentionally private on Linux.
[ -d .panel-data/auth ] && [ -d data/config ] || { printf '%s\n' 'Run sh Setup.sh first.' >&2; exit 1; }
sh "$script_dir/Setup.sh" --check
docker compose up -d --build
docker compose ps
printf '%s\n' 'Stack start requested. Use the panel address configured in .env.'
