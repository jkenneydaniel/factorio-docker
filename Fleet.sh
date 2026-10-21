#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
config="$root/.env.fleet"
address=${FLEET_ADDRESS:-localhost}
case "$address" in ''|*[!A-Za-z0-9.-]*) echo 'Use an IPv4 address or local hostname.' >&2; exit 1;; esac
command -v docker >/dev/null || { echo 'Start Docker with Linux containers first.' >&2; exit 1; }
host_type=$(docker info --format '{{.OSType}}/{{.Architecture}}/{{.ServerVersion}}')
case "$host_type" in linux/x86_64/*|linux/amd64/*) ;; *) echo 'The host manager requires Linux amd64 containers.' >&2; exit 1;; esac
version=${host_type##*/}
[ "${version%%.*}" -ge 26 ] || { echo 'Docker Engine 26+ is required.' >&2; exit 1; }
if [ ! -f "$config" ]; then
 id=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
 umask 077
 cat > "$config" <<EOF
FLEET_ID=$id
FLEET_IMAGE=local/lobby-goblin-host:0.3.0-alpha
FLEET_ADDRESS=$address
FLEET_PANEL_PORT=${FLEET_PANEL_PORT:-8082}
FLEET_PANEL_BIND=0.0.0.0
FLEET_GAME_BIND=0.0.0.0
FLEET_GAME_PORT_BASE=35000
FLEET_MEMORY_GIB=${FLEET_MEMORY_GIB:-16}
EOF
fi
id=$(sed -n 's/^FLEET_ID=\([a-f0-9]\{32\}\)$/\1/p' "$config")
[ ${#id} -eq 32 ] || { echo 'Invalid FLEET_ID in .env.fleet.' >&2; exit 1; }
docker compose --env-file "$config" -f "$root/fleet.compose.yaml" -p "lobby-goblin-fleet-$id" build fleet-controller
[ "${1:-}" != '--build-only' ] || exit 0
docker compose --env-file "$config" -f "$root/fleet.compose.yaml" -p "lobby-goblin-fleet-$id" up -d --no-build
printf '%s\n' 'Host manager started. Register with this private one-time invitation:'
docker compose --env-file "$config" -f "$root/fleet.compose.yaml" -p "lobby-goblin-fleet-$id" exec -T fleet-controller cat /web-state/registration-link.txt
