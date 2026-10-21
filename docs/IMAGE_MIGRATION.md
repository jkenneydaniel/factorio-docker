# v0.3.4 image migration

Lobby Goblin now maintains both game images:

| Game | Default image | Game installation |
| --- | --- | --- |
| Factorio | `ghcr.io/jkenneydaniel/factorio-server:2.0.77-fc.3` | Same Factorio 2.0.77 binary and `/factorio` layout |
| Rust | `ghcr.io/jkenneydaniel/rust-server:steam-lg.1` | First-party SteamCMD bootstrap; existing binaries in `/steamcmd/rust` are reused |

These image tags must be published and publicly pullable before the release's
download assets are attached. Production migration verifies the platform,
compatibility/revision labels and registry digest before requesting a backup or
stop. An unpublished image leaves the installed game alone. Local acceptance
tools explicitly allow a locally built image; controllers do not.

## What installing the controller does

On startup the host manager scans only its own non-removed registry entries.
A standalone controller checks only its configured Compose installation. Neither
discovers or adopts unrelated servers. A panel-only update to this release is
also authorization for the one-time game image migration described here.

Supported automatic inputs are Factorio Tools **2.0.77**, older owned
**2.0.77-fc.1/fc.2** wrappers, and the exact Didstopia Rust digest used by the
previous catalog (`sha256:f935f9631e53ad1a235b446496716e1ae65a8d179a3b620abf38e29b9877f88e`).
Unknown images, custom entrypoints, Oxide, custom Rust startup commands/maps,
Compose overrides and inconsistent ownership/storage require a reviewed upgrade.
There is no continuing third-party image selection or update mode.

For each supported server the controller:

1. Checks ownership, mounts and the replacement image before changing the game.
2. Creates and integrity-verifies a game-state backup (Factorio data or the
   complete Rust identity). Installed game binaries are not part of that archive.
   Rust saves and briefly
   stops while making its consistent identity archive, then resumes as usual.
3. Requests a clean stop without an OOM. Factorio status 143 is accepted only
   with a completed save and `Goodbye` from that specific run. The Rust supervisor
   accepts self-termination only after its own acknowledged save and explicit
   game quit message; other crashes remain failures. It never forces a Rust kill.
4. Retains the original container as `<original-name>-pre-lg034`, stopped with
   automatic restarts disabled and its network endpoints disconnected.
5. Creates the first-party replacement using the original storage, published
   ports, resource limits, restart policy and network aliases. Wrapper-specific
   environment flags are retired; the game's compatible settings are retained.
6. Persists the new `.env` image or private fleet registry/controller settings
   before starting the replacement. A previously stopped game stays stopped.
   A previously running game must report readiness before migration completes.
   Rust also requires the owned image's completed-startup health proof, because
   WebRCON can answer before world initialization finishes.
   For standalone Compose installs, only after verification, remove the stopped
   old container without deleting its volumes. Keeping duplicate Compose service
   labels could make a later Compose start launch two copies against one world.
   Its original image and complete container configuration remain in the journal.

Other mutations, scheduled backups/cleanup and automatic Factorio preview work
are held while a standalone migration is pending. The host manager holds its
operation lock while migrating and keeps failed instances in maintenance mode.
The migration backup is excluded from automatic retention cleanup.

Rust never updates its installed game build as part of image migration. The
bootstrap checks the existing save's seed and size and preserves `server.cfg`,
player databases and the WebRCON credential. An existing world with no matching
installed binary fails closed. New servers install Steam's public build once.
New, independent snapshot clones explicitly permit that first installation;
they may require a compatible Steam build and are not a way to update an active
world. Snapshot files and the source server are never modified by cloning.

## Installing without replacing the game prematurely

Keep private environment files, accounts, secrets, data and backups in place.
Do not change the legacy image setting by hand before the new controller runs.
For a standard Factorio installation, the normal in-panel **panel update**
preserves the old game container during installation. Its completed update is
followed by migration. Future game-version changes remain a separate reviewed
Factorio update.

For a manual standalone upgrade, reconcile/copy the public source first and
build/replace **only the panel and controller services**, using `--no-deps`.
Factorio service names are `panel-controller panel`; Rust names are
`controller panel`. For example, from the reviewed Rust installation:

```sh
docker compose build controller panel
docker compose up -d --no-deps --no-build controller panel
```

Use the new Rust template/source with the existing `.env`, `rust.env`, identity
and control directories. Avoid a whole-stack `up` until migration has completed:
it could apply a new game template before the controller makes its backup.
The separate host-manager launchers update only their manager services; managed
game migrations then run through their registered child controllers.

## Recovery and interruption

Private journals record intent before replacement and resume on controller or
manager restart. Standalone journals are
`.panel-data/updates/image-migration.json` (Factorio) or
`control/controller/image-migration.json` (Rust). Fleet journals are
`/fleet/migrations/<server-id>.json`. They contain private container configuration;
do not publish them. The original `.env` is also kept privately for standalone
migration. These files are independent of the source-update baseline.

If backup or image preflight fails, no replacement happens. If a later step
fails before completion, the verified backup, game storage and original container
configuration remain available; the stopped original container is retained until
verification succeeds. The replacement may remain running after a readiness timeout; check
its status before any recovery action. Resolve the reported condition and restart
the relevant controller/manager to resume. Completion verifies that the expected
replacement still exists before clearing the operation gate.

A fleet retained original uses the **same data mount**; it is not an independent
copy. Never start it alongside the replacement. Standalone originals are removed
after verification to avoid duplicate Compose services. No data volume is deleted,
no world is silently rolled back, and no backup is restored automatically. Verify a backup in a new disposable location before deciding to
replace active data. Keep recovery resources until the migrated server has been
accepted, then remove them deliberately with the game stopped as appropriate.

Preparing/building this source and running acceptance tools does not install the
release in any existing deployment. See [verification](VERIFICATION.md) for the
separate local and native disposable acceptance evidence.
