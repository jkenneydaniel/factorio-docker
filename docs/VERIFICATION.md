# Release verification

## CI follow-up: wait for completed jobs to release their operation lock

The first v0.2.1-alpha tag CI run failed when the integration fixture submitted
restore and console actions while the controller was still finishing a prior
job. `setJob` exposes the terminal result before its asynchronous persistence
finishes; the operation lock is released in `finally`. The fixture incorrectly
treated the terminal result alone as permission to submit its next operation.
The controller's HTTP 409 refusal during this interval is expected serialization.

Sequential fixture actions now require both a terminal result and an idle
controller. Requests still assert HTTP 202 immediately; the fixture does not retry
rejected mutations or relax controller protections. Three deterministic tests
cover terminal-state persistence, another active operation, failure completion
and bounded timeout. All three fail with the original terminal-only predicate.

On macOS with Node 24.21.0, the full suite passed 81 tests with one Linux-only
ownership skip (82 total), and 20 consecutive integration runs passed. All
operations used temporary files and simulated Docker. The original tag CI rerun
also passed. That rerun uses the original tagged source; it confirms the earlier
failure was intermittent, while the durable fixture fix lives in the subsequent
main-branch commit. The published tag and release assets were not changed, and
no running server, container or save was touched.

## v0.2.1-alpha: combined release and controller CPU fix

On October 16, 2026, the published v0.2.0-alpha source was merged with the local
controller improvement. All 79 tests passed in Node 24 Docker as root, including
the Linux ownership test, host-launcher simulations, updater recovery, automatic
save-triggered map refresh and the three snapshot-metadata regression tests.

The cache parses the map only when its file identity, size or timestamps change.
It retains only world, source version and creation time, and also serves the
lightweight map-status endpoint. Tests cover concurrent readers, equal-size file
replacement, replacement during parsing, deletion/recreation, invalid JSON and
filesystem errors. Automatic refresh after completed saves remains enabled.

The original controller investigation used a 23 MB saved-map snapshot. Matched
20-second samples fell from 10.8% average controller CPU to 1.5% after applying
the local fix (about 86% lower in that sample). This is a short local measurement,
not a performance guarantee for other worlds or hosts.

Both default and private local Compose configurations validated. The combined
alpha image was built separately; no running game or panel service was replaced
during this merge/release preparation. The local controller image override stays
private, and the source ZIP includes the cache implementation and its tests.

## Local follow-up: host setup, in-panel updates and panel redesign

The v0.2.0-alpha changes were checked on an Apple Silicon Mac using
Node 24.21.0. No Docker container was started, rebuilt or replaced for this work.

- 75 automated checks passed; one root-only Linux ownership check was skipped.
  Host launchers use a simulated Docker executable, covering prepare-only,
  explicit start, import paths with spaces, configuration preservation, native
  Linux socket-group selection, remote/rootless rejection and failure handling.
- Mock Docker integration checks assert amd64 platform selection and reuse of the
  installed game image ID for generation/preview helpers. Existing world/map,
  authentication, backup/restore and recovery checks also pass.
- Release-check tests cover semantic/prerelease ordering, stable/preview channels,
  request coalescing, six-hour caching, ETags, offline/rate-limit behavior and
  administrator-only access. Install endpoints require a reviewed plan, explicit
  confirmation, same-origin/CSRF checks and administrator access.
- Temporary installation fixtures exercise staged source installation, local-edit
  refusal, ZIP/checksum/state-contract rejection, backup failure, expired reviews,
  detached-worker launch, panel recovery after failed health checks, pinned amd64
  game upgrades, failed downloads, game readiness failure and explicit restore
  handling. Docker/Compose calls are simulated; these are not live lifecycle tests.
- A read-only public GitHub query through the new checker identified the current
  repository release as v0.1.0-alpha. It downloaded no release assets.
- Compose configuration and shell syntax validated. An isolated browser fixture
  demonstrated update controls and a game-upgrade review using synthetic versions.
  The review was cancelled; the fixture rejects every installation request and
  has no Docker socket or real account/save access.
- The Dockerfile now includes the official Docker CLI/Compose/Buildx for update
  workers. This revised image has not been built or run locally. Release metadata
  is included in the source package; hosted build results are recorded on GitHub.
- Mac/Linux/Windows host-launcher CI jobs exercise simulated Docker only.
  PowerShell execution, independent Linux hosts and game emulation on ARM were
  not validated locally. Configuration support is not runtime proof.

- The release ZIP preserves executable Unix launcher permissions, including the
  Mac Finder shortcut. A regression checks the ZIP metadata.
- Onboarding tests cover owner-only first-run state, legacy-account behavior,
  restart persistence, admin/CSRF checks, readiness rejection and persisted
  completion after a confirmed save. Finishing a job clears cached status so
  first-save readiness appears immediately.
- Browser acceptance used loopback-only synthetic fixtures without Docker access.
  Checked every main route at desktop and phone widths, creation at 1024 × 768,
  tab keyboard navigation, hidden-field validation, retained edits, changed-setting
  review, simulated library creation, waiting/ready onboarding and completion,
  registration layout, read-only controls and update review/cancellation.
- Desktop references and actual browser captures were compared for typography,
  spacing, colors, icons, copy and responsive behavior. Captures are local review
  assets under `output/implementation/`; root `design-qa.md` records the comparison.
  Synthetic map imagery is not a real seed render. No real world was created or
  switched and no update was installed. Main-preview console warnings/errors were
  empty at the final browser check.

## Original alpha checks

Verified on Windows Docker Desktop with Linux containers on October 15, 2026.
The release was prepared alongside an existing installation without deploying
to it. The original game, controller and web containers retained their start times.

- 51 automated tests passed in Node 24 Docker, including authentication,
  invitations, role restrictions, CSRF/origin checks, ZIP validation, backup/restore,
  failed world-switch rollback, maps, preview scheduling and world constraints.
- Setup tests cover fresh installation, idempotence, recovery, save import,
  corrupted imports, existing-world protection, incomplete state and symlink
  refusal. A root-run Linux container test verifies new file UIDs and secret modes.
- Both default and existing local Compose configurations validated. The alpha
  image built separately from the running installation's image.
- A disposable Compose stack used independent data, unique names and loopback
  ports. Fresh game generation, web health, private registration, recovery and
  consumed-link rejection succeeded.
- The disposable stack rendered a real Factorio terrain PNG and generated a
  custom world from the compact preset with engine-supplied advanced defaults.
  Its active world was preserved.
- Import copied that disposable world's ZIP byte-for-byte. A network-isolated
  game container loaded the imported world and reported the expected seed.
- The source packager excludes runtime/private data and emits a source directory,
  ZIP, SHA-256 checksum and per-file manifest. Publication safeguards were checked
  against a deliberately invalid fixture before final packaging.

The temporary game/management containers were removed afterward. These checks
do not verify an independent Linux host, ARM, rootless Docker, Internet hosting,
GitHub-hosted workflow execution or an independent security audit. No real user
save or account is included in a test fixture or source artifact.
