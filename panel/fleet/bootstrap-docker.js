// Used only after explicit confirmation to install missing Docker on Ubuntu.
// Existing Docker and conflicting runtimes are never upgraded or removed.
export const dockerBootstrap=String.raw`
if ! command -v docker >/dev/null 2>&1; then
 . /etc/os-release
 [ "$ID" = ubuntu ] || { echo 'Install Docker manually on this operating system.' >&2; exit 1; }
 case "$VERSION_ID" in 22.04|24.04|26.04) ;; *) echo 'Use a supported Ubuntu LTS host.' >&2; exit 1 ;; esac
 for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
  if dpkg-query -W -f='${'${Status}'}' "$package" 2>/dev/null | grep -q 'install ok installed'; then echo 'Conflicting runtime found. Review Docker installation manually.' >&2; exit 1; fi
 done
 [ ! -e /etc/apt/sources.list.d/docker.sources ] && [ ! -e /etc/apt/sources.list.d/docker.list ] && [ ! -e /etc/apt/keyrings/docker.asc ] || { echo 'Review the existing Docker repository manually.' >&2; exit 1; }
 export DEBIAN_FRONTEND=noninteractive
 apt-get -o APT::Update::Error-Mode=any update
 apt-get install -y --no-install-recommends ca-certificates curl
 install -m 0755 -d /etc/apt/keyrings
 curl --fail --silent --show-error --proto '=https' --tlsv1.2 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
 chmod 0644 /etc/apt/keyrings/docker.asc
 printf '%s\n' 'Types: deb' 'URIs: https://download.docker.com/linux/ubuntu' "Suites: $VERSION_CODENAME" 'Components: stable' "Architectures: $(dpkg --print-architecture)" 'Signed-By: /etc/apt/keyrings/docker.asc' > /etc/apt/sources.list.d/docker.sources
 apt-get -o APT::Update::Error-Mode=any update
 apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
`;
