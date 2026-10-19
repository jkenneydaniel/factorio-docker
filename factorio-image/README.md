# Factory Control Factorio image

`ghcr.io/jkenneydaniel/factorio-server:2.0.77-fc.1` is the initial published image.
The current source builds `2.0.77-fc.2`, a locally verified, unpublished revision
that avoids duplicate ownership scans at startup. Existing image selections and
installation defaults still use their previous image. See
[performance measurements](../docs/PERFORMANCE.md).
It is built independently from digest-pinned Debian and the official Wube
headless download, verified against the SHA-256 in `image.json`. The image does
not use or copy from `factoriotools/factorio`. Publishing is a separate step;
adding this source does not make the tag available in GHCR.

Only `linux/amd64` (x86-64) is built for this release. ARM64 hosts may use Docker's
amd64 emulation where available; there is no native ARM image or bundled emulator.
Factorio 2.1 has native Linux ARM support, but changing the game branch is outside
this same-version compatibility migration.

## Compatibility contract

- Persist saves, configuration, mods, scenarios and script output under `/factorio`.
- Preserve user/group 845, `/opt/factorio/bin/x64/factorio`, the `rcon '<command>'`
  CLI, UDP 34197, internal RCON 27015 and `/docker-entrypoint.sh`.
- Keep existing settings, admin/ban/whitelists, RCON password, server identity,
  saves, mod files, mod settings and mod selections intact. Only missing files
  receive defaults. The runtime uses the chosen UID/GID and execs the game as
  PID 1 so it receives Docker's graceful shutdown signal.
- Support the panel's `LOAD_LATEST_SAVE`, `GENERATE_NEW_SAVE`, `SAVE_NAME`, data
  paths, `PORT`, `RCON_PORT`, `PUID`, `PGID`, `PRESET`, `BIND`, console logging and whitelist startup options.
  DLC defaults apply only when creating a missing mod list. Existing selections
  are never rewritten. Automatic mod downloads are unsupported and startup
  refuses `UPDATE_MODS_ON_START=true`; the standard stack already sets it false.
- A genuinely fresh installation can generate its first world. An existing
  server identity without saves is refused unless generation is explicitly
  requested. Existing saves are never overwritten by generation.

The first-party startup and RCON programs are MIT licensed. Factorio remains
proprietary; its license is not changed by the container wrapper.

The complete image build source is in Git and the release’s `.source.zip` bundle.
The regular ZIP remains compatible with older panel installers.

## Build and verify

For development, use Node 24 and Python 3 for the isolated source tests:

```sh
node --test panel/test/game-images.test.js panel/test/update-install.test.js factorio-image/test-build.mjs
python3 -B factorio-image/test_runtime.py
node tools/factorio-image.mjs describe
```

The following commands explicitly use Docker to build/test **a new image and
disposable data**, without targeting any installed stack:

```sh
node tools/factorio-image.mjs build
node tools/factorio-image.mjs test
```

The container acceptance test first runs the panel's read-only image preflight
against both sources, selecting amd64 metadata as needed. Published images use
verified repository digest references; a freshly built image without a registry
digest in a classic Docker store is tested by its immutable local image ID. The
panel still requires a repository digest for every installed image.
It uses Factorio Tools solely as legacy test input: it creates a world in a unique
disposable volume, loads it with our independently built image, checks RCON and
settings/mod/password checksums, saves, stops gracefully, then reloads the save
with the old binary. It also verifies direct world creation and a 128 × 128 PNG
map preview. Its Lua check acknowledges the achievement prompt only inside the
disposable save. It removes only its test containers and volume, publishes no
ports and disables container networking. It never mounts `./data`, invokes
Compose or targets the running server.
CI runs these checks before publication; local mocked/unit tests do not establish
container acceptance.

Local build and container acceptance passed on October 16, 2026, using OrbStack
on an ARM Mac with amd64 compatibility support. See `docs/VERIFICATION.md` for
the exact image identity and scope. This does not establish native ARM support,
an independent x86 Linux-host test or GHCR publication.

Revision 2 passed the same isolated build and container acceptance checks on
October 17, 2026. It retains Factorio 2.0.77 and the compatibility contract above;
these checks did not publish or install the new revision.

## Publish deliberately

Run the **Compatible Factorio image** GitHub Actions workflow with `publish`
enabled after reviewing the source. Regular pushes and pull requests build/test
only. Publication uses the repository's GitHub token, refuses an existing tag
and pushes the exact image that passed its test. Increment `revision` and the
matching Dockerfile default for packaging changes; update `version`, the official
archive checksum and Dockerfile defaults for game changes. Do not reuse a tag.

The GHCR package must be public before ordinary installations can pull it:
the panel does not forward personal registry credentials. First publication may
need repository package permissions/visibility configured in GitHub.

Publishing does not migrate servers. Once the tag is public and tested, use
Settings → Updates, choose Factory Control, keep the current Factorio version,
select the published image revision, then review and confirm. The installer
backs up existing data, validates the image without mounting world data, pins its
digest and replaces only Factorio. Failed readiness leaves the previous image
prepared but stopped for an explicit backup restore. Keep the old image and
pre-change backup until the migrated server has been accepted.
