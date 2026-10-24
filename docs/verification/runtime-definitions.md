# Runtime and application-package verification

Current source: `codex/panel-product-foundation`, based on `3b484c5`. Everything
was uncommitted at this checkpoint. The later
[release review](release-0.3.7.md) covers the release candidate. Existing installations, running servers and worlds were not
used for acceptance or changed. This supersedes earlier incremental checkpoints.

## Implemented package foundation

- Factorio and Rust live in `panel/applications/<id>/`, with one explicit
  `registry.json`. Immutable runtime/presentation declarations drive their shared
  screens and established Docker adapters. Rich tools use package-owned native
  HTML assets and lifecycle hooks. No ordinary game-specific page shell remains.
- Package declarations own custom grants and labels. Factorio map viewing,
  previews, generation, pins and tracking are separated. Rust frameworks, plugins
  and configuration require their respective grant plus `mods.manage`.
  Existing administrator/read-only behavior and stored assignments are preserved.
- Disposable source registration proves another game and a non-game application
  without editing shared host/shell code. Synthetic web/queue/scheduler providers
  cover lifecycle dependencies, private references and explicit deploy recovery.
  Production non-game Docker providers and Laravel hosting remain future work.
- Public operation records retain uncertainty across lost replies, failed final
  saves and archive publication. Shared history delegates recovery to the native
  workflow; acknowledgement does not manufacture success or bypass world restore.
- Compatible repositories and opt-in transactional storage preserve original JSON.
  Offline migration/export/recovery and management metadata snapshots have explicit
  ownership, revision, hash and durability checks.

## Source checks

- Full backend suite: **543 tests; 542 passed, zero failed, one platform skip**
  (`/tmp/lobby-foundation-checked-backend.log`). The skipped ownership case also
  passed separately as root in the Linux image.
- Browser: **134 passed**, desktop and mobile
  (`/tmp/lobby-completion-browser-final.log`).
- Static gates: zero-warning lint, formatting, strict boundary types, **four**
  quality self-tests and **133** served browser modules passed
  (`/tmp/lobby-foundation-checked-quality.log`).
- Factorio image runtime: **20 Python tests passed**, without a game process
  (`/tmp/lobby-foundation-factorio-runtime.log`). Rust image/runtime checks are
  included in the backend suite.
- Focused native transaction/recovery checks cover terminal audit failure/lost
  publication, old unresolved history, explicit review/world-recovery fencing,
  archive/current-record disagreement, parent uncertainty, and committed Rust
  framework cleanup. Fixtures preserve synthetic world sentinels.

## Current disposable engine

Machine `lobby-platform-completion-20261024`, Ubuntu 24.04 amd64, isolated from
host files and host/other-machine network access, with 2 CPUs, 6 GiB memory and a
24 GiB disk limit. Machine ID: `01M5P3VHKMHKNJNXZM3NB6XW4M`.
Docker **29.9.2**, engine **`d7e16482-bfbd-45fb-b3be-4541b740923f`**,
default containerd overlay store. Zero initial containers were verified. Docker
calls always select this machine explicitly; the normal Docker context is unused.

The reviewed conformance image is
`sha256:7e80119f47e8da2a9e05a7fadc1c3f6a9454b68104f122224cf5ade4737af375`.
It adds only a test Arena registration and acceptance scripts to the product
source. It is a local image and is never pushed. The later agent conformance image is
`sha256:42a3afa2594b7ba892ef218ea35ecae1b9ae77c8c606ef5bb9c3c4a61c0b0aca`
with target
`sha256:cdecffe17f9e61055d94e7c3d680c65576831bc2138ee48b801be100244e412e`.
It includes the corrected pinned operator inspection and cleanup/Rust fixes.
The final production image, without test registrations, is
`sha256:22328a9268e5dd9c5bf8f3fe2ade6f9aa4eaba34b1036e0b0b5abeef18f223ec`.
Its contents match the current public source bundle. Late malformed-JSON and
legacy HTTP-agent cases also have focused source regressions.

Passed on this engine:

1. Actual broker provisioning of two Arena instances, scoped volume subpaths,
   private credential separation, six denied cross-instance/host/creation calls,
   reduced metadata and capability rotation. Proof:
   `runtime-proof/runtime-proof.json` beneath the private acceptance directory.
2. Shared Factorio/Rust web startup without a daemon/world mount, actual Linux
   SQLite migration/private export/recovery, held controller/web authentication
   and activation, suppressed background work and durable restart receipts.
3. Actual metadata worker backup/verify/raw restore, ownership preservation and
   read-only agent activation receipt, with no daemon/world mounts.
4. Real helper mount/nested-file/orphan-cleanup/linked-output acceptance in a
   corrected fresh synthetic scope. See [isolation verification](docker-broker.md).
5. The platform-specific setup ownership test passed as root on Linux, covering
   the service UIDs and shared-key permissions skipped by the macOS suite.
6. Installer-generated central fleet update and four recovery scenarios passed:
   pre-activation rollback, lost replacement response, lost activation response
   plus a stopped management process, and lost outcome publication. Original
   installer bytes, synthetic application identity/start/mounts/networks and world
   bytes remained unchanged; Compose selected only the current management service.

7. The same five scenarios passed from a fresh host-agent installation, including
   the read-only web service and pinned HTTP/2 transport. A prior attempt found the
   operator/client route restriction mismatch; its retained update recovered with
   the corrected operator before this fresh run. Paired clients still reject
   reserved paths before connecting. Older gateway-backed agents retain their
   plain loopback transport, verified with a real HTTP source regression.
8. A final read-only comparison confirms all **five** retained synthetic
   application IDs, images, start timestamps, mounts and world hashes are unchanged
   across both new fleets, the earlier interrupted agent fixture and the original
   two-instance boundary fixture. Proof: `preserved-fixtures.json`.
9. The matching production image passes source-ZIP/content comparison, first setup
   and a safe repeat setup with unchanged account/secret/configuration hashes,
   without network, a daemon socket or game mounts. Production web startup also
   serves both packages. The 455-file source package and both historical naming
   variants were prepared locally; nothing was uploaded.

Proofs and a compact final-check summary are retained locally under
`output/verification/product-foundation-20261024/`. Original operator plans,
credentials and snapshots remain private on the disposable engine. Test-only
registrations do not enter the production application registry.

## Release and scope boundaries

The full backend release lane validates current and historical source bundles,
frozen 0.2.0/0.3.3 updater readers, relocated image sources and prepare-only
installation preservation. Linux package/image matching and repeat-setup preservation passed on the final
production build. Packaging prepares local artifacts only.

No live installation acceptance or upgrade, game-image replacement, commit, push,
image publication or release publication is performed. Existing legacy/custom
installations are refused by the operator updater rather than adopted. Review-only
broker conversion remains a separately authorized operational migration.
