#!/bin/sh
# Explicit, conservative bootstrap for a fresh Ubuntu x86-64 server.
set -eu
fail() { printf 'Docker setup: %s\n' "$*" >&2; exit 1; }
case "${1:---check}" in --check) install=no ;; --install) install=yes ;; *) fail 'Use --check or --install.' ;; esac
[ "$#" -le 1 ] || fail 'Use --check or --install.'
if command -v docker >/dev/null 2>&1; then
  printf '%s\n' 'Docker is already installed. Its packages, service and workloads were left unchanged.'
  docker --version
  docker compose version || fail 'Install a compatible Compose plugin separately; existing Docker is not upgraded automatically.'
  exit 0
fi
[ "$(uname -s)" = Linux ] || fail 'Install Docker Desktop on macOS or Windows, then rerun Install.sh / Install.ps1.'
[ -r /etc/os-release ] || fail 'Cannot identify this operating system.'
. /etc/os-release
[ "${ID:-}" = ubuntu ] || fail 'Automatic Docker installation currently supports Ubuntu LTS only. Install Docker manually on other distributions.'
case "${VERSION_ID:-}" in 22.04|24.04|26.04) ;; *) fail 'Use Ubuntu 22.04, 24.04 or 26.04 LTS.' ;; esac
[ "$(dpkg --print-architecture)" = amd64 ] || fail 'The host manager currently requires an x86-64 server.'
# Do not remove Docker alternatives or container runtimes: they may serve other
# applications. A fresh installation is the only automatic package path.
for package in docker.io docker-ce docker-ce-cli docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd containerd.io runc; do
  status=$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)
  [ "$status" != 'install ok installed' ] || fail "Existing $package package found. Review it manually; no packages were changed."
done
if [ "$install" = no ]; then
  printf '%s\n' 'Docker is absent. This Ubuntu x86-64 host supports installation from Docker’s official repository.' 'No files or packages changed. Use --install to install Docker Engine, Compose and Buildx.'
  exit 0
fi
[ "$(id -u)" -eq 0 ] || fail 'Package installation needs administrator privileges. Run sudo sh Install-Docker.sh --install, then rerun the Lobby Goblin installer with Docker access.'
# Refuse to replace preconfigured repository/key files on an existing host.
[ ! -e /etc/apt/sources.list.d/docker.sources ] && [ ! -L /etc/apt/sources.list.d/docker.sources ] || fail 'A Docker package repository is already configured; review it manually.'
[ ! -e /etc/apt/sources.list.d/docker.list ] && [ ! -L /etc/apt/sources.list.d/docker.list ] || fail 'A Docker package repository is already configured; review it manually.'
[ ! -e /etc/apt/keyrings/docker.asc ] && [ ! -L /etc/apt/keyrings/docker.asc ] || fail 'A Docker repository key already exists; review it manually.'
printf '%s\n' 'Installing Docker Engine, Compose and Buildx from Docker’s official Ubuntu repository.'
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error --location https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $VERSION_CODENAME
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
printf '%s\n' 'Docker installed. No user groups, firewall rules or existing application configuration were changed.' 'Docker access grants control over this host. Use an administrator session or configure access deliberately.'
