# Single-host server manager

Fleet mode is a separate, opt-in Docker project. It never adopts an existing
Factorio or Rust installation, mounts its data, changes its ports, or restarts
it. Standalone `compose.yaml` remains available. Use `fleet.compose.yaml` by
itself, with its own `.env.fleet` and fresh identity. Do not merge Compose files.

v0.3.4 automatically migrates this manager's registered older images after a
verified backup and clean stop. It preserves each server's storage and previous
running/stopped state. Unrelated standalone installations remain outside its
registry. Read [migration and recovery](IMAGE_MIGRATION.md) before upgrading.

## Start

Docker Engine 26+ with Linux containers on an amd64 host is required by this
release. Factorio uses the first-party 2.0.77-fc.3 image; Rust uses the first-party
steam-lg.1 bootstrap and installs the Steam public server.
The game image references are resolved to registry digests before provisioning. Rust downloads the
Steam public branch separately, so its installed game build can change on a
fresh installation. Rust snapshot recovery across game-build updates remains a
compatibility limitation; the reviewed bootstrap digest alone does not pin that
build. No player-to-server network join is asserted by automated runtime tests.
Game images are pinned; arbitrary images, remote Docker daemons and ARM Rust
provisioning are outside this version.

Windows: `./Fleet.ps1 -Address <your-LAN-address>`.
Mac/Linux on amd64: `FLEET_ADDRESS=<your-LAN-address> sh ./Fleet.sh`.
Use `-BuildOnly` or `--build-only` to build without starting the manager.
The scripts generate a fresh ID in ignored `.env.fleet`, build the panel image,
start only the separately named host manager, and show its private one-time
administrator registration link. The default panel port is 8082. No firewall or
Docker Desktop configuration is changed. The address must match an allowed
hostname; game and panel ports default to all interfaces for LAN use.

The manager has a new account database. Existing standalone accounts are not
copied. Invitations create administrators or read-only users; these roles apply
to all servers in this host manager. Per-server user ACLs are not implemented.
Keep the invitation private; it expires after 24 hours. It is stored at
`/web-state/registration-link.txt` in the controller for an interrupted setup.

## Create and manage

Choose Create server, game, name, CPU, memory, player limit and an optional seed.
Rust also offers map size. Port allocation starts at UDP 35000 and checks Docker
port use; Rust gets a separate query port. Port clashes outside Docker fail
creation safely. RCON is never published. Each server has its own volume,
private network, game container, controller, generated secrets and operation
lock. Resource limits are applied to games and controllers; the memory budget
includes 1 GiB per controller and must leave at least 2 GiB for the host manager.
Existing host workloads need their own headroom when choosing this budget.

Open server uses the existing game-specific controls under an explicit server
URL. Multiple tabs remain independent. Factorio keeps worlds, previews/maps,
settings, players, logs, saves and backups. Rust keeps lifecycle, settings,
players, logs and verified identity backups. Standalone panel/image installation
updates are refused in managed mode; a fleet-aware updater is future work.

Creation progress appears under Host operations. Rust's first Steam download can
take several minutes. Opening its panel shows logs while the game's initial
start job runs. Interrupted or failed creation preserves resources and storage
for inspection; no world is deleted automatically. A manager restart marks host
jobs interrupted and preserves registered servers. Game restart policy follows
the creation setting; manually stopped `unless-stopped` games remain stopped.

## Host memory settings

Open **Host settings** in the host manager to see the configured budget, total
allocated memory, remaining allocation capacity, Docker memory capacity and each
server's game/controller limits. These are configured allocations, not current
RAM use. Stopped and incomplete servers count; removed servers do not. Every
managed server includes a separate 1 GiB controller allowance.

Administrators can save a whole-number budget without restarting games or the
manager. Changes persist in the fleet registry volume and override the initial
`FLEET_MEMORY_GIB` environment default on subsequent starts. Other administrators'
changes require reloading a stale draft before it can be saved. Changes are
blocked during host operations, below existing allocations, or above Docker's
memory capacity minus 2 GiB (up to a maximum budget of 128 GiB). Leave additional
headroom for other workloads. Docker/WSL limits and individual server memory
limits are managed separately. Read-only accounts can view allocations.

## Shared snapshot library

Publish snapshot first asks the source controller for a completed, verified
backup. Factorio confirms a save; Rust saves, stops, archives and resumes. The
library then copies only immutable backup content into a separate library volume.
Factorio snapshots contain its active world ZIP and mod files. Rust snapshots
contain the identity's world and player databases, maps and related files, but
exclude the entire `cfg` directory. Neither format copies server configuration,
RCON passwords, panel accounts, controller tokens, or access lists.

Every snapshot has a manifest containing the source, reviewed image, file sizes
and SHA-256 hashes. Publication uses a temporary directory and atomic rename.
Cloning verifies the manifest and every file, checks game/image compatibility,
and copies content into a new server volume. Rust clones preserve the source
map seed/size so the matching save loads. New name, configuration and generated
credentials belong only to the clone. Source and clone then evolve independently.
No writable world is mounted by two game servers. A snapshot remains available
when its originating server is removed.

To bring a standalone Factorio world into the library without adopting its host,
download a save through its existing panel, upload it through a new managed
Factorio server's Worlds screen, switch that new server to the uploaded world,
then publish it. Match game version and mods. Standalone data is never mounted.

## Removal and recovery

Remove server requires its exact name. It asks the controller to save/stop and
requires a clean exit before removing game/controller containers and the private
network. Its data volume and published snapshots are retained. This version has
no automatic retained-volume purge or adoption UI. Never use global Docker prune
commands for server removal. Back up both the fleet state and snapshot library
volumes; registry state contains generated per-server secrets and is private.
The web container has no Docker socket or game volumes. The trusted host and
instance controllers have Docker access, but operations validate fleet/instance
labels and the exact volume/subdirectory before acting. Only host-created
resources can be managed. Snapshot permissions and server administration share
the fleet's administrator role.

## Development

Use Node 24 and `npm ci --ignore-scripts` in `panel/`, then `npm test`. Unit tests
use disposable directories and a fake Docker API. Real acceptance must use a
fresh FLEET_ID, unique local image tag, loopback panel/game binds, high ports,
and only owned disposable volumes. It must create both games, retain two
independent same-game volumes, publish/clone and check hashes/credentials, open
both server URLs and prove unrelated resources are refused. Never run acceptance
through the production Compose project. See `docs/VERIFICATION.md` for recorded
results and limitations rather than treating configured tests as completed work.
