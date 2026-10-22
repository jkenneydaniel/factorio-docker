# Isolated Ubuntu installer acceptance — October 22, 2026

The matching **Linux amd64** Lobby Goblin runtime was built from the current
`panel/` sources and used for a real Ubuntu installation. It was not published.
No existing server, world, installation, Docker context or host configuration was
changed. All service installation and container operations ran inside the new
disposable test machine.

## Environment and isolation

- Ubuntu 24.04.5 LTS x86-64 userspace in an OrbStack isolated Linux machine on
  Apple Silicon, using x86 compatibility execution. This is not native amd64
  hardware or a cloud provider acceptance test.
- Machine created with `--isolated --isolate-network --arch amd64 --memory 8G
  --cpus 4 --disk 40G`; no host file mounts, SSH agent forwarding or existing
  Docker socket. Only allowlisted public source files were transferred.
- A fresh Docker Engine **29.9.2**, Compose **5.6.1** and Buildx were installed by
  the actual `Install-Docker.sh --install` through Docker's official Ubuntu apt
  repository. The initial `--check` left the package inventory unchanged.
- A private TLS registry inside the disposable machine served the locally built
  image under its normal image name. The guest alone had a test CA and a `ghcr.io`
  hosts override. No image was pushed to the public registry. The local image tag
  was removed before setup to exercise a real download.
- The test guest and all its temporary containers, accounts, keys, storage and
  registry were deleted after exporting the image archive and sanitized evidence.

## Runtime artifact

Image name used inside the test environment:
`ghcr.io/jkenneydaniel/lobby-goblin:0.3.5-alpha`.

Final image ID / private registry digest:
`sha256:24e3f744d0b3c27713d262e11fa14110e4f3c9dfbc2d9ced4a8b6b8886dcd7df`.

The local archive is retained under the ignored directory
`output/installation/ubuntu-20261022/`:

```text
lobby-goblin-0.3.5-alpha-linux-amd64.tar.gz
SHA-256 b5d335f9958feb2c637cc2bd594ba0d1d12025d8ac5a516ac232d14b19fef990
```

This is a local acceptance artifact, not a published release tag or multi-platform
image. The image served both standalone game panels in a network-disabled,
read-only container and included the fleet/controller/worker and installer
entrypoints. The final image filesystem was checked for macOS archive metadata
sidecars after rebuilding from a clean source transfer.

## Checks that passed

- Docker bootstrap from an absent engine; repeating bootstrap preserved the
  daemon's service start timestamp and the unrelated synthetic workload.
- Node-free Unix launcher: actual Docker-backed preparation, image pull,
  capability check and healthy controller/web startup.
- Interactive guided setup: local selection, address, memory budget, plan and
  both prepare-only and explicit start choices. The final clean image was used
  by a fresh guided installation on its own port.
- Non-root Docker user preparation: generated configuration remained owned by
  that user, with private file permissions. Docker group membership was set up
  only as a test fixture, not by the product bootstrap.
- Real account routes through the installed web/controller services: initial
  invitation inspection, administrator creation, invitation single use, host
  readiness, explicit onboarding, CSRF rejection, sign-out and login.
- Account and onboarding persistence after recreating the disposable manager
  containers; invitation recovery preserved the existing administrator.
- Installer reruns preserved container IDs and start timestamps. A separate
  synthetic container and its sentinel volume retained their identity, start
  time and content hash throughout local and hosted setup.
- Local application ports resolved to loopback; controllers had no published
  ports. Each new installation used distinct names and storage.
- Hosted manager startup with the generated Compose configuration. A separate
  **test-only override** enabled Caddy's `--internal-certs`; the generated
  installer manifest was not edited. CA-verified HTTPS registration/onboarding,
  Secure/HttpOnly/SameSite cookies, HSTS, HTTP-to-HTTPS redirect and rejection of
  an HTTP origin all passed. Certificate and account storage survived container
  recreation.
- Full Linux regression suite: **264 passed, zero failed, one skipped** because
  the runtime image has no Lua interpreter. Tests had no Docker socket or
  network access. Temporary executable fixtures required an explicitly executable
  `/tmp` mount; this does not change the deployed panel's mount settings.

The reusable HTTP acceptance driver is
`panel/test/installer-http-acceptance.mjs`. It requires explicit disposable-test
opt-in and connects only to loopback. Its generated credential/state files must
stay in the test environment; export only its printed results. Run its `initial`
phase after installation and `persisted` phase after recreating test containers.
HTTPS testing supplies the test CA using `ACCEPTANCE_CA` rather than disabling
certificate validation.

## Issue found and corrected

The Docker-backed launcher inherited the runtime image's unprivileged default
user. On a real host without Node, it could not write the installation directory
or use the Docker socket. Unix and PowerShell launchers now explicitly run only
the temporary installer helper as root. Unix setup passes the invoking user's
IDs so newly prepared files retain their ownership. The runtime image keeps its
existing unprivileged default user; manager services retain their explicit
Compose settings. The successful Ubuntu flow used the corrected launcher.

## Remaining boundaries

Public ACME certificate issuance, public DNS/firewalls and reachability from
another network were not tested. The HTTPS result uses a private test CA.
Windows/macOS launcher runtime acceptance, native amd64 hardware, ARM host
manager support and game creation are separate checks. No Factorio or Rust game
server or world was created during installer acceptance. A matching public
runtime image still needs release publication before ordinary users can download
these installer changes.
