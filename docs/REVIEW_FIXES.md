# October 2026 review fixes

Validated against main commit `0255a690225105344726b9e80a61e689cdef7dd2`.
The existing Factorio development checkout was left untouched; this work uses an
independent clone and the `fix/review-regressions` branch.

## Backup download streaming

[PR #1 finding](https://github.com/jkenneydaniel/lobby-goblin/pull/1#discussion_r4331830886)
was reproduced with a real Rust module archive and an authenticated web download,
throttled on loopback. Before the fix the response ended at approximately 30
seconds and the received SHA-256 differed from the archive. After the fix the
same test transferred the full archive in 31 seconds, matched SHA-256, and passed
Rust archive verification, including all five identity files.

Both the shared web proxy and the additional host-manager proxy now use a
30-second deadline for response headers and each pending download read. Progress
renews that deadline; client backpressure pauses reads. Other API requests keep
their total deadlines. Client cancellation aborts the upstream request, and an
upstream failure destroys an incomplete response rather than returning clean EOF.
Separate loopback tests cover stalled headers/bodies, cancellation, upstream
failure and the distinction between download and ordinary API deadlines.

## Image CI and first-world generation

Both push and pull-request filters now watch the relocated Factorio update worker,
with a regression check for both filters. See the
[PR #1 CI finding](https://github.com/jkenneydaniel/lobby-goblin/pull/1#discussion_r4331830889).

The [PR #2 retry finding](https://github.com/jkenneydaniel/lobby-goblin/pull/2#discussion_r4331851876)
was reproduced by running startup preparation twice with generation disabled and
no completed save. The image source now records first-world intent before
creating the RCON password, retains that intent across failures, creates a
`.tmp.zip`, and publishes the save without overwriting any existing destination.
Successful generation retires the marker. Existing passwords/settings remain
unchanged. Established identities and unmarked identities with missing saves
still refuse replacement-world generation. Tests also cover partial saves,
interrupted publication, conflicting destinations and unsafe temporary paths.

This is a source fix for the currently unpublished `2.0.77-fc.2` image. It does not
change the published `fc.1` image, the fleet catalog's pinned image digest, or
repair an already interrupted installation without a marker. A separately
approved image build, real Factorio acceptance, publication and adoption are
needed before installed servers receive this image behavior.

## Fleet release-test failure

The [v0.3.0-alpha failure](https://github.com/jkenneydaniel/lobby-goblin/actions/runs/39523195813/job/118971687286)
observed `running` where the fixture expected `succeeded` after only 100 five-ms
polls. The failing test took 716 ms. This is consistent with a fixture deadline
under load, despite the earlier successful runs on the same commit.

The fixture now waits for terminal state, operation-lock release and final
registry persistence. It exercises the real `FleetManager.request` HTTP and
ownership path against a loopback child controller instead of replacing that
method with an immediately resolved promise. A controlled handoff remains held
for 650 ms, verifies the job remains active and rejects overlapping creation,
then verifies success and persisted state after the child accepts the start job.
A child's accepted start job can still be `running`: host creation records the
completed handoff, while actual game readiness remains the child controller's job.
No production operation semantics were relaxed. macOS fixture temporary paths
are canonicalized before the existing storage-link guard.

## Local verification

Using Node.js 24.21.0, locked `ws` dependency, Python 3 and disposable storage:

- `node --test panel/test/*.test.js`: 176 tests, 175 passed, zero failures,
  one skipped (Linux-only file-ownership check on macOS).
- `python3 -B factorio-image/test_runtime.py`: 18 passed.
- `node --test factorio-image/test-build.mjs`: four passed.
- `node tools/release.mjs`: source/update packages and manifests generated;
  runtime data excluded.
- `git diff --check`: passed.

No real Docker engine, production server, release, deployment, or existing world
was modified. The Python generation tests use temporary files and a simulated
Factorio subprocess. Real Factorio image acceptance remains a CI/build check,
not a local result claimed here.
