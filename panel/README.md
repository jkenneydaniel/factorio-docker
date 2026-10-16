# Panel features and architecture

Factory Control v0.2.0-alpha runs as two containers built from the same image:
a browser-facing web service and an internal controller. A third container runs
Factorio. See the [root setup guide](../README.md) before starting.

## Accounts

First-time setup prints a private one-use administrator registration link.
Registered administrators can invite administrators or viewers from Accounts.
Viewers can inspect status, maps, worlds and sanitized logs; they cannot manage
the game or download full backups. Passwords use salted scrypt hashes; invitation
tokens are stored hashed. Sessions expire after eight hours or a web restart.
Users can change their password and revoke other sessions. Administrators can
change roles and remove users, with protection for the last administrator.

## Server and worlds

The dashboard shows players, running/paused status, game version, world, seed,
playtime, recent saves and resource usage. Administrators can save, start, stop
and restart; edit server settings; manage players, bans and whitelists; send
announcements; and use a restricted set of administrative console commands.

Worlds contains save uploads/downloads, the world library, world switching and
new-world creation. Switching saves and backs up the active game before loading
the selected world, and attempts rollback if it cannot become ready.

The new-world editor exposes resources, terrain/climate, cliffs, map dimensions,
enemy rules/evolution/expansion, research costs, spoil time and pollution. Sliders
and numeric inputs share server validation. Advanced JSON can add supported
engine settings but cannot bypass the normal field bounds.

Start with the panel's standard 2.0.77 preset, or load settings from an isolated
copy of the current save. The preset specifies the exposed controls; omitted
engine tuning uses Factorio defaults. Copied settings retain advanced values.
Before generation, missing gameplay tuning is filled from the exact installed
game image through Docker's read-only archive API, including while it is stopped.
Settings exports execute Lua only in a disposable copy. Fresh worlds are never
scripted; individual generation choices can still affect achievement eligibility.

Automatic 1024-pixel previews use the visible seed and update 900 ms after an
edit. Invalid fields and unapplied JSON pause updates. Gameplay-only changes
reuse the terrain preview. One isolated worker renders at a time with no network,
a one-CPU/1-GB limit and a 60-second wait. There is one pending draft per account,
up to eight queued accounts and eight cached images for ten minutes. Workers
are removed afterward; previews do not modify the active game or create saves.

## Backups

Full backups include worlds, configuration and mods. New archives are checked
for CRC integrity, nested save validity and required files. Verification confirms
archive integrity; it does not prove that every backup has been test-restored.
Restore creates a backup of the previous state and attempts rollback on failure.

Scheduled backups are optional. Only backups marked as scheduled are deleted by
their retention policy; manual and pre-change backups are retained. Health shows
space, archive sizes, verification results, next run and warnings.

## Map

Saved explored Nauvis is exported from an isolated copy of a completed save.
The active game receives no Lua from normal map export. Automatic refresh follows
completed autosaves, manual saves, last-player disconnect saves and shutdown saves;
it does not recursively request another save. Pending exports are coalesced and
persist across controller restarts. Open maps check for updates every five seconds
and preserve pan, zoom and enabled layers.

Maps support resources, buildings, railways, power, pollution, saved player
positions, chart tags and shared pins. Sampling and export limits appear in the
root README. Pins are scoped by world name and seed. Historical snapshots and
other-surface maps are not included.

Optional live positions update on demand every two seconds while a signed-in
browser views the map. They require per-world achievement consent and a backup.
World switches and restores turn tracking off and require fresh consent; ordinary
restarts of the same world preserve the setting. Stale telemetry is hidden.

## Storage and privileges

| Path | Contents |
| --- | --- |
| `data/` | Game saves, configuration, mods, logs and temporary isolated workers |
| `backups/panel-backups/` | Full backups |
| `backups/panel-worlds/` | Uploaded/generated/archived worlds and retained previews |
| `.panel-data/auth/` | Accounts and hashed invitations |
| `.panel-data/secrets/` | Internal controller key |
| `.panel-data/controller/` | Jobs, schedules, maps, pins and validation records |

The unprivileged web service has no Docker socket or game data. The controller
runs as UID 845, with the configured Docker socket group, no extra capabilities,
read-only container filesystem and no published port. Its fixed endpoints require
the internal key. Access to Docker remains powerful; see [security](../SECURITY.md).

Setup is a separate, explicitly invoked profile. It has no Docker socket or
network and writes only its mounted checkout. On Linux it assigns newly created
game/controller files to UID 845 and auth files to UID 1000. It does not recursively
change ownership of existing worlds or accounts.
