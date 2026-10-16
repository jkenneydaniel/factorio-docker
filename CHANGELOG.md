# Changelog

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
