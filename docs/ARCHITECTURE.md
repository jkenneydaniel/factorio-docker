# Shared core and game modules

Lobby Goblin has a shared web/controller core and built-in Factorio and Rust
modules. Factorio remains the default for standalone installations. The opt-in
[host manager](FLEET.md) provisions isolated instances of either module;
it is a separate Compose project and never adopts an existing standalone server.
Modules remain built in rather than downloadable plugins.

The fleet web shares accounts/sessions and mounts no Docker socket or game data.
Explicit `/servers/<id>/` URLs delegate existing game controls. The trusted fleet
controller owns the registry, resource budget, port allocation and shared library.
Each game has an instance controller, private bridge, named volume and fresh
secrets. Instance Docker calls verify ownership labels and the exact data mount;
preview workers receive only that instance's work subdirectory. Snapshot workers
copy completed backups, strip credentials, verify hashes and clone into new
volumes. The source volume is never mounted writable by another game.

[Remote hosts](REMOTE_HOSTS.md) use a persistent TLS 1.3 HTTP/2 connection opened
by the panel on the agent’s configurable dedicated port (default 24443).
`fleet/agent-identity.js` persists the certificate identity and includes its
fingerprint in the one-time pairing code; `fleet/agent-connection.js` verifies
that pin before sending credentials, multiplexes streamed responses, keeps the
connection alive and reconnects without replaying interrupted commands. Existing
HTTPS pairings remain compatible.
`fleet/hosts.js` stores outgoing credentials privately and incoming hashes; the
agent gateway exposes only approved host/game routes. `host-install.js` creates
an agent-only installation without accounts. `fleet/host-setup.js` binds SSH
fingerprint review to the administrator and exact plan, then installs/pairs with
credentials held only in memory. `fleet/agent-update*.js` journal and replace the
two management containers while leaving game containers and storage in place.
Agent-only startup skips automatic game-image migration. Remote game URLs are
scoped by host and server; accounts and sessions remain in the main panel.

## Repository and installed layout

The shared runtime stays under `panel/`. Container build sources for both games
live under `images/`; host helper scripts live under `scripts/`. Release packaging
maps these sources to historical installed paths instead of changing installed
mounts, identifiers or updater validation rules. See [repository layout](REPOSITORY.md)
for the mapping and deliberate exceptions for runtime deployment templates.

## Responsibility boundaries

| Component | Owns |
| --- | --- |
| `panel/core/web.js` | Sign-in, sessions, CSRF, account administration, viewer/admin enforcement, controller proxying and static asset allowlisting |
| `panel/core/accounts.js` | Account/invitation persistence and password/role rules, with an account-deletion hook for module data |
| `panel/core/controller.js` | Controller authentication, persistent jobs and their operation lock, backup scheduling/retention, update coordination and HTTP lifecycle |
| `panel/core/backups.js` | Archive storage, verification records, checksums, listing and health; asks the module to collect and validate game data |
| `panel/core/host.js`, `docker.js` | Docker requests, container lifecycle and resource sampling; no game commands |
| `panel/core/archive.js`, `files.js` | Bounded ZIP processing and file listing |
| `panel/core/game-images.js`, `image-migration.js` | Owned image contracts, migration-only historical recognition and journalled replacement; game-specific consistency remains in module backup/stop/readiness hooks |
| `panel/core/standalone-migration.js`, `panel/fleet/migrations.js` | Compose/registry ownership checks, operation coordination and durable environment/controller changes for automatic image migration |
| `panel/games/index.js` | Explicit registry of built-in modules; defaults to Factorio without new environment settings |
| `panel/games/factorio/` | Factorio transport, readiness, telemetry, saves, settings, world generation/switch/restore, map workers, drafts/presets, installation preparation and update/image compatibility |
| `panel/games/rust/` | WebRCON, ownership/readiness checks, lifecycle, stopped-server configuration, streamed identity archives and a standalone prepare-only installation template |

Shared helpers for authentication, JSON persistence, retention and release sources
retain their existing top-level paths. The Factorio web declaration selects the
existing frontend files and public URLs. Game screens remain tailored to each
game. `panel/public/shell.js`, `shell.css` and `client.js` supply common navigation,
account identity/sign-out, scoped URLs, status, operation progress, feedback,
confirmation dialogs and browser transport for fleet, Factorio and Rust. Rust
retains its `rust_session` cookie and separate standalone account storage.

## Managed game definitions

Each built-in game supplies a version 1 `managed` adapter from its own
`managed.js`. `core/managed-game.js` checks the contract and derives the public
catalogue and creation validation from the same definition. The adapter owns:

- Image resolution, published ports, data mount target and backup subdirectory.
- Resource/player defaults, bounds and additional numeric creation fields.
- Game and instance-controller environment variables.
- New-volume preparation and configuration after any snapshot has been restored.
- Snapshot content collection, restore, compatibility and player-data metadata.
- Optional historical image-migration participation and standalone paths/names.

`FleetManager`, the storage worker and snapshot coordinator delegate those rules;
they retain ownership checks, budgets, port reservations, fresh credentials,
empty-volume requirements, hash verification and atomic snapshot publication.
The game-specific archive extraction remains inside each game module. Existing
Factorio ZIPs, Rust identity archives and snapshot manifests keep their formats.
Legacy migration machinery still recognizes historical image contracts; it is
not a general migration mechanism for future games.

`core/instance.js` and `core/owned-docker.js` hold shared identities and scoped
Docker checks. The historical fleet exports remain compatible. Controller route
exposure comes from `core/routes.js` in the web, fleet and remote gateway.
Fleet accounts use the core account store and one transaction queue; modules
provide optional account-data extensions and deletion hooks. Factorio drafts
and presets keep their existing account/server scope and storage paths.

The third-game fixture in `panel/test/fleet.test.js` provisions TCP ports and
custom storage, publishes a snapshot and clones independent data through these
services. It does not register or ship another production game.

## Shared product shell

All three entry points mount the same browser shell. Game navigation declarations
choose specialized screens; the shell owns the header, navigation presentation,
current account, status, operation strip, messages and general confirmation
dialog. Existing screen content, role checks and specialized forms remain with
their modules. Setup gating is opt-in: fleet waits for setup completion, while
Factorio hides navigation only inside its unfinished guide and retains "Do this
later" navigation. Rust has no guide and retains navigation for newly registered
owners. The shared client owns JSON/raw requests, current-session CSRF,
session-expiration handling and non-overlapping polling.

The shell uses explicit local/remote server URL scope. Hash changes never remove
that pathname, including world creation, registration and setup. Standalone
entry points, cookies and HTTP routes remain compatible. Legacy navigation DOM
hooks are retained for existing screens, with the shared shell presenting the
active navigation. Shared assets are allowlisted centrally, including for modules
that use a separate public asset directory.

Initial job persistence must succeed before an operation starts. Both the game
controller and host manager restore their previous in-memory history and release
the operation reservation if that write fails. General job recovery and the
single-process storage model otherwise retain their existing semantics.

## Module contract

`startController(module, options)` and `startWeb(module, options)` accept a trusted
module object. `panel/games/factorio/index.js` is the production example;
`panel/test/shared-core.test.js` supplies a different, test-only game with no
Factorio world files, commands or account extensions.

The definition supplies:

- `id`, `name`, `releaseRepository`, optional `stopTimeout` and explicit `routes`.
- `configuration(env)`, returning the container and data/state/library/backup paths.
- Optional `validateInstallation(config)`, checked before any controller state
  initialization. Rust requires matching ownership markers on all storage roots.
- `createController(context)`, returning game behavior described below.
- `createUpdater(options)`, supplying the update/recovery interface used by the
  core. Factorio's updater retains its existing installation-specific Compose
  checks, detached worker, pinned images and explicit restore recovery. Another
  game needs its own update policy; it must not reuse Factorio's image validator.
- `diagnostics(options)`, providing metadata-only game/platform diagnostics.
- `web`, declaring its account class, session cookie, assets, account routes,
  administrator-only read routes, request size limits, onboarding readiness
  validation and diagnostic report composition.

The controller context provides configuration, environment, the host/Docker
transport, tracked timers (`every`), current jobs/active operation/schedule,
backup storage, updater, `runJob`, `stageMessage` and `imageMigrationPending`.
Background game work must defer mutations while image migration is pending. Updater and backup accessors
are available after controller creation; use them from runtime hooks/actions,
not while constructing the adapter.

The controller adapter supplies:

| Interface | Contract |
| --- | --- |
| `actions`, `validateAction(body)` | Explicit game actions and request validation; public jobs cannot invoke arbitrary commands. Confirmation rules stay with the game. Core backup/verification/cleanup actions are reserved. |
| `status()`, `recentStatus()`, `locations` | Game-specific status and sanitized diagnostic context |
| `handle(req, res, url)` | Game HTTP endpoints, restricted to the definition's declared routes |
| `backupFiles(label, options)` | Obtain a consistent game snapshot and return archive entries; the game owns save-completion semantics and required files |
| `validateBackup(buffer)`, `backupVerified(result)` | Validate the game's archive layout/content and describe verification; archive integrity is distinct from a successful game-load restore |
| Optional `writeBackup(target, label, options)`, `verifyBackupFile(file)`, `backupExtension` | Stream game archives without the ZIP buffer limit. Rust uses `.tar.gz`, complete stopped-identity inventory and per-file hashes. Listing, download, verification and retention use the declared extension; Factorio defaults to ZIP. |
| Optional `validateSchedule(value)` | Game-specific acknowledgement before enabling scheduled backups; Rust requires interruption consent. |
| `init()`, `start()` | Recover module jobs/helpers and start background work; timers use `context.every` and are cleared when the controller closes |
| `waitIdle()`, `beforeJob(job)`, `afterJob(job, params)`, `invalidate()` | Coordinate game background work with shared jobs/updates and invalidate status after operations |

The updater supplies `init`, `refresh`, `status`, `plan`, `install`, `restored`,
`jobs`, `busy`, `pendingRestore` and `current`, preserving the existing recovery
contract. Update reservations must cover backup creation and worker launch.

Game actions are serialized by the core's operation lock. Module workers must
respect that lock and updater reservations. HTTP mutations retain the existing
administrator/CSRF checks in the web service and bearer authentication in the
internal controller. Declaring a frontend control never grants backend access.

The [mod library](MOD_LIBRARY.md) shares review pinning, file journals, recovery
and UI under `panel/core/mod-*` and `panel/public/mod-library.*`. Game adapters
own upstream metadata, dependencies, paths and lifecycle semantics. Factorio
requires a stopped process; Rust can explicitly opt into framework hot apply.
Both reuse the core job lock and web administrator/CSRF checks. Read-only review
never performs lifecycle actions.

## Existing installations

The original shared-core refactor preserves the contracts below. Separately,
v0.3.4 performs a one-time, backup-protected image migration after installation;
see [the image migration contract](IMAGE_MIGRATION.md). Persistent account and
world paths remain unchanged. The migration updates the owned image reference
and, for Rust, its instance controller configuration.

Compatibility retained by the original refactor:

- `server.js`, `controller.js`, `setup.js`, `update-worker.js` and existing module
  import paths remain available as entrypoints/compatibility exports.
- Compose services, ports, explicit installed images, mounts, UID/GID policy, Factorio environment
  variables and the `factorio_session` cookie name retain their existing values.
- Accounts/invitations, account-owned drafts/presets, jobs, schedules, retention,
  map metadata/pins, live-tracking consent and update/recovery records retain their
  existing paths and formats.
- World ZIPs, full backup ZIPs and their manifest/verification records keep their
  existing layout and validation rules. Existing worlds are not rewritten.
- Factorio HTTP routes and frontend asset URLs remain the same. No new game
  selector or Rust controls are exposed in an existing installation.
- The image now copies `core/` and `games/`. Both the legacy-compatible update ZIP
  and complete source ZIP include these nested paths under the existing `panel/`
  allowlist; updater/state contract versions remain unchanged.

Editing source does not deploy it. Prepare a normal tested release before an
installation upgrade. Keep the live game and existing worlds untouched during
refactoring and validation; fixture tests use temporary data and mock Docker.

## Adding a game later

Implement the interfaces above in a new built-in module, register it explicitly,
and provide its own reviewed installation/launcher definition and frontend assets.
Test at least readiness, safe shutdown, save consistency, backup/restore, update
failure recovery and backend permissions using disposable fixtures first.

Register the game once in `panel/games/index.js`, implement the managed adapter,
and add contract, lifecycle and snapshot fixtures. Generic fleet provisioning,
storage workers and shell code should not need game-ID branches.

Do not expose arbitrary module paths or downloadable executable plugins. Do not
assume another game has a Factorio-style world ZIP, pause state, map exporter or
achievement consent. Managed servers use per-instance data, credentials and
operation locks; existing standalone installations are never adopted implicitly.

## Rust isolation

`GAME_MODULE=rust` explicitly selects Rust in its standalone stack. Omitting it
keeps the legacy Factorio behavior. Rust setup refuses existing destinations or a
destination inside the Factorio checkout. All generated service/container names,
network, data roots, controller/account state and secrets belong to a new instance.
The controller validates storage markers before shared state writes, then checks
the Rust container's labels, image and data bind mount before commands/mutations.
It cannot run Factorio world/map actions or the Factorio updater. See
[the Rust guide](RUST.md) for supported operations, archive limits and runtime
acceptance boundaries. In-panel restore and automatic Rust updates are outside
this module's current scope. Game-load recovery is a separate acceptance test.

## Product naming

Lobby Goblin is the product and repository name. Historical update archive roots,
worker names and published Factorio image labels are compatibility identifiers;
they remain readable through `panel/branding.js`. Release packaging also emits
historical asset aliases for already installed updaters. New panel builds and
workers use Lobby Goblin names. Existing installation directories and state are
never renamed automatically. See [the update guide](UPDATES.md#lobby-goblin-naming-compatibility)
for older release checks after the repository rename.
