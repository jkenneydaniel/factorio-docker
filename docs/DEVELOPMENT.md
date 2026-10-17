# Development and release

Use Node.js 24 or newer. There are no npm dependencies to install.

```sh
cd panel
npm test
```

Tests create temporary fixtures and a mock Docker API; they never connect to the
real Docker socket. Run them in Linux/Node Docker if host filesystem restrictions
prevent temporary-file renames. A read-only mount of the source is sufficient:

```sh
docker run --rm -v "./panel:/test:ro" -w /test node:24.22.0-bookworm-slim npm test
```

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
docker build -t local/factory-control:0.2.3-alpha panel
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
`dist/factory-control-0.2.3-alpha/`, plus compatible update and complete source ZIPs, each with a SHA-256 checksum,
file manifest and installer metadata.
It rejects symbolic links, unexpected file types and common credential/private
deployment patterns. It never copies `.env`, state, saves, backups, captures or
local diagnostics. Review the manifest and Git changes before publishing. This
check is a release safeguard, not a general secret scanner or security audit.

## GitHub

Create the repository **from the clean directory inside `dist/`**, or initialize
Git here and review every staged path against the generated manifest. Do not drag
the full working directory into GitHub. The public source is MIT licensed.

CI runs tests, validates default Compose configuration and builds the image.
Publishing a GitHub Release tagged `v0.2.3-alpha` runs the release packaging
workflow and attaches both source bundles, checksums, manifests and installer
metadata. The separate Compatible Factorio image workflow builds and accepts
the game image before optional GHCR publication; it never deploys installations.

Before publishing, enable private vulnerability reporting, confirm the release
notes and supported platforms, review the source archive, and tag only tested
source. GitHub workflows run after upload; their hosted results cannot be checked
locally in advance. Releases do not upgrade installed servers automatically.

## Independent game image

See [the image guide](../factorio-image/README.md) for the pinned build definition,
first-party startup/RCON runtime, isolated Python tests and separate container
acceptance/publication workflow. Local changes must not deploy or migrate the
running server. The compatibility baseline is Factorio 2.0.77 on linux/amd64.
