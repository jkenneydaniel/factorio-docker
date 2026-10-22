#!/bin/sh
set -eu
source_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# sudo is needed for Docker bootstrap, but the resulting files belong to the
# invoking user in both the native Node and temporary-container setup paths.
installer_uid=$(id -u)
installer_gid=$(id -g)
if [ "$installer_uid" -eq 0 ]; then
  installer_uid=${SUDO_UID:-$installer_uid}
  installer_gid=${SUDO_GID:-$installer_gid}
fi
for owner_id in "$installer_uid" "$installer_gid"; do
  case "$owner_id" in ''|*[!0-9]*) printf '%s\n' 'Invalid installer ownership ID.' >&2; exit 1 ;; esac
  [ "${#owner_id}" -le 9 ] || { printf '%s\n' 'Invalid installer ownership ID.' >&2; exit 1; }
done
export GOBLIN_INSTALL_UID="$installer_uid" GOBLIN_INSTALL_GID="$installer_gid"
if [ "${1:-}" = --install-docker ]; then
  for choice do
    case "$choice" in --check|--help|-h) printf '%s\n' 'Do not combine --install-docker with --check or --help. Inspect prerequisites separately before installing.' >&2; exit 1 ;; esac
  done
  shift
  docker_installer="$source_root/scripts/install/Install-Docker.sh"
  [ -f "$docker_installer" ] || docker_installer="$source_root/Install-Docker.sh"
  sh "$docker_installer" --install
fi
if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  exec node "$source_root/panel/install.js" "$@"
fi
if [ "${1:-}" = --help ]; then
  printf '%s\n' 'Lobby Goblin installer: run without arguments for guided setup.' '--prepare / --start / --check; --mode local|hosted; --domain HOST; --address HOST; --memory GiB; --directory PATH' 'Linux: --install-docker as the first option explicitly installs missing Docker on supported Ubuntu hosts.' 'See docs/INSTALLATION.md. Node 22+ is optional when Docker is installed.'
  exit 0
fi
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'Install Docker Desktop (Mac) or Docker Engine (Linux), or run sudo sh Install.sh --install-docker on a fresh supported Ubuntu server.' >&2; exit 1; }
endpoint=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}
case "$endpoint" in unix://*) ;; *) printf '%s\n' 'Run installation on the target machine with a local Docker context.' >&2; exit 1 ;; esac
# --check must not create even a temporary setup container.
if [ "${1:-}" = --check ]; then
  [ "$#" -eq 1 ] || { printf '%s\n' 'Install Node 22+ to check installation files with --directory.' >&2; exit 1; }
  details=$(docker info --format '{{.OSType}}|{{.Architecture}}|{{.ServerVersion}}|{{json .SecurityOptions}}')
  case "$details" in linux\|amd64\|*|linux\|x86_64\|*) ;; *) printf '%s\n' 'The host manager needs Linux x86-64 containers.' >&2; exit 1 ;; esac
  case "$details" in *rootless*) printf '%s\n' 'Rootless Docker is unsupported by this controller layout.' >&2; exit 1 ;; esac
  engine=$(printf '%s' "$details" | cut -d '|' -f 3)
  [ "${engine%%.*}" -ge 26 ] || { printf '%s\n' 'Docker Engine 26+ is required.' >&2; exit 1; }
  compose=$(docker compose version --short)
  printf '%s\n' "$compose" | awk -F. '{sub(/^v/, "", $1); exit !(($1>2)||($1==2&&$2>=24))}' || { printf '%s\n' 'Compose 2.24+ is required.' >&2; exit 1; }
  printf 'Docker %s, Compose %s. No files changed or containers started.\n' "$engine" "$compose"
  exit 0
fi
# Docker supplies the installer runtime when Node is absent. The host CLI owns
# the connection; do not forward arbitrary remote contexts into this helper.
work_root=$(pwd -P)
case "$source_root$work_root" in *,*) printf '%s\n' 'Use a directory without commas, or install Node 22+ to run the installer directly.' >&2; exit 1 ;; esac
directory_next=no
for choice do
  if [ "$directory_next" = yes ]; then
    case "/$choice/" in */../*) printf '%s\n' 'Docker-based setup needs a destination inside your current directory. Use Node 22+ for other paths.' >&2; exit 1 ;; esac
    case "$choice" in /*) case "$choice" in "$work_root"/*) ;; *) printf '%s\n' 'Docker-based setup needs a destination inside your current directory. Use Node 22+ for other paths.' >&2; exit 1 ;; esac ;; esac
    directory_next=no
  fi
  [ "$choice" != --directory ] || directory_next=yes
done
runtime_version=$(sed -n 's/^[[:space:]]*"version": "\([^"]*\)".*/\1/p' "$source_root/panel/package.json")
set -- --rm --user 0:0 --env "GOBLIN_INSTALL_UID=$GOBLIN_INSTALL_UID" --env "GOBLIN_INSTALL_GID=$GOBLIN_INSTALL_GID" --mount "type=bind,source=$source_root,target=/installer,readonly" --mount "type=bind,source=$work_root,target=$work_root" --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock --workdir "$work_root" --entrypoint node "ghcr.io/jkenneydaniel/lobby-goblin:$runtime_version" /installer/panel/install.js "$@"
if [ -t 0 ]; then set -- -it "$@"; fi
exec docker run "$@"
