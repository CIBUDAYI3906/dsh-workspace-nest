# Changelog

All notable changes to this project. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [0.1.2] — 2026-11-21

### Changed
- README: new first-screen hook, English summary, comparison table, badges, demo GIF.
- `engines.dsh` widened to `>=0.2.0-rc.1 <0.4.0` (allows DSH 0.3.x).

### Fixed
- The `sidebar.workspaces` registration is now wrapped in a capability guard: a future client that moves the slot degrades to "no entry" instead of failing the module.

## [0.1.1] — 2026-11-21

### Added
- The sub-workspace dialog accepts an **existing** folder through the system directory picker (containment guarded). Contributed by [@NotTheOrange21](https://github.com/NotTheOrange21) in #1.

## [0.1.0] — 2026-11-12

### Added
- Nested workspace tree derived from directory ancestry; sub-workspace creation via a local host route.
- Sessions on every level; pin/unpin a session to the top of its nearest folder.
- Rename / delete / archive / fork / session search through the real services.
- Initial public release.
