# Changelog

## 0.2.2-alpha — 2026-10-16

- Add an independently built x86-64 Factorio image from pinned Debian and the
  checksum-verified official headless download, with first-party startup/RCON
  tools. Keep existing worlds, settings, identity and mod selections intact.
- Support Factorio Tools and Factory Control images in the panel, including
  reviewed same-version source changes and separate image revisions. Validate
  compatibility before replacement and pin the downloaded image digest.
- Verify both image sources with read-only amd64/digest preflight checks and
  recognize the actual RCON version response after replacement.
- Add isolated runtime tests and an explicit build/test/publication workflow;
  keep current installation defaults and running servers unchanged.

- Add configurable backup cleanup windows, exact deletion reviews and optional
  daily retention. Exclude manual/pre-change archives by default; protect newest
  copies, verified recovery archives and required update backups. Keep cleanup
  under the server operation lock without issuing game or Docker commands.

- Add guided, read-only diagnostics for the panel/controller, Docker, game state,
  host architecture, storage access and free space, with next steps and a
  support report that excludes credentials, raw logs and private configuration.
- Save world drafts to each administrator account, including unfinished JSON
  and invalid input. Resume from the world library after reloading or signing in.
- Save up to 20 private custom presets. Loading keeps the current world name
  and seed; resumed drafts and presets never preselect switching the game.
- Detect conflicting saves from another tab and offer a downloadable draft copy.

## 0.2.1-alpha — 2026-10-16

- Combine the v0.2.0-alpha setup, interface, onboarding and updater work with
  the controller improvements that were previously only installed locally.
- Reduce idle controller CPU by caching saved-map metadata until the snapshot
  file changes, including lightweight map-status requests. Automatic refresh
  after completed saves remains enabled.
- Preserve the local controller image override outside Git and use LF line
  endings for the executable Mac setup shortcut.

## 0.2.0-alpha — 2026-10-16

- Guided Windows and Mac/Linux host launchers, a Finder shortcut, read-only
  prerequisite checks, explicit startup and save-import/recovery choices.
- Explicit amd64 game/worker selection on ARM64 hosts; panel services remain
  native. Temporary workers reuse the installed game image ID when available.
- Host setup/troubleshooting guide and platform matrix distinguishing emulated
  game support from native panel builds and actual host validation.
- Simulated host-launcher coverage and a Mac/Linux/Windows CI matrix.
- Whole-panel charcoal/forest styling, amber actions, official outline icons,
  responsive navigation and consistent forms across every management page.
- Dedicated Play style / Customize / Review world creation, grouped resources,
  retained drafts during navigation, revealed validation errors, creation feedback,
  searchable/filtered worlds and actual generated-preview thumbnails.
- Resumable first-run browser onboarding after owner registration, server-side
  readiness/first-save checks, connection guidance and persisted completion.
- Automatic public GitHub release notifications for administrators, preview/stable
  channels and offline mode. No unattended updates.
- Administrator-triggered in-panel updates: staged/checksummed panel releases,
  a detached Compose worker, persistent progress, source/config/state recovery,
  and separately selected Factorio patch upgrades with explicit save recovery.
- Release installer metadata and local source baselines; modified installations,
  unsupported migrations and mount/port changes block automatic replacement.

## 0.1.0-alpha

Initial public alpha source release.

- Docker-packaged game, browser panel and internal controller.
- Private administrator/viewer registration and account management.
- Server controls, player administration, settings and sanitized logs.
- World library, save import/download, configurable generation and live previews.
- Full backup verification, schedules, restore and failed-load recovery.
- Automatically refreshed saved-map overview and shared pins.
- Optional live player positions with per-world achievement warning and backup.
- Portable environment configuration, Docker-only first-run setup and recovery.
- Allowlisted source packaging and GitHub test/build automation.

Targets Factorio 2.0.77 and trusted LAN use. See README for alpha limitations.
The alpha source is not automatically deployed to existing installations.
