# Changelog

## Unreleased

- Reduce idle controller CPU by caching saved-map metadata until the snapshot
  file changes, including lightweight map-status requests. Automatic refresh
  after completed saves remains enabled.

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
