# Factory Control

**v0.2.0-alpha** — a self-hosted Factorio server and LAN management panel, built
with Docker Compose. This is an early release for trusted home networks.

Manage worlds, saves, backups, players, server settings and accounts from a
browser with a consistent dark interface and warm amber actions. Create a world
through Play style, Customize and Review, with precise sliders/numbers and an
automatically updating Factorio terrain preview. Explore a saved map with
resources, buildings and pins. Owner registration continues into a resumable
readiness and joining guide.

## Requirements

- Windows, macOS or Linux with Docker Engine/Desktop running Linux containers and
  Compose v2, on x86-64 or ARM64. The pinned game uses amd64 emulation on ARM64;
  panel services build natively. See the [platform matrix](docs/SETUP.md#platform-choices).
- Allow roughly 3 GB of free memory for the stack and an isolated map worker,
  plus enough disk space for your worlds and backups. Large factories need more.
- Matching Factorio **2.0.77** clients. This alpha pins the game version and disables
  optional Space Age mods for base-game/PC/Switch compatibility.
- Docker Desktop on Windows is the previously verified game host. Mac/Linux/ARM
  setup configuration is provided; game execution on those hosts is not verified
  by this change. Rootless Docker, remote daemons and Internet hosting are outside
  this release’s setup support.

The app and setup run in containers; you do not need Node.js on the host.
This repository includes no game binaries, mods, personal saves or accounts.

## Guided setup (recommended)

After installing and starting Docker, open the extracted folder and run:

- **Windows:** `.\Setup.ps1` in PowerShell.
- **Mac:** double-click `Setup.command`, or run `sh Setup.sh` in Terminal.
- **Linux:** `sh Setup.sh` in Terminal.

Choose a new world, import a save from `import/`, or recover an expired
registration link. The guide preserves existing data, helps configure the
connection address and asks before starting the stack (default No).
Run `sh Setup.sh --check` or `.\Setup.ps1 -Check` for read-only checks.
No host Node.js installation is needed.

See [host-specific setup and troubleshooting](docs/SETUP.md), including Linux
ARM64 emulation prerequisites. Setup does not install emulation or open firewalls.

## Manual first-time setup

Download the source or clone this repository. Work in its root directory.

1. Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell,
   or `cp .env.example .env` on Mac/Linux).
2. Set `SERVER_ADDRESS` to the Docker host's reserved LAN IPv4 address or DNS name.
   Keep the port out of this value. For access only on the host, leave `localhost`.
   On native Linux Engine set `DOCKER_SOCKET_GID` to the result of
   `stat -c %g /var/run/docker.sock`; Docker Desktop uses 0. Leave
   `FACTORIO_PLATFORM=linux/amd64` so the game and isolated map workers agree.
   On ARM64, configure Docker’s amd64 emulation first; see the setup guide.
3. Choose **one** of these setup commands:

   ```sh
   # New random world, generated when Factorio first starts:
   docker compose run --rm --build setup --new-world
   ```

   ```sh
   # Existing save: first copy your ZIP into an import/ directory in this checkout.
   docker compose run --rm --build setup --save /workspace/import/world.zip
   ```

   Setup validates imported ZIP contents and copies the save. It prints a private,
   single-use registration link, valid for 24 hours. Keep it private. Existing
   saves/configuration/accounts are preserved on reruns; importing over existing
   saves is refused. Setup does not start or stop the game.
4. Start the stack:

   ```sh
   docker compose up -d --build
   docker compose ps
   ```

5. Open the registration link to create your administrator account. The normal
   panel address is `http://YOUR_SERVER_ADDRESS:8080`. In Factorio choose
   **Multiplayer → Connect to address**, then `YOUR_SERVER_ADDRESS:34197`.

The initial LAN game pauses when empty, autosaves every five minutes, retains ten
autosaves, and saves when the last player leaves. Game account verification is
disabled for LAN usernames; anyone on the allowed network can join the game
unless you set a game password or whitelist. Panel registration remains private
and invitation-only. Add a game password under Settings if needed.

If a setup link expires, generate a replacement without changing the world:

```sh
docker compose run --rm setup --registration-link
```

This invalidates previous setup/recovery invitations and retains registered users.
Do not run setup or start a second stack against another server's data directory.

## Network and startup

Allow TCP 8080 (panel) and UDP 34197 (game) from your trusted LAN. Do not forward
these ports from your router. The internal controller and RCON ports are not
published. Reserve the host's IP address in your router so clients keep the same
connection address. The `.env` file also supports alternate published ports,
additional allowed panel hostnames and container names.

The Windows helper `Configure-Lan.ps1` opens default ports only on Private
networks for the local subnet; run it as administrator if necessary. For custom
ports, configure the firewall yourself. `Start-LanAnnouncer.ps1` is an optional,
version-specific Windows workaround for PC discovery; direct connection is the
primary supported path. Switch LAN discovery can differ from PC discovery.
Use unique LAN usernames and the exact matching game version on all clients.

All three services restart with Docker. Enable Docker Desktop's **Start when you
sign in** setting on Windows/Mac, or enable the Docker service on Linux. Windows
Desktop startup requires sign-in. `Configure-Autostart.ps1` and
`Register-LanAnnouncer.ps1` are optional Windows helpers; they change host startup
settings only when explicitly run. They are not part of setup.

## Operations and upgrades

Use the panel for saves, backups and world changes. World switches/restores
disconnect players and create a backup first. To stop the stack with time to save:

```sh
docker compose stop
docker compose start
```

Before an upgrade, download a verified full backup and keep a copy on a separate
device. Read the release notes, update the source, then deliberately run
`docker compose up -d --build`. This can recreate containers and disconnect players.
Editing source files alone does not update the running app. Do not upgrade the
Factorio image independently of the clients. No automatic game/mod updates occur.

The panel checks public GitHub releases every six hours and notifies administrators
in Settings and the sidebar. Settings → Updates lets an administrator review and
install supported panel/controller releases or separately upgrade Factorio to a
chosen newer 2.0.x version, with pre-update backups, persistent progress and recovery.
See [in-panel updates and one-time enablement](docs/UPDATES.md). Preview releases
are included by default for this alpha; stable-only and offline modes are available.

Keep `data/`, `backups/`, `.panel-data/` and `.env` private. Never upload the entire
working directory: those folders contain worlds, credentials, invitations and
server configuration. `.gitignore` excludes them, and the release packaging tool
uses an explicit source allowlist.

## Alpha limits

- Trusted LAN over HTTP; no built-in TLS or Internet deployment support. The
  controller has Docker socket access, which effectively grants control of the
  Docker host. Treat panel administrator access accordingly.
- Only one stack per checkout. State uses JSON files; multi-controller/replica
  deployments are unsupported. Web restarts expire browser sessions.
- Saved maps are sampled overviews of explored Nauvis, capped at 2,048 chunks,
  80,000 objects and 24 MB. They are not full game graphics.
- Live player positions are off by default. Enabling them requires explicit
  acknowledgement that Lua commands disable achievements for that world; the
  panel creates a verified backup first. Turning tracking off does not undo this.
- Save uploads: 128 MB. Backup ZIP uncompressed total: 512 MB. ZIP64 and encrypted
  ZIPs are unsupported. Backups stored on the same host are not disaster recovery.
- World previews take a few seconds and can delay another management operation
  until the current preview finishes. Version-specific world options target 2.0.77.
- Tests cover access controls and destructive-operation recovery, but this alpha
  has not received an independent security audit.

See [feature documentation](panel/README.md), [development](docs/DEVELOPMENT.md),
[release notes](CHANGELOG.md), [security guidance](SECURITY.md), and
[third-party notices](THIRD_PARTY_NOTICES.md).

## License

Original project code is [MIT licensed](LICENSE). Factorio and the external game
image have separate terms. This is an unofficial project, unaffiliated with Wube.
