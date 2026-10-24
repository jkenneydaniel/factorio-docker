# Frontend consolidation and static quality

Source-only work on `codex/panel-product-foundation`, following the uncommitted
browser/recovery/contract changes described in [the previous report](browser-recovery-contracts.md).
The foundation commit remains `3b484c5`. Nothing was committed, pushed, published,
installed or deployed. Existing installation configuration, running servers and
worlds were not accessed or changed.

## Implementation

- Fleet, Factorio and Rust use one session owner and account workflow: password
  confirmation/renewal, current-session CSRF, session management, invitations and
  account administration. Invitation links retain explicit local/remote server
  scope. Navigation/session loss disposes obsolete account/backup loads.
- Both games use the shared archive, verification/download, schedule and retention
  workflow. Factorio retains restore; Rust retains explicit downtime consent and
  preserves unsaved schedules when an operation completes. Busy/recovery state
  updates shared controls without replacing drafts.
- Factorio rendering is split into overview, worlds, map, players/activity and
  settings/update view modules with explicit state/helper inputs. Rust mod tools,
  fleet server creation and host-budget drafts have separate feature owners.
  Entry points retain navigation and game-specific orchestration.
- Browser operation coordination is shared by both game panels. Completion waits
  for lock release; stale reads after session reset cannot repopulate operation
  state. Recovery review refreshes Factorio controls immediately. No browser
  controller replays work.
- Served paths match physical imports through small compatibility entrypoints.
  Existing public URLs, cookies, API routes, persisted state, backup formats,
  environment configuration and installed identities are preserved. No game
  image or deployment configuration changed.
- Frontend JavaScript and CSS now have a consistent readable formatting baseline.
  Shared workflow styles avoid inherited checkbox layout and duplicate headings.
  Direct navigation to Factorio Accounts also works before game status is loaded.

## Quality gates

The separate `panel/quality` package pins its developer dependencies and leaves
production dependencies unchanged. CI requires it before the build job, and the
runtime-image workflow requires it before building or publishing.

The gate checks first-party JavaScript with ESLint and zero warnings, frontend
and quality-tool formatting, strict shared session/operation/view contracts, and
served imports across standalone, local-server and remote-host URL scopes.
Frozen historical updater fixtures remain immutable. Type contracts and negative
probes use JSDoc `.js` files, retaining older source/archive allowlists.
This is bounded type coverage of the shared model, not full-application typing.

## Local evidence

Validated on macOS with Node **24.19.0**:

```sh
npm run quality --prefix panel
npm test --prefix panel
npm run test:browser --prefix panel
```

- Quality gate passed: lint, formatting, strict contracts, two import-checker
  self-tests and **56 served JavaScript module mappings** across the three scopes.
- Application suite: **373 tests; 372 passed, 0 failed, 1 skipped**. The skipped
  service-UID ownership check requires Linux. Shared-model tests cover delayed
  bootstrap, password renewal, recovery blocking, lock-release waiting, duplicate
  submissions, stale responses, retry after transport failure and reentrant
  completion callbacks.
- Chromium: **58 passed** across desktop and 390 px mobile layouts. Added coverage
  exercises all three account panels, scoped invitations, password mismatch and
  renewed CSRF, both backup schedules, Rust interruption cancellation, backup
  draft preservation, extracted game views/mod restrictions, host-budget drafts,
  invitation bootstrap and delayed successful/failed authentication.
- Desktop/mobile account and backup screenshots were inspected. Screens are
  checked for horizontal overflow. Local reports/screenshots are under
  `output/playwright/`; CI retains failure traces/screenshots.
- Release compatibility checks package a disposable source copy, exercise both
  frozen updater validators and current source-bundle unpacking, and assert the
  new frontend and developer tooling are included. Prepare-only setup still
  preserves existing fixture configuration and creates no world.

Browser tests use only disposable loopback fixtures, synthetic accounts and fake
Docker/game transports. External browser requests are blocked; existing listeners
are never reused. No real Docker engine, installed state, server or world was
used. These results do not establish a hosted CI run, real-game acceptance or an
installation upgrade.

## Remaining product work

Permissions, audit history and application isolation were subsequently addressed
in [the next source-only stage](access-audit-isolation.md). Hostile-tenant hosting,
multi-replica persistence and complete TypeScript coverage remain outside these
checks. Commit and publication remain deferred.
