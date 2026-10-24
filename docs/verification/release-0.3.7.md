# 0.3.7-alpha release review

The review covers the accumulated working-tree changes on
`codex/panel-product-foundation` against `3b484c5`, including new files, removed
wrappers and relocated application packages. The release also includes the
earlier shared-shell/module commit. Existing installations and real game/world
storage are excluded from operational checks.

## Findings resolved

1. **Download permission default (P1).** The controller handles explicit
   `kind=backup` downloads centrally and routes other kinds to Factorio's world
   handler. Authorization previously classified an omitted/unknown kind as a
   backup, permitting a delegated backup downloader to reach a world download.
   Both package and compatibility permission checks now use the controller's
   world default. HTTP regressions cover local and remote server scopes, denied
   requests that never reach the controller, explicit backup access and retained
   administrator/legacy world URLs.
2. **Management hold before network reconnection (P2).** Host initialization
   reconnected missing management network endpoints before constructing its
   maintenance hold. Held startup now performs read-only host verification;
   network reconnection is deferred until authenticated operator activation.
   A Docker guard also refuses mutations outside activation while held. The
   regression uses the actual host controller and verifies zero Docker mutations
   before activation and only the management endpoint connection afterwards.

The review also checked route/action authorization, trusted actor propagation,
private helper mounts and cleanup, broker resource/credential scope, storage
selection and recovery, operation publication, application registration and
served assets, historical updater formats and release-source allowlists.

## Local release checks

- Backend: **546 tests, 545 passed, zero failed, one platform-specific skip**.
  The unchanged root-ownership case has separate Linux coverage recorded in the
  [foundation verification](runtime-definitions.md).
- Browser: **134 desktop/mobile checks passed** using disposable loopback
  fixtures, with external requests blocked.
- Static quality: lint, frontend formatting, shared contract types, four quality
  self-checks and the import graph for **133 browser modules** passed.
- Factorio runtime: **20 Python checks passed**.
- Version/default image references advance together to `0.3.7-alpha`; the host
  update-status response now reads its package version instead of a fixed string.
- Source packaging retains historical updater aliases and installation paths.
  Factorio and Rust game-image identities are unchanged.
- A fresh candidate on the marked disposable Linux engine passed the CLI update,
  pre-activation rollback, lost replacement response, lost activation response
  with a stopped management process, and lost outcome publication response.
  Both the newly created synthetic application and five retained synthetic
  application containers/world files were preserved.
- The production candidate (only Factorio/Rust registered), image
  `sha256:d5c39c737957add6ad91e011b463bbe2733eafad88531bd2d9ad26d9e196479f`,
  passed runtime startup and release-ZIP/image matching. Fresh setup and safe
  rerun used temporary storage with no network, Docker socket or running game.

Hosted CI, signed commit/tag, image publication and release downloads are later
evidence layers. Publishing a release does not update installed management
services or modify running games and worlds.
