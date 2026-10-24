# Management updates and recovery

The local operator command updates an intact, broker-enabled installation's
management services together. It preserves application container IDs, images,
mounts, networks and start timestamps. Application storage, worlds, backups and
the snapshot library are never mounted by the metadata worker.

This command does not adopt legacy/custom installations or migrate them to the
broker. Existing installation records and generated Compose files remain intact.
Ordinary startup without an operator update keeps its previous behavior.

## Operator command

Run from a reviewed source checkout with its Node dependencies installed. Select
the existing installation directory, an explicit local Unix Docker socket, the
engine's literal identity and an already available immutable runtime image. The
command never pulls a mutable tag. Windows named-pipe transport is not supported
by this operator command; existing Windows installation behavior is unchanged.

```sh
node panel/management-update.js plan \
  --directory /absolute/installation \
  --socket /absolute/docker.sock \
  --engine ENGINE_ID \
  --image ghcr.io/jkenneydaniel/lobby-goblin@sha256:IMAGE_DIGEST

node panel/management-update.js status \
  --directory /absolute/installation \
  --socket /absolute/docker.sock --engine ENGINE_ID --id UPDATE_ID

node panel/management-update.js apply \
  --directory /absolute/installation \
  --socket /absolute/docker.sock --engine ENGINE_ID --id UPDATE_ID --confirm
```

Planning validates the actual image's capability manifest, registered instances,
service ownership and configurations, metadata volumes and protected application
identities. It creates a temporary unstarted image probe and private local plan;
it does not change installed services. Unknown/custom layouts, unavailable or
active workflows and changed identities require review.

Inspect the retained update with `status`. Use `resume` with the same arguments
as `apply` to reconcile an interrupted step. Before activation is committed,
`rollback` with the same arguments restores the previous management metadata and
services. After commitment, only forward recovery is permitted. These commands
require `--confirm`; the web panel cannot invoke them.

Keep `.management-updates` private and retain its original specifications,
operation records, active-runtime receipt and Compose override. They can contain
credentials and must not be copied into a support report. CLI output and panel
history contain only checked public metadata. A retained storage lease after an
operator process dies requires offline identity-bound lock review using
`panel/storage.js`; never delete it or the engine claim to bypass recovery.

## Update sequence

1. A filesystem lease protects the installation. An engine-owned claim also
   prevents a second operator using a copied installation directory from updating
   the same fleet. The claim container is never started and has no mounts or
   credentials.
2. The operator records intent before each mutation, stops public ingress and
   management writers, and rechecks workflows before stopping controllers. Game
   containers remain running. A fixed worker snapshots management metadata.
3. The broker, host, instance controllers and web service are replaced in order.
   Old management containers remain stopped until the outcome is confirmed. New
   services start held: health is available, ordinary requests and background
   work wait for activation.
4. The operator checks held health, workflows and protected application identities
   before durably committing activation. Earlier failures can restore metadata
   and restart the original services. Once originals restart, a retried rollback
   cannot overwrite their new activity with an old snapshot.
5. A pending desired-runtime receipt is written before activation. Each service
   records activation durably. Committed recovery inspects, restarts or recreates
   only its own replacements and finishes forward. A lost response never implies
   that the action should be replayed without inspecting its actual result.
6. Checked outcomes enter the common operation history and audit log. Failed
   publication is retried without rerunning the update. A complete private receipt
   and Compose override keep later installation starts on the selected runtime.
7. After confirmed success, exact stopped originals are removed so Compose selects
   only current services. Snapshots and private original specifications remain.
   Failed cleanup retains the confirmed outcome and returns `cleanupRequired`;
   `resume` retries cleanup only. Startup refuses unfinished updates or cleanup.

Starting an installation also checks the retained engine identity. It refuses an
unfinished update, pending receipt or altered override instead of reverting to
an older Compose image. There is no automatic migration or update on startup.

## Metadata and startup boundaries

`panel/management-runtime.json` declares the broker, storage and maintenance
protocols. The operator reads it from the actual immutable image, in addition to
checking source/runtime labels. Services use `PANEL_MAINTENANCE_ID` for held
startup. Loopback-only, bearer-protected status/activation endpoints are excluded
from panel/fleet proxies and application routes. Activation never submits an
application Start action. The read-only agent web service receives its activation
receipt through the operator's fixed metadata worker.

The worker has no daemon socket or network. Its mount vocabulary is fixed:

| Metadata | Scope |
| --- | --- |
| Host state, registry and operations | Fleet state volume |
| Accounts, settings and web secrets | Fleet web volume |
| Broker authority and credentials | Broker state and credential slots; sockets excluded |
| Instance state and credentials | Instance `state`, `updates` and `control` subpaths |

The worker preserves opaque bytes, modes and numeric ownership, including
selected SQLite databases and native workflow files. Bounded file/path checks
reject links, special files, nested filesystems, foreign ownership and retained
leases. A complete hash manifest is published last after durability barriers.
Restore validates the whole snapshot before replacement, requires stopped
writers and the recorded manifest hash, and can retry a partial restore. A
completed restore verifies its receipt instead of overwriting later changes.

## Verification

Source tests cover intent-before-effect, lost responses, pre-activation rollback,
forward-only activation recovery, private receipts, startup exclusion, engine-wide
operator exclusion, changed configurations, failed outcome/audit publication and
cleanup retry. The SSH host installer includes the new startup dependencies.

The opt-in `panel/test/management-update-runtime.mjs` uses a marked disposable
Linux engine, actual installer-generated Compose files and a fresh synthetic
application. It exercises CLI success, rollback, lost replacement/activation/
publication responses and management-process restart. Each outcome must preserve
application identity, start timestamp, mounts/networks, world bytes and the
original installation files. Only a completed result is acceptance evidence;
source tests and individual probes do not establish a complete image cutover.

No existing installation has been upgraded or published by this source work.
The complete foundation review and disposable runtime evidence are recorded in
[the completion ledger](verification/platform-completion.md). Production native
application acceptance remains separate from these synthetic preservation checks.
