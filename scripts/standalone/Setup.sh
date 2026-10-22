#!/bin/sh
# Guided local-host setup. Requires only POSIX tools and Docker Compose v2.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root="$script_dir"
if [ "$(basename "$(dirname "$script_dir")")" = scripts ] && [ -f "$script_dir/../../panel/package.json" ] && [ -f "$script_dir/../../compose.yaml" ]; then
  root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
fi
cd -P "$root"
fail() { printf '\nSetup: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'HELP'
Lobby Goblin setup (macOS / Linux)
  sh Setup.sh                              Guided setup; asks before starting
  sh Setup.sh --check                      Read-only prerequisite/config check
  sh Setup.sh --new-world [--address HOST]  Prepare without starting the stack
  sh Setup.sh --save 'import/world.zip'     Import a save without starting
  sh Setup.sh --registration-link          Replace an expired registration link
  Add --start to explicitly start/apply the stack after successful setup.
  Setup preserves existing saves, settings and accounts. --help needs no Docker.
HELP
}
mode= save= address= start=no check=no
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --check) check=yes ;;
    --new-world|--registration-link) [ -z "$mode" ] || fail 'Choose one setup mode.'; mode=$1 ;;
    --save) [ -z "$mode" ] || fail 'Choose one setup mode.'; [ "$#" -ge 2 ] || fail '--save needs an import/ ZIP path.'; mode=--save; save=$2; shift ;;
    --address) [ "$#" -ge 2 ] || fail '--address needs a hostname or IPv4 address.'; address=$2; shift ;;
    --start) start=yes ;;
    *) fail "Unknown option: $1. See sh Setup.sh --help." ;;
  esac
  shift
done
if [ "$check" = yes ]; then
  [ -z "$mode$address" ] && [ "$start" = no ] || fail '--check cannot be combined with setup options.'
fi
command -v docker >/dev/null 2>&1 || fail 'Install Docker Desktop (Mac) or Docker Engine + Compose v2 (Linux), then start Docker. See docs/SETUP.md.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required. See docs/SETUP.md.'
endpoint=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}
case "$endpoint" in unix://*) ;; *) fail 'Use a local Docker context. Remote daemons cannot use this checkout’s bind mounts.' ;; esac
details=$(docker info --format '{{.OSType}}|{{.Architecture}}|{{.OperatingSystem}}|{{json .SecurityOptions}}') || fail 'Docker is unavailable. Start Docker and check that your user can access it; do not run this script with sudo.'
IFS='|' read -r docker_os docker_arch docker_system docker_security <<EOF
$details
EOF
[ "$docker_os" = linux ] || fail 'Docker must use Linux containers.'
case "$docker_arch" in x86_64|amd64|aarch64|arm64) ;; *) fail "Unsupported Docker architecture: $docker_arch (requires x86-64 or ARM64)." ;; esac
case "$docker_security" in *rootless*) fail 'Rootless Docker is not supported by this controller/socket layout. Use a local rootful Docker Engine or Docker Desktop.' ;; esac
printf '\nLobby Goblin · local Docker %s\n' "$docker_arch"
case "$docker_arch" in aarch64|arm64)
  printf '%s\n' 'Factorio 2.0.77 uses amd64 emulation; the panel runs natively on ARM64.'
  case "$docker_system" in *'Docker Desktop'*) printf '%s\n' 'Enable amd64 emulation in Docker Desktop if game workers report an exec format error.' ;;
    *) printf '%s\n' 'Linux ARM64 needs host-level amd64 binfmt/QEMU support. This script does not install it; see docs/SETUP.md.' ;; esac ;;
esac
[ ! -L .env ] || fail 'Refusing a symlink at .env.'
read_env() { awk -F= -v key="$1" '$1==key {sub(/^[^=]*=/, ""); sub(/\r$/, ""); value=$0} END {print value}' .env; }
if [ -f .env ]; then
  platform=$(read_env FACTORIO_PLATFORM)
  [ -z "$platform" ] || [ "$platform" = linux/amd64 ] || fail 'This release requires FACTORIO_PLATFORM=linux/amd64 for the game and preview workers.'
fi
if [ "$check" = yes ]; then
  config=.env.example; [ ! -f .env ] || config=.env
  docker compose --env-file "$config" config --quiet || fail 'Compose configuration is invalid.'
  printf '%s\n' "Configuration valid ($config). No files changed or containers started." 'Emulation, port availability and LAN reachability are not proven by this check.'
  exit 0
fi
guided=no
if [ -z "$mode" ]; then
  [ -t 0 ] || fail 'Non-interactive use needs --new-world, --save, --registration-link or --check.'
  guided=yes
  printf '\n1) New world / preserve existing installation\n2) Import a Factorio save ZIP\n3) Replace an expired registration link\nChoice [1]: '
  read -r choice
  case "${choice:-1}" in
    1) mode=--new-world ;;
    2) mode=--save; printf 'Copy the ZIP into import/ first. Path (e.g. import/world.zip): '; read -r save ;;
    3) mode=--registration-link ;;
    *) fail 'Choose 1, 2 or 3.' ;;
  esac
fi
if [ "$mode" = --save ]; then
  case "$save" in import/*.zip|import/*.ZIP) ;; *) fail 'Copy the save into import/ and supply its relative ZIP path.' ;; esac
  case "/$save/" in */../*|*/./*) fail 'The import path cannot contain dot segments.' ;; esac
  [ -f "$save" ] || fail "Save not found: $save"
fi
if [ "$guided" = yes ] && [ ! -f .env ] && [ -z "$address" ]; then
  printf '\nAddress friends will connect to (reserved LAN IPv4 or hostname).\nLeave blank for access on this computer only [localhost]: '
  read -r address
fi
if [ -n "$address" ]; then
  case "$address" in *[!A-Za-z0-9.-]*|.*|-*) fail 'Use a hostname or IPv4 address without a scheme, port, spaces or path.' ;; esac
fi
if [ ! -f .env ]; then (umask 077; set -C; cat .env.example > .env); fi
set_env() {
  task_env_tmp=".env.tmp.$$"
  (umask 077; set -C; awk -F= -v key="$1" -v value="$2" '$1==key {print key "=" value; found=1; next} {print} END {if(!found)print key "=" value}' .env > "$task_env_tmp")
  mv "$task_env_tmp" .env
}
[ -z "$address" ] || set_env SERVER_ADDRESS "$address"
# Docker Desktop's socket is inside its VM. Native Linux needs its socket GID.
case "$docker_system" in *'Docker Desktop'*) set_env DOCKER_SOCKET_GID 0 ;;
  *)
    socket=${endpoint#unix://}
    [ "$socket" = /var/run/docker.sock ] || fail 'Use the standard local /var/run/docker.sock endpoint. See docs/SETUP.md.'
    gid=$(stat -c %g "$socket") || fail 'Cannot determine Docker socket group.'
    case "$gid" in ''|*[!0-9]*) fail 'Invalid Docker socket group.' ;; esac
    set_env DOCKER_SOCKET_GID "$gid" ;;
esac
panel_image=$(read_env PANEL_IMAGE)
case "$panel_image" in local/lobby-goblin:*|local/factory-control:*) set_env PANEL_IMAGE ghcr.io/jkenneydaniel/lobby-goblin:0.3.5-alpha ;; esac
docker compose pull panel panel-controller setup || fail 'The published panel image could not be downloaded. No servers were started.'
docker compose config --quiet || fail 'Compose configuration is invalid. Review .env.'
printf '\nPreparing world data and private registration. This does not start the stack.\n'
if [ "$mode" = --save ]; then
  docker compose run --rm --no-build setup --save "/workspace/$save"
else
  docker compose run --rm --no-build setup "$mode"
fi
if [ "$guided" = yes ] && [ "$start" = no ]; then
  printf '\nStart/apply the stack now? Existing players may disconnect. [y/N]: '
  read -r choice
  case "$choice" in y|Y|yes|YES) start=yes ;; esac
fi
if [ "$start" = yes ]; then
  docker compose up -d --no-build
  docker compose ps
else
  printf '\nPrepared. When ready, run: docker compose up -d --no-build\n'
fi
host=$(read_env SERVER_ADDRESS); host=${host:-localhost}
panel_port=$(read_env PANEL_PORT); panel_port=${panel_port:-8080}
game_port=$(read_env GAME_PORT); game_port=${game_port:-34197}
printf '\nPanel: http://%s:%s\nFactorio: %s:%s\n' "$host" "$panel_port" "$host" "$game_port"
printf '%s\n' 'Use the private registration link printed above after starting the stack.' 'Allow the configured TCP panel and UDP game ports from your trusted LAN; see docs/SETUP.md.'
