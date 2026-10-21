# Isolated server performance measurements

Measured October 17, 2026. These experiments used generated data, private
containers and private volumes. They did not use the installed stack, existing
worlds or credentials. No deployment or publication was performed.

## Results and implementation

Values below are medians. Percentages describe the measured component, not
whole-server startup, full HTTP response time or observed multiplayer UPS.

| Candidate | Before | After | Result |
| --- | ---: | ---: | --- |
| Ownership scan, 10,000 files on a volume | 128.2 ms | 47.7 ms | 62.8% lower; implemented |
| Ownership scan, same layout on a host bind | 169.9 ms | 69.5 ms | 59.1% lower; implemented |
| Status commands with warm metadata | 1,041.6 ms, four commands | 526.8 ms, two commands | 49.4% lower command-cycle time; implemented |
| Game update with a competing export helper | 2.272 ms | 1.876 ms | 17.4% lower update time under forced contention; implemented |

Ownership checks now visit overlapping data trees once instead of revisiting
their entries. Both scans checked ownership without needing changes in this
fixture: path visits fell from 20,016 to 10,006. Every entry is still checked;
this does not trust a directory's owner as proof of its descendants' ownership.
Custom paths remain covered, symlink targets are not recursively followed, and
only mismatched ownership is changed. Content and permissions remain intact.
The absolute saving here is roughly 80–100 ms; larger trees need their own
measurements before predicting a whole-boot improvement.

The controller caches seed and version for 30 seconds. Player counts and
playtime still refresh with each new status sample. Container identity, image,
process start and world scope the cache; operations, errors and stopped state
invalidate it. Concurrent metadata requests share one query, failed requests
are retried, and late responses cannot replace a newer cache generation. The
existing three-second whole-status cache is unchanged.

Map export helpers now request CPU shares of 128 instead of the default 1024.
This prioritizes the active game when CPU is contested while allowing the helper
to use idle CPU. The helper retains its memory cap and receives no hard CPU
quota. Game-alone median update time was 1.686 ms. Export work became slower
under contention: the first completed export took approximately 2.49–2.54 s at
default priority and 3.72–4.25 s at lower priority. The setting applies to map
exports, including automatic exports; world-creation preview limits are unchanged.

## Candidates left unchanged

**Storage:** Creating 10,000 small files took 0.231 s on the Docker volume and
1.739 s on the host bind mount. However, three 16-MiB write-and-fsync trials had
medians of 23.6 ms and 18.8 ms respectively. This supports a metadata cost on
this host, not a general save-throughput advantage. No storage migration was
implemented. Real save serialization and Windows/WSL storage need separate tests.

**Non-blocking saves:** Ordinary saves completed three times (median 98.6 ms).
With non-blocking saving enabled, the first child save completed, but the parent
Factorio process crashed with `poll failed: Interrupted system call`, followed by
RCON resets and exit status 1. The failure reproduced in another disposable run.
This rejects the candidate for this runtime; it does not establish the same
failure on native x86 Linux. Existing save behavior remains unchanged.

No ARM image, emulator tuning, game version change, new allocator, networking
change or persistent RCON connection was introduced.

## Normal-startup saving follow-up

On October 17, 2026, a second experiment compared normal startup in the existing
Lobby Goblin `2.0.77-fc.1` image and Factorio Tools `2.0.77`. Both images were
already cached; nothing was pulled, built, published or installed. This test
used the same OrbStack amd64 compatibility runtime as the earlier benchmark.

| Image | Ordinary saving | Non-blocking saving |
| --- | --- | --- |
| Lobby Goblin `2.0.77-fc.1` | 9/9 saves completed; all three servers remained responsive | All three fresh trials crashed after their first child save |
| Factorio Tools `2.0.77` | 9/9 saves completed; all three servers remained responsive | All three fresh trials crashed after their first child save |

All six background-save failures reported `poll failed: Interrupted system call`
inside Factorio's networking/RCON code and container exit status 1, without an
OOM kill. A completed child save was not treated as success: the test required
continued RCON responsiveness after the saves. Ordinary trials remained alive
through the post-save RCON checks and were then explicitly stopped.

This is **not specific to our startup scripts or unique to our image**. It also
rules out the earlier Python-parent process layout as a necessary condition:
normal Lobby Goblin startup ran Factorio as PID 1, UID/GID 845; normal Factorio
Tools startup ran `runuser` as PID 1. Both contained the same Factorio executable,
SHA-256 `c9ac91d318bdbcce5afaac30d48f4b71dc38af257712a5d4d4c4feb625737198`.
The evidence does not distinguish a Factorio defect from a compatibility-runtime
interaction or other shared test conditions. It does not establish failure on a
native x86 host, failure without RCON activity, or a generally broken image.
Ordinary saving remains unchanged; enabling non-blocking saving is still excluded
from the performance changes.

The follow-up generated a new fixture with the same seed/layout and 10,000
furnaces. Every trial received a fresh private-volume copy with identical input
save SHA-256 `ae75226983de5631d4341b5613a5092a7f1284fd2e1142a7837203f55e9081a0`.
The settings differed only by the non-blocking-save toggle. Both image entrypoints
ran unchanged with the stack's environment and stdin/TTY enabled. Each server
used two available CPUs and a 2-GB memory cap, with no CPU contention experiment.
Image order was reversed in the middle round.

An identical disposable Python client shared only that trial's private network
namespace and a read-only data mount. It used the same first-party RCON library
for both images: three `/server-save` commands, concurrent `/time` probes with
20-ms waits, and ten subsequent `/time` checks. Each fresh session authenticated
and used the client's normal `/version` response marker. External networking was
disabled and no ports were published. No installation paths or existing worlds
were mounted. Logs and state were captured before all private resources were
removed successfully.

For ordinary-trial shutdown, Lobby Goblin exited 0. Factorio Tools reported
container exit 143 through its `runuser` wrapper; its logs show SIGTERM handling,
shutdown-save progress reaching 100%, and `Goodbye`. These requested shutdowns
are separate from the unrequested background-save crashes.

Immutable image references:

- Lobby Goblin:
  `ghcr.io/jkenneydaniel/factorio-server@sha256:c8056ca33a857406bd1f75521f237782faa810f4bf76e05d21d4d827e0dba990`.
- Factorio Tools:
  `factoriotools/factorio@sha256:2552b97f548f999217bdc9a4e1cc2d4e8c638e9272452e58c978910bc3c01074`.

Follow-up run: `fc-save-compare-06ebfd95-0ba0-4c75-934a-838784b4ee03`.
Raw report SHA-256:
`e72b4d88824646b157f330c3694c04c3a5136c07573505d3a829cbfdea4100b1`.
The ignored run directory includes the report and each server's complete log.
Repeat this development-only comparison with:

```sh
python3 tools/performance/compare-saving.py
```

This uses three rounds by default; `--repeats 1` runs one four-trial round. It
requires both images to be available locally and records their immutable
references, fixture and client hashes, server states, process details, and
cleanup result. The next discriminating comparison is the same generated-world
test on native x86, followed by varying RCON activity if needed.

## Method and limits

- Baseline: the existing Linux amd64 Factorio 2.0.77 image,
  `sha256:c8056ca33a857406bd1f75521f237782faa810f4bf76e05d21d4d827e0dba990`.
- Host: OrbStack on an ARM Mac, running that existing amd64 image through its
  compatibility runtime. Docker exposed 10 CPUs and 16,819,609,600 bytes of memory.
  This is not independent native x86-host acceptance or an ARM comparison.
- Fixture: a newly generated, unmodded 512 × 512 world, seed 987654321, with
  10,000 steel furnaces each supplied with ore and fuel. No user save was copied.
- Ownership/status: six samples per variant, alternating order. Status timings
  include Docker CLI exec, Python RCON startup and the command round trip.
  Production uses the Docker API, so absolute panel response gains may differ.
- Contention: three 1,200-tick game benchmarks per variant; default and weighted
  helper order was counterbalanced, with a fresh helper for each sample. Only
  this experiment pinned both game and helper to CPU 0 to force contention.
- Helpers repeatedly ran the production map initialization and tile/entity batch
  exporter on private copies. Because no player explored the synthetic fixture,
  the chart filter was changed to include all generated chunks (529). This is a
  controlled export workload, not an end-to-end map-page benchmark.
- Fixture data lived in a uniquely named volume; each game/helper run copied it
  into private tmpfs. Root filesystems were read-only, networking disabled and no
  ports published. Bind testing used a newly created temporary host directory.
- Build, regression and acceptance tests ran outside the confirmation measurement
  window. The report records successful cleanup of all benchmark resources.

Confirmation run: `fc-perf-05f9618f-3856-4c59-8d0d-c839ff7589ed`.
Raw report SHA-256:
`b6798a8946d97bf82c97d8ebe72227107bdd7702ba3523a1c55a2b27040f5af2`.
Raw reports stay in ignored `output/implementation/server-performance/<run>/`.

## Repeat from a development checkout

Requires Python 3, a working Docker engine exposing at least two CPUs, and the
baseline owned image already available locally. These tools are development
sources, excluded from installer ZIPs. No image is pulled automatically.

```sh
python3 tools/performance/run.py
```

The runner creates only UUID-named resources, uses no Compose project and never
mounts installation data. It records the image ID, source hashes, raw samples,
save errors and cleanup outcome in a new report. `--image` selects another local
compatible 2.0.77 amd64 image; `--output` chooses the evidence directory.
Interruption attempts cleanup; an unclean process kill or Docker outage may
require removing that run's recorded resources manually.

## Validation of the changes

Image revision `2.0.77-fc.2` was built locally and passed the full disposable
container acceptance suite: legacy fixture load, preserved settings/mod/password
checksums, RCON, save, graceful stop, reload with the old binary, direct world
creation and valid PNG preview. It was not published or installed. Installation
defaults and existing image selections still refer to their previous image.

Regression coverage checks ownership of overlapping/custom trees and symlinks;
cache expiry, process/world invalidation, concurrency and stale responses; actual
controller query reduction with live player/time checks; and helper CPU priority
with unchanged memory/network settings and no hard CPU quota.
