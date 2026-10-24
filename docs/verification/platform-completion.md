# Product foundation completion

The audit and application-package work is on `codex/panel-product-foundation`,
based on `3b484c5`. This records the completion checkpoint before the
`0.3.7-alpha` release review.
Existing installations, running servers and worlds are excluded from mutations.
Acceptance uses temporary files, synthetic applications and explicitly selected
disposable Docker hosts. The agreed foundation reached commit review; the subsequent
[release review](release-0.3.7.md) records its fixes and validation.

## Agreed scope

| Area | Implementation and review |
| --- | --- |
| Application packages | Factorio/Rust definitions, runtime profiles, shared screens and package-owned permissions; additional game and non-game conformance fixtures |
| Shared frontend | One product shell and ordinary capability controllers; native HTML assets for rich extensions, with lifecycle ownership and static import/type/template checks |
| Operation recovery | Common checked history, workflow-owned recovery, retained interrupted records, correlated terminal audit outcomes and publication repair without action replay |
| Persistence | Compatible JSON repositories, opt-in transactional storage, versioned migration, private export/recovery and retained-lease review |
| Management lifecycle | Explicit engine-bound operator update, held startup, metadata snapshots, pre-activation rollback, committed forward recovery and restart-safe installation receipts |

Production Laravel hosting, multi-service Docker providers, ingress/database-aware
backup providers, dashboard package imports, a marketplace and new rich game
features remain future product work. They are not requirements for this foundation.
Existing legacy/custom installations are preserved; the operator command supports
intact broker-managed layouts and refuses automatic adoption/conversion.

## Final review fixes

- Management updates now use one workflow-specific recovery record through the
  existing public operation model. There is no generic management-journal framework.
  Private originals and snapshot artifacts stay outside panel/game mounts.
- Durable intent precedes engine effects. A stopped replacement can be reconciled
  after commitment; metadata rollback is prohibited after activation starts.
  Old originals are removed only after confirmed success, keeping Compose's
  service selection unambiguous. Cleanup failure retains the confirmed outcome.
- Startup and later plans refuse unfinished updates and cleanup. A private runtime
  receipt/override binds future installation starts to the reviewed engine/image.
  Original installer files remain byte-for-byte unchanged.
- Docker's equivalent unset/false OOM default is normalized when checking newly
  created services. Other runtime configuration changes still refuse recovery.
  Node's management entrypoint handles termination and closes management listeners
  without submitting an application Stop action.
- Old unresolved standalone updates survive the ordinary history limit. An
  administrator must inspect and explicitly acknowledge an interrupted outcome;
  a required world restore cannot be acknowledged away. Original uncertainty is
  retained, and recovery submits no engine mutation.
- Background panel/image updates, host setup and agent updates publish correlated
  terminal audit metadata. Idempotent publication reconciles lost replies and
  preserves an unavailable/review-required state when storage fails.
- Rust review-file cleanup no longer rolls back an already committed framework.
  Malformed native JSON fails without echoing private file fragments in errors.
- The operator uses a pinned loopback HTTP/2 session for read-only agent
  inspection. Ordinary paired clients still reject reserved management paths.
- Native workflow records have file and directory durability barriers. An archive
  written ahead of the authoritative current record cannot prove completion or
  resolve the parent's readiness/cleanup uncertainty.
- The SSH host bootstrap carries the complete new installer dependency set.
  Package registration/documentation uses `applications/registry.json`; removed
  wrappers and runtime game trees are not retained as deprecated aliases. The
  historical image-source mappings remain active release-compatibility code.

## Validation

The final source checks, Linux image/installer acceptance and artifact identities
are recorded in [runtime verification](runtime-definitions.md): **542 backend
checks passed**, one macOS platform skip covered separately on Linux, **134
browser checks**, **20 Factorio Python checks**, all static gates, real Docker
isolation/helper acceptance, central/agent management recovery and final
production-image/source-package matching. This does not claim deployment.

The review covered shared authorization/routing, lifecycle/operation ownership,
package loading and served assets, private storage/recovery, Docker scope,
management replacement and historical installer/updater packaging. Contradictory
incremental status notes were replaced with this current record. Whitespace checks
passed at this checkpoint; the index and original checkout were unchanged.
Release preparation and publication are recorded separately from upgrading an
existing installation.

See [management updates](../MANAGEMENT_UPDATES.md),
[application definitions](../APPLICATION_DEFINITIONS.md),
[access](../ACCESS.md), [storage](../STORAGE.md) and
[isolation](../ISOLATION.md) for the supported behavior and trust boundaries.
