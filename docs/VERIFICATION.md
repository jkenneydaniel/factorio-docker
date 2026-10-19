# Release verification

## v0.2.6-alpha: release preparation, October 19, 2026

- Packages the enemy-map fix and measured panel/image-source performance work
  described below. Panel versions, Compose defaults, build labels and release
  workflows are aligned to `0.2.6-alpha`. The game image selection and Factorio
  version remain unchanged; revision `2.0.77-fc.2` is source-only and unpublished.
- The release-version Node suite passed 137 tests with one Linux-only ownership
  check skipped on macOS. All 12 Python runtime tests passed, default Compose
  configuration validated, and both source/update bundles passed packaging checks.
  Hosted build/package results are verified separately during publication.
- Release preparation and publication do not deploy the panel, publish the game
  image, refresh an installed map or access existing worlds.

## Unreleased: enemies on saved maps, October 19, 2026

- Confirmed the previous exporter included spawners/worms but omitted enemy
  units. Its first-come 80,000-object cap could omit later bases after resources
  filled the array. The renderer gave zoomed-out bases only two-pixel markers.
  This source investigation did not inspect the user's active snapshot, so it
  does not establish which condition affected that particular map.
- Added enemy units, cap priority for enemies and additional priority for bases
  and worms over unit swarms. Kept the existing object/chunk/size limits and
  explored-area filter. Added red diamond/circle/dot markers above other objects,
  a minimum marker size, enemy inspection and saved-position guidance. Existing
  format-1 snapshots remain readable; new exports mark support for enemy units.
- Lua fixtures run the production scripts against charted/uncharted chunks,
  boundary overlap, neutral units, full resource/building/unit arrays and an
  all-base array. They verify deduplication, preservation priority and the hard
  cap. Node renderer tests verify marker geometry, draw order, selection above
  resources and the layer toggle. Lua fixtures require a local Lua interpreter;
  that test explicitly skips when the interpreter is unavailable.
- A disposable Factorio 2.0.77 container created a new world and five real enemy
  entities: biter/spitter spawners, a worm, a biter and a spitter. Production batch
  export retained all five both normally and with 80,000 prefilled resource
  entries. This runtime check used an explicitly queued fixture chunk; it did
  not claim that the generated world had player exploration. The chart filter
  is covered separately by the Lua fixture and is unchanged.
- The runtime report is under ignored
  `output/implementation/map-enemies/fc-map-enemies-2985143b-cea2-4e9b-b877-11cb9da4539c/`.
  The image was the existing owned `2.0.77-fc.1` through this Mac's amd64
  compatibility runtime. The report confirms private container/volume cleanup.
- Playwright checked a loopback-only synthetic panel fixture with no controller
  or Docker access, including an overlapping base/resource, marker pixels,
  checkbox removal, inspection and desktop/mobile screenshots. Evidence is in
  ignored `output/playwright/map-enemies/`. The only failed resource was the
  preview fixture's missing favicon; no application exception was observed.
- Full Node suite: 137 passed, one Linux-only ownership check skipped on macOS.
  No deployment, commit, publication, active-server commands, existing-world
  access or installed-map refresh was performed.

## Unreleased: normal-startup saving comparison, October 17, 2026

- Ran 12 disposable trials through the normal image entrypoints: three ordinary
  and three non-blocking-save trials each for Factory Control `2.0.77-fc.1` and
  Factorio Tools `2.0.77`, using the same generated save and identical RCON client.
- Each image completed nine ordinary saves and stayed responsive. Both images
  crashed in all three non-blocking-save trials after the first child save, with
  the same `poll failed: Interrupted system call` error and exit status 1.
- Confirmed identical Factorio executable hashes. Normal Factory Control ran
  Factorio as PID 1; Factorio Tools used its normal `runuser` wrapper. The failure
  is not unique to our image or dependent on the previous Python-parent layout.
- All runs used local amd64 images through OrbStack compatibility on this Mac.
  Native x86 behavior and the precise underlying cause remain unverified.
- Captured full trial logs, fixture/client hashes, state and cleanup in the
  [performance report](PERFORMANCE.md#normal-startup-saving-follow-up). All private
  containers and volumes were removed. No running server, installation data or
  existing worlds were accessed, and no runtime configuration was changed.

## Unreleased: isolated server performance, October 17, 2026

- Benchmarked the existing amd64 image with private generated data. The
  confirmation run and measurement limits are recorded in
  [PERFORMANCE.md](PERFORMANCE.md): ownership scans were 62.8% faster on the
  volume and 59.1% faster on the bind mount; warm status command cycles were
  49.4% shorter; lower-priority exports reduced game update time by 17.4% under
  forced CPU contention. These are component timings on this host, not live
  multiplayer or whole-application performance claims.
- Implemented the measured ownership, metadata cache and export-priority changes.
  Left storage and saving configuration unchanged. Non-blocking saves crashed
  the disposable parent process on this runtime; the completed child save did
  not establish a usable performance result.
- Built image revision `2.0.77-fc.2` locally and passed the full isolated container
  acceptance suite, including preservation of legacy fixture data, save/stop,
  old-binary reload, direct creation and PNG preview. Its local image ID is
  `sha256:ff99fd13512ae77fa88cb8bd0a5d455f6d2c6e124cf1139bc9dda3f0156174a6`.
- The full Node suite passed 135 tests with one Linux-only ownership check
  skipped on macOS. All 12 Python runtime tests passed. Controller integration
  verifies live player/time queries, cached seed/version and restart invalidation.
- All benchmark containers and volumes were removed. No installed stack,
  existing worlds, live-server commands, ARM tuning, publication or deployment
  were used. The new image revision and panel changes remain local.

## v0.2.5-alpha: world-creation preview performance, October 17, 2026

- Matched Factorio's preview generator to the existing one-CPU quota with
  `--threads 1`. Kept 1024 pixels, one meter per pixel, the installed image,
  isolated mod copy, network isolation, one-GB cap and render queue unchanged.
- Started the initial preview immediately; later edits still debounce for
  900 ms. Rendering polls now run every 250 ms; queued polls stay at 900 ms.
- Compared the existing default threading and one explicit thread using two
  disposable container runs each, with the same seed 123456789, default terrain,
  image 2.0.77-fc.1 and one-CPU cap on this ARM Mac's amd64 compatibility runtime.
  Average Factorio process time was 4.788 s versus 3.555 s
  (25.7% lower). All PNG SHA-256 hashes were identical. These are local
  unmodded measurements, excluding Docker launch/mod-copy/browser overhead, not
  a timing guarantee for another host or mod pack.
- A two-CPU/two-thread experiment averaged 2.496 s with identical PNGs;
  the product continues to use one CPU to retain its existing resource budget.
- In separate loopback-only browser fixtures with a synthetic 150 ms renderer,
  the initial POST arrived at 978 ms before and 73 ms after; image requests
  arrived at 2412 ms and 334 ms respectively. These verify browser waiting only,
  not the speed of real map generation. Fixtures had no Docker/controller access.
- The 23 focused preview/integration tests passed, including cache/queue behavior,
  account isolation, expiry, validation, unchanged save-library contents, no
  active-game Lua and worker cleanup. The helper regression assertions verify
  one thread, the original 1024 pixels, one CPU, one GB and no network.
- Release preparation passed the full local suite: 128 tests passed, with one
  Linux-only ownership check skipped on macOS. Default Compose validation and
  source packaging passed; 112 allowlisted files were included without runtime data.
- No running server, existing worlds, deployment or image publication was used.


## v0.2.4-alpha: first-install acceptance checks

- Setup now verifies a parseable system CA bundle and functioning Docker, Compose
  and Buildx clients before creating private installation data. These checks run
  without network or a Docker socket; unit tests cover absent/corrupt bundles and
  missing plugins with actionable setup failures.
- Built a separate image and packaged 100 allowlisted source files. The image
  smoke test validates the actual ZIP/checksum/installer metadata, compares its
  application files to the image, performs first-time setup, then reruns setup.
  Configuration, account state, controller credentials and the original invitation
  stayed byte-for-byte unchanged. The source baseline verified and no world or game
  container was created.
- Injected an empty CA bundle into the otherwise working image. The real setup
  command refused it before writing any installation directory.
- 123 application tests passed in isolated Linux fixtures. The running game and
  panel services were not replaced for these acceptance checks.
- Both CI and release packaging now include the smoke test; release packaging
  also repeats the fresh-registry/restricted-build check before attaching ZIPs.
  These workflow additions are locally verified and await a GitHub run. They
  protect new installers once included in a newly published release.

## v0.2.4-alpha: updater build certificates and diagnostics

- Docker Desktop's retained engine logs identified the failed v0.2.1-to-v0.2.3
  build: Docker Hub token requests failed with an unknown certificate authority.
  The released panel image had no `/etc/ssl/certs/ca-certificates.crt`.
- A fresh `docker manifest inspect` reproduced the TLS failure from the released
  image. The fixed image includes the Docker CLI stage's 181,724-byte CA bundle;
  the same request succeeds with certificate verification enabled.
- A real `docker build --pull` succeeded through the Docker socket using the
  worker's read-only root, dropped capabilities, restricted additions, memory
  limit and temporary filesystem. A normal cached build also succeeded without
  the fix, confirming that cached metadata alone is not a useful TLS check.
- 120 application tests passed in an isolated Linux container, including new
  timeout, output-limit, redaction and persisted-build-failure regressions.
  Windows host-launcher checks passed separately (5 passed, 1 Linux-only skip).
  The fixture suite uses no production Docker socket, saves or accounts.
- CI now repeats a fresh registry request and nested build from the restricted
  image. This new CI step is locally verified; it has not run on GitHub yet.
- The local fixed panel/controller image was deployed after a verified world
  backup. Both services became healthy; the Factorio container was not replaced
  or restarted. This local fix has not been published as a new GitHub release.

## v0.2.3-alpha: manual release checks

- Reproduced the missing review action on a panel with a cached current-release
  result. Verified that the released 0.2.1-alpha checker detects 0.2.2-alpha on a
  fresh public GitHub request; automatic results remain cached for six hours.
- In an isolated loopback preview with installation disabled and no Docker
  access, Check for updates fetched the published release and revealed Review
  panel update without navigation. Opened and cancelled both the panel review
  and the same-version Factory Control image review; no install jobs were made.
- Retrieved the published 2.0.77-fc.1 image manifest/configuration anonymously and
  validated its amd64 metadata with the panel compatibility validator. No image
  was pulled or installed, and no game binary was started.
- Regression coverage checks manual-cache bypass, one-minute limiting, request
  coalescing, disabled checks, administrator/CSRF requirements and a stale
  controller cache during panel review.


## v0.2.2-alpha release compatibility follow-up

The initial hosted image check found that the Linux runner's classic Docker CLI
has no `image inspect --platform` option. Inspection now accepts an already
resolved amd64 configuration from the normal inspect result, requesting explicit
platform selection only for multi-platform/index results. The panel continues to
reject mismatched architecture, compatibility metadata and missing registry digests.

Classic stores also omit registry digests for an unpublished local build. The
image acceptance runner validates that build's metadata and probes its immutable
local ID; this exception is confined to build-time testing. Installing through the
panel always requires a verified repository digest. Regression tests cover both
store types and the existing rejection cases. The complete local Node suite
passed 120 of 121 tests with one platform-specific skip, and the revised real
container acceptance sequence passed again with disposable resources.

## v0.2.4-alpha: isolated image build and container acceptance, October 16, 2026

Built `ghcr.io/jkenneydaniel/factorio-server:2.0.77-fc.1` locally with OrbStack
on an ARM Mac, targeting `linux/amd64` and executing with x86 compatibility.
The local repository digest is
`sha256:c8056ca33a857406bd1f75521f237782faa810f4bf76e05d21d4d827e0dba990`;
the amd64 manifest is
`sha256:2d6a54133f18cd864bacbc56ffe052e141fab7dbac81660151d7692e3f43bcfb`.
The Docker build verified the official archive checksum and the actual binary's
2.0.77 version. No Factorio Tools layer was used to build the owned image.

Real container acceptance passed:

- Both image sources passed the panel's shared read-only, unprivileged binary
  and tool preflight using verified repository digest references.
- A save created by the legacy image loaded in the owned image, exposed RCON
  and returned the expected version and a numeric game tick.
- RCON save and SIGTERM shutdown completed with exit code zero. Settings, mod
  selections and the RCON password retained their original SHA-256 checksums.
- The legacy binary reloaded the save written by the owned image successfully.
- Direct worker-style world creation produced a valid ZIP with `level.dat0`,
  and map generation produced a verified 128 × 128 PNG.

The real run identified and fixed explicit platform selection during image
inspection, the plain RCON version response and use of a runnable repository
digest instead of a platform-specific inspect identifier. Regression coverage
also reflects the fresh-save Lua achievement prompt and actual save format.
The full Node suite passed **119 of 120 tests with one platform-specific skip**;
all **10 Python tests** passed. After the final preflight integration, all 21
affected image/update tests and the real acceptance sequence passed again.

Only UUID-named test resources and disposable data were used. There were no host
bind mounts, published ports, Compose operations or container network access.
All test containers and volumes were removed; all 13 pre-existing local
containers retained their identities, images, start times and running states.
The running Factorio installation, existing worlds and installation `.env` were
not accessed. Local logs and image/cleanup evidence are retained under
`output/implementation/game-images/container-acceptance.{log,json}`.

The image remains local and unpublished. No deployment or live image migration
was performed. This run does not establish native ARM support or acceptance on
an independent x86 Linux host.

## v0.2.4-alpha: independent Factorio image and image-source selection

Validated locally on macOS with Node 24.21.0 and Python 3.14.5: **119 Node
tests, 118 passed and one Linux-root ownership test skipped; 10 Python tests
passed**. Tests use temporary files, simulated Docker calls and fake RCON
sockets. They cover same-version source changes, pinned image identities,
architecture and compatibility rejection, recovery, existing settings/save
preservation, fresh-install behavior and multipart RCON responses.

The official 2.0.77 headless archive checksum and Debian amd64 base digest were
verified against their public sources. The owned image uses these directly and
does not derive from Factorio Tools. It targets Linux x86-64 only.

A temporary release package was accepted by the existing HEAD updater using the
compatibility ZIP, and by the new updater using the complete source ZIP. Panel
update tests also passed from the extracted compatibility package. Packaging did
not include private/runtime data or change existing release artifacts.

Browser acceptance used only the synthetic loopback fixture on port 8097:
selected the owned source, reviewed its exact same-version image tag, cancelled
the review, checked downgrade rejection and inspected desktop and 390 × 844
phone layouts. Screenshots are under `output/implementation/game-images/`.

At this initial implementation stage, the separate image workflow was prepared
to build and test disposable volumes,
legacy-save loading, RCON, graceful save/stop, legacy reload, world creation and
map preview before optional publication. The subsequent Docker build and container
acceptance are recorded above. Nothing was published or deployed; during this
initial implementation stage the
real Docker socket, running server, worlds, settings and installation `.env`
were not accessed or changed.

## v0.2.4-alpha: configurable backup cleanup

Validated locally on macOS with Node 24.21.0: **106 tests, 105 passed and one
Linux-root ownership test skipped**. Cleanup tests use temporary archives;
integration tests use a mock Docker API and confirm cleanup sends zero Docker
mutations while preserving the original save and running-state fixture.

Coverage includes bounded age windows, cutoff equality, category opt-in, newest
copies, current verified archives, pending update recovery, unknown archives,
symlinks, file replacement, expired/replayed reviews, partial deletion failures,
policy persistence, concurrent settings revisions and the daily due clock.
Scheduled count pruning now shares the same protections and operation lock.

Browser acceptance used only the loopback fixture on port 8096: reviewed exact
candidates and protected reasons, changed the window to an empty review, opted
manual/pre-change copies in, confirmed a simulated daily policy, saved a manual
window using Enter, reloaded it, and completed a memory-only cleanup from 16 to
7 synthetic archives. Reviewed the default desktop viewport and 390 × 844 phone
layout, including 44px checkbox-label targets and no page overflow. Screenshots
are under `output/implementation/backup-retention/` (local evidence only).

No real backups, running server, world saves, Docker socket or deployed panel
were accessed or changed. Automatic cleanup remains off by default. This is
local implementation and isolated validation, not deployment or live acceptance.

## v0.2.4-alpha: guided diagnostics, saved presets and persistent drafts

Validated locally with Node 24.21.0 on macOS. The complete suite has **92 tests:
91 passed, one Linux-root ownership test skipped**. New coverage exercises:

- Authenticated diagnostics with an unreachable controller; partial Docker,
  storage, architecture and readiness failures; Windows-container guidance.
- Read-only probes and a report allowlist excluding raw Docker details, error
  messages, paths and credentials.
- Private per-account setup persistence across restarts/password changes and
  cleanup on account deletion; administrator-only API access and CSRF checks.
- Revision conflicts, stale draft deletion, preset limits/validation and exact
  preservation of unfinished input without restoring activation.

Browser acceptance used only the synthetic loopback UI fixture. Confirmed preset
save/load, draft recovery of unfinished JSON after reload, blocked review before
applying it, cross-tab conflict rejection, switching unchecked after reload,
simulated successful creation clearing its submitted draft, and support-report
JSON download. Reviewed desktop (1486 × 1059) and phone (390 × 844) layouts.
Screenshots are under `output/implementation/diagnostics-presets/` (local evidence,
not included in releases). Fixture map artwork is synthetic.

No real Docker socket, running game, world save, live account or deployed panel
was accessed or changed for this feature work. This records local implementation
and isolated validation, not deployment or live server acceptance.

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
