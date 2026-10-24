# Product foundation verification — 2026-10-22

Source work on `codex/panel-product-foundation`, based on `dcb11d0`.
This is local source and disposable-fixture evidence. No release, installation
upgrade, Docker deployment, live game command or existing-world access was done.

## Implemented

- Failed initial job persistence restores history and releases the controller or
  host reservation before returning an error. The same guard covers the host's
  historical migration-job reservation.
- Factorio completion, setup and registration navigation retain local or remote
  server URL scope.
- Version 1 managed adapters own game provisioning, creation policies, ports,
  runtime configuration and snapshot content. Generic fleet services retain
  identity, ownership, allocation and integrity checks.
- Fleet, Factorio and Rust mount shared navigation, account identity/sign-out,
  status/progress, feedback and general confirmation components, using one
  browser client for requests, session expiration and polling.
- Fleet account-data extensions and deletion hooks come from modules and share
  the core account store's transaction queue. Existing Factorio setup IDs and
  per-server scoping remain intact.

## Automated evidence

The complete suite ran with Node **24.19.0** on macOS:

```sh
node panel/test/run.mjs
```

**347 tests: 346 passed, 0 failed, 1 skipped.** The skipped test checks Linux
service UID ownership. Fixtures use temporary storage and fake Docker transports.

Coverage includes failed initial writes and successful retries, legacy
configuration defaults, permissions and CSRF, local/remote server scoping,
archive integrity, migration coordination and both frozen updater validators.
Release bundle tests verify that the new adapters and shared shell assets are
included in compatible and complete source bundles.

A test-only third game provisions TCP ports and custom storage through the
generic manager and worker, publishes an opaque game snapshot, and clones it
into independent storage with new credentials. It is not a shipped game module.

## Browser evidence

Chromium was driven against loopback-only preview fixtures using synthetic game
data and isolated accounts:

- Factorio overview and world library at desktop and 390 px mobile width.
- Synthetic world creation under a remote host/server path, completion with the
  pathname intact, and a reload that returns to that server's world library.
- First-run navigation policy: Rust owners retain navigation; Factorio supports
  leaving its guide with Do this later and completing it without a reload.
- Rust sign-in, overview and shared restart confirmation; the dialog was cancelled.
- Fleet administrator sign-in/out, common navigation and game creation options.
  Switching to Rust supplies its memory/player defaults and world-size field from
  the module catalogue. No real server was created.
- Fleet read-only sign-in hides creation/removal/publication and account
  administration controls. Sign-in fields clear after authentication.

Screenshots and CLI snapshots are local ignored artifacts under
`output/playwright/`. These checks establish browser behavior for fixtures;
real game startup, container deployment, network reachability and restoration
into a running game remain separate acceptance steps.

## Compatibility boundary

Existing cookies, HTTP entry points, container/storage identities, account and
world paths, backup/snapshot formats, image contracts and historical import
exports are retained. No new persisted-state migration is introduced. Historical
image migration retains its existing built-in game scope and recovery behavior.

The existing single-owner trust model, JSON persistence and game-specific forms
remain. Multi-tenant hosting and a downloadable plugin system are outside this
change.
