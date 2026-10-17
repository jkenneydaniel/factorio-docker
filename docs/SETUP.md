# Setup on Windows, macOS and Linux

The setup tools require Docker with Compose v2, not a host installation of Node,
Python, Homebrew or PowerShell on Mac/Linux. They check the local Docker daemon,
Linux container mode and architecture, validate configuration, prepare data and
print the private administrator registration link. They do not install Docker,
change firewalls, install emulators or configure host startup automatically.

Before preparing private data, the setup container checks that its trusted CA
bundle parses correctly and that Docker, Compose and Buildx can run. An incomplete
image fails with a rebuild instruction instead of reporting successful setup.
These are local checks: setup still has no network or Docker socket, and offline
preparation works when its image is already available. They do not prove registry
access, Docker socket permissions or LAN reachability; the release build separately
tests a fresh registry request and a real restricted-worker build.

## Platform choices

| Host | Panel/controller | Factorio 2.0.77 and map workers | Prerequisite |
| --- | --- | --- | --- |
| Windows x86-64 | Native Linux amd64 container | Native Linux amd64 container | Docker Desktop, Linux containers |
| Intel Mac | Native Linux amd64 container in Docker VM | Native Linux amd64 container in Docker VM | Docker Desktop |
| Apple Silicon Mac (ARM64) | Native Linux arm64 container in Docker VM | Linux amd64 through Docker emulation | Docker Desktop with amd64 emulation |
| Linux x86-64 | Native Linux amd64 container | Native Linux amd64 container | Rootful Docker Engine + Compose v2 |
| Linux ARM64 | Native Linux arm64 container | Linux amd64 through host emulation | Rootful Engine + Compose v2 + amd64 binfmt/QEMU |

These are configuration targets, not claims that every host has been tested.
32-bit x86/ARM, rootless Docker, remote Docker contexts and alternative container
engines are outside this release's setup support. Windows ARM64 follows the same
emulation requirement if its Docker Desktop installation supports Linux amd64.

The game remains pinned to 2.0.77 to match existing clients. Its upstream ARM image
uses a Box64 compatibility layer; our map workers invoke the x64 binary directly.
We explicitly select `linux/amd64` for the game and **all** disposable workers to
avoid mixing these execution paths. The Node services build for the daemon's
native architecture. Do not set `DOCKER_DEFAULT_PLATFORM=linux/amd64` globally:
that would also force the panel into emulation. Do not change `FACTORIO_PLATFORM`
to ARM for this release. Native Linux ARM game support would require a separate
game-version and worker-path compatibility change.

Sources: [Compose platform](https://docs.docker.com/reference/compose-file/services/#platform),
[Docker emulation](https://docs.docker.com/build/building/multi-platform/#qemu),
[upstream image implementation](https://github.com/factoriotools/factorio-docker/blob/master/docker/Dockerfile).

## Guided setup

Download/extract the source into a local writable folder. Keep the entire folder
on a local disk; setup data and temporary map workers use bind mounts.

**Windows:** install Docker Desktop, start it using Linux containers, open
PowerShell in the extracted folder and run:

```powershell
.\Setup.ps1
```

If Windows blocks downloaded scripts, review them first and use
`Unblock-File .\Setup.ps1` for that file. Do the same for `Start-Server.ps1` if
needed. No machine-wide execution policy change is required by this project.

**Mac:** install and start Docker Desktop. Double-click `Setup.command` in Finder
or open Terminal in the extracted folder and run:

```sh
sh Setup.sh
```

The source packager preserves executable permissions in its source directory;
some ZIP extractors drop them. If Finder cannot launch `Setup.command`, use the
Terminal command above. macOS may also require you to allow Docker to share the
folder containing this checkout.

**Linux:** install Docker Engine and the Compose plugin using your distribution's
[official Docker instructions](https://docs.docker.com/engine/install/), start
the service and ensure your normal user can access Docker. Then run:

```sh
sh Setup.sh
```

The Linux launcher detects the local socket group automatically. It expects
`/var/run/docker.sock`; Docker Desktop uses its VM socket instead. Do not run the
whole launcher as root to work around permissions.

Choose new world, import, or registration-link recovery. For import, first copy
your Factorio save ZIP into an `import/` folder beside the launcher. Spaces in the
filename are supported. Setup validates and copies the ZIP, preserving its source.
For a new `.env`, guided setup asks for the host's reserved LAN IPv4 address or DNS
name; blank means localhost. Existing `.env` values are retained unless you supply
an explicit address. Setup does not guess which network interface friends use.

After preparation you can choose to start the stack. The default is **No**.
Once running, open the private registration URL printed by setup and create your
administrator account. The link expires after 24 hours. Owner registration opens
**Ready to play**, a resumable guide with game/first-save checks, exact client
version, and copyable game/panel addresses. It never starts or saves automatically.
If needed, explicitly choose **Save now** after the game is ready. Completion is
saved to your account; **Do this later** returns to Overview, and **Setup guide**
reopens it. Existing accounts are not forced through onboarding.

In the game, choose Multiplayer → Connect to address and use the displayed game
address. A localhost/loopback address only works on the host. Joining from a second
device is the way to confirm LAN access; local readiness cannot verify that.

## Direct commands

Mac/Linux:

```sh
sh Setup.sh --check
sh Setup.sh --new-world --address factorio.local
# OR, with a ZIP you have placed in import/:
sh Setup.sh --save 'import/Our factory.zip' --address factorio.local
# Start later, deliberately applying local source/config changes:
sh Start-Server.sh
```

Windows equivalents:

```powershell
.\Setup.ps1 -Check
.\Setup.ps1 -NewWorld -Address factorio.local
# OR:
.\Setup.ps1 -Save 'import/Our factory.zip' -Address factorio.local
.\Start-Server.ps1
```

Use your own reserved IP/hostname in place of `factorio.local`; that example does
not create DNS or mDNS discovery. Add `--start` / `-Start` to a setup command when
you deliberately want setup followed by stack startup. A rerun preserves existing
worlds/accounts; it does not create another world over existing saves. Create
additional worlds using the panel. `--registration-link` / `-RegistrationLink`
replaces setup/recovery invitations while preserving users and worlds.

`--check` / `-Check` validates prerequisites/config only, makes no files and starts
no containers. It cannot prove that game emulation, ports or LAN routing work.
It uses `.env.example` if no `.env` exists. Run `--help` / `-Help` without Docker
to see the available commands. The underlying Compose commands in the root README
remain available for experienced users.

## ARM64 prerequisites and troubleshooting

Docker Desktop provides cross-architecture emulation. If available, its Apple
Virtualization framework/Rosetta option can accelerate amd64 execution on Apple
Silicon; available settings depend on your Docker Desktop version/VM backend.
Factorio simulation and preview generation can be slower under emulation. No
performance or capacity claim is made before running your particular world.

On a native Linux ARM64 host, amd64 execution needs host-level binfmt/QEMU
registration. The launcher reports this requirement but does not install it or
prove it by running a container. Follow your distribution's supported QEMU/binfmt
setup and the [Docker multi-platform guide](https://docs.docker.com/build/building/multi-platform/#qemu).
Buildx-only emulation is insufficient if the runtime daemon cannot execute amd64
containers. An `exec format error` usually indicates missing runtime emulation.

Other common issues:

| Symptom | Next step |
| --- | --- |
| Docker unavailable | Start Desktop/service and check local context and user access. |
| Remote context rejected | Select a local Docker context; bind mounts resolve on the daemon host. |
| Mount denied on Mac | Allow Docker Desktop access to the checkout folder. |
| Controller socket permission denied on Linux | Rerun setup to detect socket GID, then deliberately recreate services; review ownership before changing existing data. |
| Panel opens locally but friends cannot connect | Replace localhost in `.env`, apply with Compose, check host firewall and same-LAN routing. |
| Version mismatch in Factorio | Match all clients to 2.0.77; do not upgrade the server image alone. |
| Registration expired | Run setup's registration-link mode and use the new private link. |

## Network and startup

Allow the configured panel TCP port (default 8080) and game UDP port (default
34197) from the trusted LAN in your host firewall. No router forwarding is needed.
The optional Windows `Configure-Lan.ps1` helper still targets **default** ports;
configure custom ports manually. Linux firewall tools vary by distribution, so
review the local policy before adding rules. On Mac, allow Docker's incoming
connections where requested. Direct connection is supported on every host;
the Windows LAN announcer remains Windows-only.

Restart policies apply after Docker starts. On Desktop enable its start-at-login
option if desired. On Linux enable Docker's service if desired. These launchers
do not register background tasks or change startup settings.
