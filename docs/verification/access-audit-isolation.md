# Permissions, audit history and application isolation

Source-only continuation on `codex/panel-product-foundation`, based on `3b484c5`.
All changes remain uncommitted, including the preceding modularity, browser,
recovery and frontend-quality work. No deployment, running server, installed
configuration or existing world was used or changed.

## Implemented

- Add an assigned-server account role without changing existing administrator or
  read-only access. Exact standalone/local/remote assignments grant individual
  tools. Members see only assigned servers; unauthorized resources are rejected
  before backend lookup. Account editing checks revisions, invalidates sessions,
  preserves the last administrator and clears old grants on role transitions.
- Connect navigation and controls to settings, worlds/map, players, console,
  backups, logs and lifecycle capabilities. Mods and game-image changes require
  separate explicit grants, as requested. Provider credentials, panel/agent
  software, hosts, snapshots and account administration stay administrator-only.
  Game-only update context is propagated through local and remote transports;
  installation checks the saved plan kind before any backup or worker effect.
- Add one shared Accounts permission editor, including revocation of unavailable
  server assignments, and paginated/filterable audit history. Private audit
  stores persist requests/access deltas and operation/recovery outcomes outside
  the short job list. Write failures before submission prevent effects; uncertain
  completion remains visible for review without automatic replay.
- Restrict remote/controller endpoints by game and HTTP method. Tighten managed
  Docker requests, immutable target IDs, image ownership, exec options, worker
  host/mount options and preview process/resource limits. Keep existing storage,
  image, route and installation contracts.

The [access contract](../ACCESS.md) documents the permission catalogue, audit
schema/retention, compatibility and remaining trust boundaries. Existing panels
are not automatically converted or upgraded.

## Local validation

Validation uses Node 24 on macOS. Test commands:

```sh
npm run quality --prefix panel
npm test --prefix panel
npm run test:browser --prefix panel
```

- Application suite: **390 tests; 389 passed, 0 failed, 1 skipped**. The skip is
  the Linux-only service-UID ownership check on macOS.
- Static gates passed: zero-warning lint, formatting, strict shared contracts,
  two import-checker self-tests and **65 served module mappings** across
  standalone, local-server and remote-host scopes.
- Chromium: **70 passed** across desktop and 390 px mobile layouts. Focused
  administrator screen capture checks also passed on both layouts.
- New transport and access-delta probes confirm that game-only restrictions
  survive the paired-host agent path and audit can retain a complete change
  between two disjoint sets of 64 assignments.
- Existing historical update-bundle validators and disposable prepare-only
  installation checks passed. `git diff --check` passed. The base commit and
  original checkout remain unchanged; no files were staged or committed.

Focused HTTP regressions exercise scope isolation across hosts, no backend calls
for foreign assignments, actor spoof rejection, immediate reauthentication after
grant changes, independent mods/image permissions, and audit failure before or
after a submission. Saved panel plans cannot be relabelled by a game-only caller.
Audit tests cover concurrent append ordering, restart, retention anchors,
pagination, secret exclusion, restrictive permissions and integrity failure.
Isolation tests reject method confusion, arbitrary images, privileged exec,
host namespaces/devices/socket binds, extra networks and volume-driver options.
Existing updater/package tests retain historical release and prepare-only checks.
Permission/audit screenshots were inspected for layout and horizontal overflow.

Browser acceptance includes administrator permission changes and audit review,
minimal delegated fleet views, scoped server access, own-account sessions,
Factorio image/mod presentation, Rust mod-only access, restricted backups and
accounts awaiting their first assignment on
desktop and 390 px mobile. Screenshots/reports remain local under
`output/playwright/`; failure traces are retained by the test runner.

## Evidence boundary and remaining work

All tests use temporary files, loopback servers and synthetic Docker/RCON/game
responses. Browser fixtures refuse real sockets and block external browser
requests. Source release packaging occurs only inside a disposable copy. No real
Docker engine, server process or existing world was accessed.

This establishes application permission/fencing and local regression evidence.
It does not establish an installed upgrade, hosted CI, real-game acceptance,
independent security audit or adversarial disposable-host acceptance. Controllers
still have the Docker socket; a compromised controller can bypass application
checks. Executable code still shares the host kernel. Mutually hostile customers
need a separately reviewed host/VM and socket-broker boundary. JSON persistence
remains single-process without fsync or multi-replica coordination; audit is
bounded and chained, not tamper-proof or externally anchored. Central cross-host
audit aggregation and real-game recovery acceptance remain future work.

Commit, push, pull request, publication and deployment remain deferred.

The subsequent [Docker broker stage](docker-broker.md) addresses direct daemon
access in new managed definitions while preserving legacy installations and the
host/kernel evidence limits above.
