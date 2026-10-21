# Lobby Goblin Rust image

`ghcr.io/jkenneydaniel/rust-server:steam-lg.1` is an independent vanilla bootstrap
image. It uses the digest-pinned Node/Debian base and checksum-verified official
Valve SteamCMD archive in `image.json`. It does not inherit Didstopia's image or
startup/shutdown scripts. Rust and Steam remain subject to their own licenses.

The data mount stays `/steamcmd/rust`, identity `lobby-goblin-rust`, with game/query
UDP 28015/28017 and internal WebRCON TCP 28016. A root supervisor normalizes data
ownership; SteamCMD and Rust run as UID/GID 1000. Existing binaries are reused
without Steam updates. New installations download app 258550 once. The supervisor
loads the existing save's seed/size and leaves `server.cfg` in control of settings.
The image becomes healthy only after the game reports completed startup. A
root-owned marker records the current child PID; the healthcheck also verifies
that process is alive. WebRCON can answer while the world is still loading, so
the controller waits for this health proof before readiness or save/stop actions.
SIGTERM asks Rust to save and quit; the controller requires a clean exit.
Rust can end its own quit handler with SIGKILL. The supervisor accepts that only
for its own acknowledged save, observed save completion and explicit game quit
message; other signals or failures remain errors. It never sends SIGKILL.

Supported environment fields are `RUST_SERVER_IDENTITY`, `RUST_SERVER_PORT`,
`RUST_SERVER_QUERYPORT`, `RUST_SERVER_LEVEL`, `RUST_SERVER_SEED`,
`RUST_SERVER_WORLDSIZE`, `RUST_RCON_PORT` and `RUST_RCON_PASSWORD`.
Only vanilla Procedural Map servers are automatically migrated. Oxide/custom
startup wrappers and a world without installed binaries require review.

From the repository root, on a disposable Linux amd64 Docker host:

```sh
node --test panel/games/rust/image/test-runtime.test.mjs
node panel/games/rust/image/build.mjs build
docker build -t local/lobby-goblin-image-test panel
docker run --rm --network none --user 0:0 \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  --mount "type=bind,source=$PWD,target=/source,readonly" --workdir /source \
  -e ACCEPTANCE_PANEL_IMAGE=local/lobby-goblin-image-test \
  --entrypoint node local/lobby-goblin-image-test panel/test/image-acceptance.mjs rust
```

The acceptance runner creates labelled disposable volumes, containers and a
private network with no published ports. It loads a legacy fixture, tests the
real migration engine, checks settings/binary hashes, WebRCON reuse, lifecycle,
resources and saved-time backup recovery. It also runs the real HTTP controller's
status, players, logs, settings, verified backup and lifecycle actions. Add
`--fresh` to validate SteamCMD installation and recovery from an empty disposable
volume instead of a legacy fixture. Each run removes only its own resources.
It requires enough RAM/disk for an actual Rust server; ARM emulation is unverified.

The image sources stay under the existing `panel/` release allowlist so v0.3.3
updaters accept the complete source bundle. The build helper creates a temporary context
containing only the five required public source files. Regular CI builds/tests without publication;
the **Lobby Goblin game images** workflow publishes deliberately after acceptance,
refusing existing tags. Increment the image tag/revision for changes. Make the
GHCR package public before releasing the controller; migration needs no registry
credentials and rejects unpublished images. Publication does not deploy servers.
