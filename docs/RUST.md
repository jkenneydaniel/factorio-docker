# Rust module

Rust can run through the [single-host manager](FLEET.md), or as a separate
standalone Lobby Goblin installation described below. Existing Factorio launchers,
Compose files, accounts, worlds and defaults are unchanged. There is no game
switcher in an existing panel and no automatic import of an existing Rust server.

## Included

- Status and readiness from Rust WebRCON, plus Docker CPU/memory samples.
- Start, save-and-stop and restart jobs, with interruption confirmation and a
  per-installation operation lock. Start waits up to ten minutes for WebRCON.
- Connected players, Steam IDs, ping and connection time. Player addresses are
  excluded. Read-only accounts can view overview and players.
- Administrator-only, bounded Docker logs with credential filtering.
- Administrator-only settings for name, description, player limit and autosave
  interval. Stop Rust before editing. Changes apply at the next start; unlisted
  `server.cfg` lines are preserved, and revision checks prevent stale overwrites.
  Map seed, world size, identity and ports are deliberately outside this editor.
- Complete identity backups: saves, maps, player databases (including WAL files),
  configuration and other regular files under `server/lobby-goblin-rust/`. Streamed
  `.tar.gz` archives include a manifest and per-file SHA-256 hashes. Verification
  checks archive integrity and inventory, not whether Rust can load the result.
  Download and verification are available from Backups. Scheduling defaults off;
  enabling it requires explicit acknowledgement of repeated interruptions.
- Separate panel accounts, single-use registration links and invitations,
  controller credentials, WebRCON password, containers, bridge network and storage.

## Prepare a new installation

Use Node.js 24+ and an absolute, **new** directory outside the Factorio checkout.
Its parent must exist. Preparation refuses an existing destination and does not
contact Docker, download an image, start a server or create a game world.
This preparation command accepts POSIX host paths on Linux/macOS; native Windows
path support is not implemented. The existing Windows Factorio setup is unchanged.

Select a reviewed **linux/amd64** digest of
[`didstopia/rust-server`](https://github.com/Didstopia/rust-server), then run:

```sh
node panel/games/rust/setup.js \
  --directory /absolute/path/to/new-rust-install \
  --image didstopia/rust-server@sha256:YOUR_REVIEWED_64_HEX_DIGEST \
  --url http://localhost:8088
```

Replace the digest placeholder with an actual reviewed image digest. The setup
command intentionally has no mutable `latest` default. It copies this panel
runtime into the new installation; later source edits do not update that copy.
The generated Compose file is a standalone project, not an override to merge
with the Factorio Compose file.

The generated layout is:

```text
new-rust-install/
  compose.yaml
  .env                         # Rust installation ID, digest, paths and port
  rust.env                     # Private game-side WebRCON password
  installation.json
  panel/                       # Source snapshot used to build this panel
  data/server/lobby-goblin-rust/     # Rust identity; server binaries live in data/
  backups/archives/            # Rust archives only
  control/auth/                # Rust panel accounts/invitations
  control/controller/          # Jobs, schedules and verification records
  control/secrets/             # Separate controller token and WebRCON password
  control/registration-link.txt
```

Data, state and backup roots also have `.lobby-goblin-rust.json` ownership
markers. Keep them with this installation. The controller checks them **before**
initializing shared state, then validates game/instance labels, the pinned image
and the expected bind mount before Rust commands or container mutations.
Renaming/adopting existing containers or data is unsupported.

## Starting later

Starting is a separate operator action. No running installation was changed while
implementing this module. Review the generated files and host resources first:
[Facepunch's server guide](https://wiki.facepunch.com/rust/Creating-a-server)
describes substantial Rust memory/disk requirements. ARM hosts require amd64
emulation; the stock image failed to boot on the tested ARM64 Mac. Use a
native x86-64 Docker host running Linux containers for the stock image; this can
be Docker Desktop on Windows. The preparation command above still requires a
Linux/POSIX filesystem, such as a dedicated WSL installation on Windows. See the
runtime evidence below.

From the **new Rust installation directory**, an operator can validate the file
without starting anything:

```sh
docker compose config --quiet
```

To actually install and run the new stack when ready:

```sh
docker compose up -d --build
```

The image digest pins the bootstrap image, not the Rust build downloaded by
SteamCMD. Record the installed Steam build ID when reviewing updates.

On first launch the game image downloads Rust through SteamCMD. Mode `2` skips
automatic updates when binaries already exist; background update checking,
Oxide updates and the image's forced-restart heartbeat are disabled. The Rust
module rejects Factorio update jobs. Rust game/panel updates require separate
operator review; the existing Factorio updater must never manage this stack.

The panel binds to loopback port 8088 by default. Game/query UDP ports default to
28015/28017; WebRCON 28016 and the controller are not published to the host.
Configure an unused port if another Rust server already uses those game ports.
For deliberate LAN access, edit `RUST_PANEL_BIND`, `RUST_PANEL_HOSTS` and the game
address in the generated `.env`, then use the matching panel address. Protect
remote access with HTTPS. WebRCON is unencrypted only on the private bridge.
The Docker socket gives the controller host-level Docker privileges; it runs as
root to read Rust-owned databases. The web service has no socket or game mount
and runs with the setup user's UID/GID.

Open the private link in `control/registration-link.txt` to create the first
administrator account. It expires after 24 hours. To issue a replacement using
the copied runtime, run from the Rust installation directory:

```sh
PANEL_INIT_DIR="$PWD/control" PANEL_URL=http://localhost:8088 \
  node panel/init.js --registration-link
```

Treat `.env`, `rust.env`, `control/` and backups as private. Do not publish them.
If manually rotating WebRCON, change both `rust.env` and the password secret
together and recreate only this installation's affected containers.

## Backup consistency and recovery

For a running Rust server, the module preflights the identity, asks `server.save`,
then requests a graceful Docker stop with **no kill timeout**. The selected image
has a signal handler that performs its Rust shutdown sequence. The controller
requires a stopped, non-OOM container with exit code zero before copying files.
An unreachable WebRCON or failed save prevents the stop/copy; a hanging shutdown
fails the request rather than escalating to a forced kill. Check status/logs and
resolve it manually. There is no force-stop button.

The identity is inventoried again while stopped. Copy/verification failures
attempt to resume a previously running server; failures to resume are reported
as failed jobs. A server already stopped stays stopped. A successful backup job
means its archive was published/verified and a previously running Rust server
answered WebRCON again. It does not prove a successful game-load restore.

Streaming avoids the Factorio ZIP memory/size ceiling. Bounds remain: 8 GiB minus
one byte per file, 64 GiB of identity data, 20,000 files, nesting depth 32 and
100-byte archive member names. Symbolic links and special files are rejected,
not silently omitted. Entire identity data are included; server binaries and
plugins outside that directory are not. Manage mod/plugin backups separately.

Scheduled archives use the shared count retention rules, preserving the newest
two and the most recent verified backup. Manual archives are retained by default.
The Rust UI does not expose age-based deletion or automatic restore. If the
controller/host crashes during a backup, Rust may remain stopped; the interrupted
job is recorded on controller restart. Inspect it and resume Rust explicitly.

For recovery, verify/download the archive first, then stop this Rust installation
and extract into a **new disposable** identity location. Validate Rust can load
it before deciding to replace the active Rust identity. Never extract into the
Factorio installation. The host manager has passed real snapshot-clone loading on Windows amd64;
verify a separate recovery copy before replacing any active identity.

## Runtime acceptance

Native Windows x86-64 Docker acceptance reached real WebRCON readiness and
completed saved identity backups, hash verification, snapshot publication and
independent clone loading on October 20, 2026. Both source and clone reported the
same map seed and size; credentials and volumes differed. See the
[detailed verification record](VERIFICATION.md) for exact checks and limits.

Earlier ARM64 Mac experiments failed in SteamCMD and Unity/Mono; ARM Rust remains
unsupported by the host manager. Its first version requires Linux amd64 containers.
The pinned didstopia digest fixes the bootstrap image; SteamCMD still downloads
the public game build separately. Future game-build compatibility needs separate
validation. Existing Factorio servers and worlds were not involved.

## Development evidence

`panel/test/rust-module.test.js` uses temporary identities and mock Docker/Rust
responses, plus a real WebSocket exchange bound to loopback. It covers ownership,
storage markers, lifecycle/save failures, settings/injection/revision rules,
archive inventory/checksums, resumption, retention and web permissions. Package
tests check Rust runtime/template/assets in both existing release formats.

```sh
node --test panel/test/*.test.js
node panel/test/rust-ui-preview.js
```

The synthetic preview binds to `http://127.0.0.1:8090`; use `admin` or `viewer`
with password `rust-preview-password`. It uses the actual shared web/controller,
account and archive code with synthetic game/host transports. It cannot contact
the host Docker socket. Stop it with Ctrl+C to remove its temporary files.

Protocol references: [Facepunch WebRCON client](https://github.com/Facepunch/webrcon/blob/gh-pages/js/rconService.js),
[server configuration](https://wiki.facepunch.com/rust/Creating-a-server#servercfg),
[image startup/shutdown contract](https://github.com/Didstopia/rust-server/blob/master/start_rust.sh).
