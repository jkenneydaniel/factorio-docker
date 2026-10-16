# Updates through the panel

Settings → Updates supports administrator-triggered installation for two separate
items: Factory Control (web panel and matching controller) and the Factorio game
container. Automatic checks notify; nothing installs without an administrator's
review and confirmation. This does not update Docker Desktop, Docker Engine, the
host OS or mods.

## Enable once on an existing installation

This feature must first be installed using the normal host upgrade procedure;
an older notification-only panel cannot install its own missing updater.
Preserve `.env`, `data/`, `backups/` and `.panel-data/`. Run the updated host setup
once without starting the stack (`sh Setup.sh --new-world` or
`.\Setup.ps1 -NewWorld`). On an existing installation it preserves worlds/accounts,
creates the private update-state directory and records hashes of installation
source files. This baseline is not silently reset on later setup runs.

When you deliberately deploy the new panel/controller, the image also includes
Docker's client, Compose and Buildx for a detached installation worker. No extra
host language runtime is needed. That first deployment is separate from preparing
this source and has not been performed on the running server.

The initial implementation supports the standard single `compose.yaml` local
installation layout and bind mounts, on the host platforms in SETUP.md. Additional
Compose overrides, custom container identities inconsistent with Compose labels,
custom game image repositories and unsupported state migrations require a reviewed
host upgrade. Existing customized ports, address and configured names are retained.

## Install a panel release

1. Open Settings → Updates and read the linked release notes.
2. Choose Review panel update. The server checks the eligible release, package
   availability, current container identities and a review expiry of 15 minutes.
3. Choose Install update. A world/config/mod backup is saved and archive-verified.
   The detached worker records recovery copies of source, environment, panel
   account/controller state and secrets in `.panel-data/updates/<job-id>/`.
4. The worker downloads the ZIP, checksum and installer metadata, validates ZIP
   contents/paths and the supported state contract, and builds a staged image.
   Source files with local edits block installation. The baseline is checked again
   after the build before source promotion.
5. Only the panel and controller are replaced. The game container is not restarted.
   Updated services must report healthy; otherwise the previous source/config and
   supported panel state are recovered and the previous image is restarted.
6. Sign in again after panel replacement and review Installation history. Progress
   survives panel replacement and is visible to other administrators. A temporary
   browser disconnect is not treated as success.

The source package and selected image stay consistent, so later host startup
builds the installed source rather than rebuilding old code over a new release.
Mount/port changes and new services are refused by this installer. Checksum
verification detects transfer corruption; it is not an independent signature or
protection against a compromised trusted release publisher. Do not install an
untrusted release merely because its checksum matches.

## Upgrade Factorio separately

Enter an exact newer `2.0.x` version and choose Review game upgrade. Confirm that
all clients, including Switch where applicable, and installed mods support that
version. The installer does not automatically upgrade mods or enable DLC. New
major/minor versions and arbitrary image URLs are intentionally not accepted.

Installation saves and verifies a pre-update archive, pulls the selected official
`factoriotools/factorio` version for `linux/amd64`, replaces only Factorio, then
checks its reported version through RCON. ARM hosts retain their emulation policy.
Players disconnect during game replacement. A stopped game is started by a
confirmed game upgrade; the review explicitly describes the operation.

If download/preflight fails, the running game is left unchanged. If replacement
or readiness fails, the game is stopped and the previous image is prepared in a
stopped container. Upgraded saves remain intact. **No world backup is silently
restored.** Restore the recorded pre-update archive explicitly from Backups; other
server jobs and further upgrades are blocked until that restore succeeds. Restore
keeps a copy of the failed state through the existing backup/restore workflow.
Saves written by a newer game may not load in an older binary.

## Release publication contract

The source packager and release workflow now emit/upload:

- `factory-control-<version>.zip`
- `factory-control-<version>.sha256`
- `factory-control-<version>.manifest.txt`
- `factory-control-<version>.update.json`

Installer metadata declares `format: 1`, the exact version, `updater: 1`,
`stateVersion: 1` and `rollbackSafe: true`. A release requiring persistent-state
migration must change that contract and provide an appropriate installer; do not
retain the rollback-safe flag by default when changing persistence semantics.
Previously published releases without the installer assets remain viewable but
cannot be installed through this flow. v0.2.0-alpha is the first release with
these installer assets. Installations on v0.1.0-alpha need the one-time host
upgrade described above before future in-panel updates are available.

## Checks, permissions and recovery

Automatic public GitHub checks run at startup and every six hours. Administrators
see installed/available versions, channel, last check and release notes. Checks use
an eight-second timeout, bounded responses, ETags and semantic version ordering;
they exclude drafts and never offer a downgrade. They consider at most the 100
most recent releases. Offline/rate-limit errors mean unavailable, not up to date.

`.env` options:

```dotenv
RELEASE_CHECKS=true
RELEASE_REPOSITORY=jkenneydaniel/factorio-docker
RELEASE_CHANNEL=preview
```

`stable` excludes prereleases; `preview` includes alpha/beta/RC versions. Disabling
checks also prevents panel-release review from fetching releases. A manually
requested Factorio upgrade still downloads its selected official image. Apply
environment changes deliberately; editing `.env` does not alter running services.
No saves, accounts, logs or credentials are sent to GitHub.

Review/install/history endpoints require administrator access. Mutations require
CSRF and same-origin verification. Updates serialize against world operations,
map previews and scheduled backups. Account changes are paused during updates.
The public web service has no Docker socket. The controller starts a tightly
specified, root update worker from its own installed image, with Docker access
and the installation bind mount. Treat this worker and release publisher as
trusted host-management code, as with the existing Docker-enabled controller.

The worker has no automatic restart after host power loss. Interrupted workers
are reported as failed and retain recovery details; a host/source recovery may be
needed. If automatic recovery itself fails, history explicitly requests host
intervention. Do not delete recovery directories or old images until you have
confirmed the update. Recovery copies contain private account/secrets state and
must stay private. Off-host backups and a successful isolated game restore are
separate from archive verification.

Implementation has been tested with temporary source/data fixtures and simulated
Docker operations. No live container lifecycle update, independent Linux/Windows
host, or ARM game-emulation acceptance was run for this work. See VERIFICATION.md.

References: [Compose recreation](https://docs.docker.com/reference/cli/docker/compose/up/),
[GitHub releases](https://docs.github.com/en/rest/releases/releases).
