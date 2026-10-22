# Repository and release layout

Lobby Goblin stays in one repository. The shared runtime and its game-image
compatibility checks can be reviewed together, while each image keeps its own
version and publication workflow. Source organization does not rename installed
directories, reset update baselines, change configuration or deploy services.

## Git checkout

```text
Install.sh / Install.ps1 / Install.command   Primary new-installation entrypoints
panel/                                     Web, controllers, core and game modules
images/factorio/                           Factorio image runtime, manifest and tests
images/rust/                               Rust image runtime, manifest and tests
scripts/install/                           Explicit Docker installation helper
scripts/standalone/                        Existing Factorio setup and start tools
scripts/fleet/                             Advanced host-manager launchers
scripts/windows/                           Optional LAN, firewall and autostart tools
deploy/fleet/                              Fleet Compose and environment examples
tools/                                     Release, image acceptance, performance tools
docs/                                      Guides, contracts and recorded verification
docs/verification/                         Historical design verification
.github/workflows/                         CI and deliberate publication workflows
```

`compose.yaml` and `.env.example` stay at the root because existing standalone
setup, migration and update logic use that installation layout. Rust's separate
Compose template stays at `panel/games/rust/compose.yaml`: its preparation code
and published runtime consume that file. Moving it outside `panel/` would change
the runtime build contract without simplifying the user installation.

`dist/` contains generated release artifacts and `output/` contains local captures
and diagnostics. Both remain ignored. They are not alternate source trees, and
reorganization does not delete their existing contents. Never store private
installation state, saves or credentials in source directories.

## Downloadable releases and older updaters

Release source paths are an installed compatibility contract. Older updaters
validate every ZIP entry against their own fixed allowlist before executing any
new code. Merely teaching a new updater about `images/` or `scripts/` cannot make
an already-installed updater accept those directories.

`panel/source-layout.js` defines the source-to-installation mapping, used by
`tools/release.mjs` and source tooling:

| Canonical checkout source | Complete release bundle path |
| --- | --- |
| `images/factorio/` | `factorio-image/` |
| `images/rust/` | `panel/games/rust/image/` |
| `scripts/standalone/*` | Historical root `Setup.*` / `Start-Server.*` |
| `scripts/fleet/*` | Root `Fleet.*` |
| `scripts/windows/*` | Historical root Windows helper names |
| `scripts/install/Install-Docker.sh` | Root `Install-Docker.sh` |
| `deploy/fleet/compose.yaml` | Root `fleet.compose.yaml` |
| `deploy/fleet/.env.example` | Root `.env.fleet.example` |

The normal update ZIP preserves the original smaller allowlist. Packaging adds
the Factorio image guide at `docs/FACTORIO_IMAGE.md` in that ZIP and redirects
its documentation links, since the image-source directory is excluded. The complete
`.source.zip` includes installer, fleet and image-build sources in their historical
locations. Both retain metadata/state contract versions and historical archive-name
aliases. Documentation links, guide commands and workflow paths are rebased for
the extracted layout; this document intentionally describes both layouts.

Source tools resolve either layout. Existing installations keep their original
Compose project, mounts, environment, accounts, backup formats and update paths.
Do not manually move installed state to match the checkout tree. A Git checkout
with local source edits should continue to fail the updater's baseline check.

## Ownership and workflows

- `panel/core/`, `panel/fleet/` and `panel/games/` own application and controller
  behavior. Image bootstraps belong in `images/`, not inside a game adapter.
- `.github/workflows/game-images.yml` builds/tests Factorio and Rust and supports
  deliberate image publication. `.github/workflows/panel-image.yml` owns the
  shared panel/controller runtime; `release.yml` owns downloadable release assets.
- The Rust build still reuses the panel dependency lockfile and WebRCON transport.
  The builder sends only the required public files in a temporary build context.
- Publishing images or release artifacts is separate from changing a running
  installation. Refactoring and fixture checks must not access live game storage.

For commands and validation boundaries see [development](DEVELOPMENT.md),
[updates](UPDATES.md), [Factorio image](../images/factorio/README.md) and
[Rust image](../images/rust/README.md).
