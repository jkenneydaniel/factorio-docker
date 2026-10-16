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
artwork rather than Factorio renders. Stop it with Ctrl+C.

## Build without deploying

```sh
docker build -t local/factory-control:0.1.0-alpha panel
docker compose --env-file .env.example config --quiet
```

Building images and editing source do not replace running containers. Avoid
`compose up`, restart, stop, down and live management scripts against a production
checkout during release preparation. Real smoke checks need a disposable checkout,
distinct project/container names and loopback-only ports. Never share its state
directories with production. Windows Docker Desktop is the verified host; test
a separate Linux host before claiming Linux verification.

## Prepare a public source artifact

From the repository root:

```sh
node tools/release.mjs
```

This packages only explicitly allowed source roots into
`dist/factory-control-0.1.0-alpha/`, plus a ZIP, SHA-256 checksum and file manifest.
It rejects symbolic links, unexpected file types and common credential/private
deployment patterns. It never copies `.env`, state, saves, backups, captures or
local diagnostics. Review the manifest and Git changes before publishing. This
check is a release safeguard, not a general secret scanner or security audit.

## GitHub

Create the repository **from the clean directory inside `dist/`**, or initialize
Git here and review every staged path against the generated manifest. Do not drag
the full working directory into GitHub. The public source is MIT licensed.

CI runs tests, validates default Compose configuration and builds the image.
Publishing a GitHub Release tagged `v0.1.0-alpha` runs the release packaging
workflow and attaches the source ZIP, checksum and manifest. No image registry
push is configured until a repository/registry owner is chosen.

Before publishing, enable private vulnerability reporting, confirm the release
notes and supported platforms, review the source archive, and tag only tested
source. GitHub workflows run after upload; their hosted results cannot be checked
locally in advance. Releases do not upgrade installed servers automatically.
