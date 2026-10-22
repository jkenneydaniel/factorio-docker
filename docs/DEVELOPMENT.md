# Development and release

Use Node.js 24 or newer. Install the locked WebSocket and SSH dependencies before
testing; container builds install them automatically. Manual installation remains
independent of npm; automatic SSH setup runs from the installed panel runtime.
Keep the full checkout layout when testing: Rust image fixtures are under
`images/rust/`, outside the panel runtime directory. See [repository layout](REPOSITORY.md).
See [the shared-core/module contract](ARCHITECTURE.md) before adding game behavior.
The [Rust module guide](RUST.md) documents its separate, prepare-only installation.
`node panel/test/rust-ui-preview.js` serves a synthetic Rust panel on loopback
port 8090 with mock game/host transports and disposable storage.

`node panel/test/mod-library-preview.mjs` serves both real mod-library interfaces
on loopback port 8096. Use `/servers/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/#mods` for
Factorio and `/servers/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/` for Rust, then open
**Mods & plugins**. Accounts, catalogues, jobs and changes are synthetic and in
memory; there is no Docker or game data access. `MOD_LIBRARY_UI_PORT` selects
another port; `MOD_LIBRARY_UI_UPDATES=1` seeds an older installed mod for Updates.
Stop the fixture with Ctrl+C.

The Factorio fixture also accepts `UI_SERVER_SCOPE=/servers/<32-hex-id>` or
`/hosts/<32-hex-id>/servers/<32-hex-id>`. Open that exact path with a trailing
slash. With `UI_CREATE_TEST=1`, create a synthetic library world, verify that the
completion URL keeps the server path, then reload and return to its world library.
The fixture rejects unscoped requests so a scope regression cannot appear to work.
The production shared shell/client assets are served by these fixtures too.

`node panel/test/fleet-ui-preview.js` serves the host manager on loopback port
8098 (`UI_PREVIEW_PORT` overrides it). Sign in as `Preview` or read-only `Viewer`
with `isolated-panel-preview-password`. SSH installation, code pairing, agent
updates and creation are synthetic; no real SSH/Docker/game resources are used.
`node --test panel/test/remote-hosts.test.js` additionally exercises disposable
loopback controllers, the actual SSH handshake and fake-Docker update rollback.

```sh
npm ci --prefix panel --ignore-scripts
npm test --prefix panel
node --test images/factorio/test-build.mjs
python3 -B images/factorio/test_runtime.py
```

Tests create temporary fixtures and a mock Docker API; they never connect to the
real Docker socket. The test runner resolves both checkout and extracted-release
image paths. Release tests package a disposable source copy, run the frozen
v0.2.0/v0.3.3 updater validators against the compatible ZIP, and exercise the
extracted complete bundle without accessing an installed stack. If host filesystem
restrictions prevent renames, use a disposable full source checkout on Linux.
Copying only `panel/` is insufficient for checkout image tests.

`node panel/test/ui-preview.js` starts a loopback-only UI fixture on port 8089.
Its data are synthetic; it cannot manage a real game. Preview images are fixture
artwork rather than Factorio renders. Stop it with Ctrl+C. Optional environment
flags support browser checks: `UI_POPULATED=1`, `UI_ONBOARDING_TEST=1`,
`UI_READY_TEST=waiting`, `UI_ROLE=viewer`, `UI_AUTH_TEST=login`,
`UI_RELEASE_TEST=available`, `UI_UPDATE_REVIEW_TEST=1` and `UI_CREATE_TEST=1`.
`UI_DIAGNOSTICS_TEST=offline` simulates controller failure. `UI_RETENTION_TEST=1`
adds older synthetic backups and enables memory-only cleanup review, policy saves
and simulated deletion. It uses the real retention selection rules; daily cleanup
does not run in this UI fixture. Drafts and custom
presets use the real validation/revision logic with memory-only storage in the
fixture; reload the page to test persistence, restart the fixture to reset it.
`UI_PREVIEW_PORT` chooses another loopback port. Creation/completion are in-memory
simulations only; real lifecycle, account writes and installations stay blocked.

## Build without deploying

```sh
docker build -t local/lobby-goblin:0.3.6-alpha panel
docker compose --env-file .env.example config --quiet
```

Building images and editing source do not replace running containers. Avoid
`compose up`, restart, stop, down and live management scripts against a production
checkout during release preparation. Real smoke checks need a disposable checkout,
distinct project/container names and loopback-only ports. Never share its state
directories with production. Windows Docker Desktop is the verified host; test
a separate Linux host before claiming Linux runtime verification. The host setup
guide covers Mac/Linux x86-64 and ARM64 configuration; ARM64 game processes use
amd64 emulation. Host launcher tests substitute a fake Docker executable and
never create containers. CI exercises those launchers on Mac, Linux and Windows;
configured CI is not evidence of a successful hosted run.

## Prepare a public source artifact

From the repository root:

```sh
node tools/release.mjs
```

This packages only explicitly allowed source roots into
`dist/lobby-goblin-<version>/` using the version in `panel/package.json`, plus
compatible update and complete source ZIPs, each with a SHA-256 checksum,
file manifest and installer metadata. Packaging maps organized source paths back to their historical
installed locations; the runtime/update state contract is unchanged. See
[the mapping](REPOSITORY.md#downloadable-releases-and-older-updaters).
It rejects symbolic links, unexpected file types and common credential/private
deployment patterns. It never copies `.env`, state, saves, backups, captures or
local diagnostics. Review the manifest and Git changes before publishing. This
check is a release safeguard, not a general secret scanner or security audit.

## GitHub

The repository is `jkenneydaniel/lobby-goblin`; work in its Git checkout.
`dist/` is generated release output, not a second repository or source of truth.
Review the Git diff and generated manifests before publishing. Private runtime
paths remain excluded. The public source is MIT licensed.

CI runs tests, validates default Compose configuration and builds the image.
Publishing a GitHub Release tagged `v<version>` matching `panel/package.json` runs the release packaging
workflow and attaches both source bundles, checksums, manifests and installer
metadata. The separate **Lobby Goblin game images** workflow (`game-images.yml`) builds
and tests both games before optional GHCR publication; it never deploys installations.

Before publishing, enable private vulnerability reporting, confirm the release
notes and supported platforms, review the source archive, and tag only tested
source. GitHub workflows run after upload; their hosted results cannot be checked
locally in advance. Releases do not upgrade installed servers automatically.

## Game images in this repository

See [the image guide](../images/factorio/README.md) for the pinned build definition,
first-party startup/RCON runtime, isolated Python tests and separate container
acceptance/publication workflow. The [Rust image guide](../images/rust/README.md) covers its bootstrap and native
acceptance. Both image sources stay in this repository with independent versions.
Local changes must not deploy or migrate the running server. The compatibility baseline is Factorio 2.0.77 on linux/amd64.

## Game image migration acceptance

See [the image migration contract](IMAGE_MIGRATION.md) and
[the Rust image build/acceptance guide](../images/rust/README.md).
The shared migration and standalone/host coordination tests simulate Docker;
`panel/test/image-acceptance.mjs` deliberately uses a real Linux amd64 Docker
socket, new labelled resources and no published ports. Never aim it at existing
installation data. Image publication and release preparation do not deploy games.

## Shared runtime publication

`.github/workflows/panel-image.yml` builds the single panel/controller image for
amd64 and arm64, smoke-tests both, and publishes the versioned GHCR manifest on
explicit dispatch or release. The release workflow waits for this publication
before attaching installer metadata containing `panelImage`. Bump package/lock,
Dockerfile labels and default image references together. Development builds can
still use explicit local tags; installation updates consume verified published
digests. Neither workflow deploys a game or changes its world.
