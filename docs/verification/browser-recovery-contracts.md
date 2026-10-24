# Browser regression, operation recovery and module contracts

Local source work on `codex/panel-product-foundation`, following the product
foundation commit `3b484c5`. These changes are uncommitted. No release, installation
upgrade, container deployment, live game command or existing-world access was done.

## Implemented

1. Automated Chromium regression coverage runs at desktop and 390 px mobile
   widths. It exercises scoped world creation/completion/reload, setup
   completion/deferral, delayed authentication, creation defaults, viewer
   permissions, session expiry, cancelled interruption, and recovery review.
   CI runs the same isolated fixtures and retains failure traces/screenshots.
2. A shared operation coordinator persists reservations, explicit stages and
   final outcomes; keeps locks through cleanup; deduplicates request IDs; and
   records recovery requirements when completion or cleanup cannot be proven.
   Duplicate callers wait for the initial reservation write rather than receiving
   acceptance before it is saved. Host jobs record target server/snapshot and
   child-operation identities without copying credentials into operation history.
3. Restart recovery performs explicit outcome inspection. Ready/stopped lifecycle
   states and verified host resources/snapshots can establish completion. Unknown
   outcomes remain interrupted until reviewed. Start/stop may be explicitly
   retried after inspection; duplicate retry responses return the existing job.
   Recovery controls are shared by fleet, Factorio and Rust. Normal operation
   controls are disabled while review is required and become available afterwards.
4. Both game modules declare checked version 1 capabilities, actions,
   confirmations, retry policy, endpoint methods/roles and backup strategy.
   Registration, configuration, lifecycle hooks, backup adapters and updater
   interfaces are validated. Web, controller and remote route exposure share
   endpoint policy. `/capabilities` and an additive `/status` summary give generic
   consumers consistent metadata and nullable player counts.

## Automated evidence

Validated locally with Node **24.19.0** on macOS:

```sh
npm test --prefix panel
npm run test:browser --prefix panel
```

- Node suite: **372 tests, 371 passed, 0 failed, 1 skipped**. The skipped test
  checks Linux service UID ownership.
- Browser suite: **20 passed**, covering desktop and mobile. Rust recovery uses
  the real web/controller/auth/journal stack with synthetic game transports.
  Factorio's additional recovery test exercises its real UI against isolated
  response fixtures, including immediate restoration of page controls.
- Operation tests cover reservation failures, concurrent duplicates, changed
  request rejection, cleanup/completion-write failures, restart loading, reviewed
  retry and uncertain outcomes. Host reconciliation asserts read-only Docker
  calls and retained volumes. A Rust stop retry executes once even when its
  accepted request is submitted again.
- Module conformance tests instantiate both real adapters without contacting
  Docker or a game. Existing fixture/HTTP, updater, archive and release bundle
  checks also pass; both frozen updater validators accept the source layout.

Browser fixtures bind only to loopback and never reuse an existing listener.
They use synthetic accounts and temporary storage. The browser blocks external
requests; recovery fixtures reject host mutations. Desktop/mobile recovery
screenshots and the local HTML report are under `output/playwright/`.

## Compatibility and remaining scope

Existing routes, cookies, environment keys, state locations, registry version,
container identities, ownership checks, backup/snapshot formats and game images
are retained. New journal fields and status summaries are additive. Existing
completed jobs remain readable; unfinished jobs gain a review requirement.
Requests without an operation ID remain accepted. No production dependency was
added: Playwright has a separate test-only package and lockfile.

The coordinator remains a single-process JSON design. Request deduplication is
bounded by retained history; it does not promise power-loss durability or
multi-replica execution. Startup never replays general operations. Update,
image-migration and mod transactions retain their existing specialized journals.
Real game/container acceptance and installation upgrades still require a
disposable installation; fixture/browser success is not that evidence.

Frontend decomposition, shared account/backup workflows and static quality gates
were subsequently addressed in [frontend consolidation and quality evidence](frontend-quality.md).
Permissions, audit history and application isolation were subsequently addressed
in [the access and isolation stage](access-audit-isolation.md); hostile-tenant
hosting remains outside its guarantees. There is no new commit, push,
pull request, release or deployment in this stage.
