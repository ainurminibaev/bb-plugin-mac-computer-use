# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/), versions: [SemVer](https://semver.org/). Git tags: `vX.Y.Z`.

## [0.3.3] — 2026-11-18

### Added
- Two-line caption: «BB · <project> — Goal: <goal>» and «Now: <step>». New `goal` argument (remembered per thread; default: the thread title).
- «Stop agent» button on the caption: revokes GUI access for that thread's session immediately (12 h or until «Allow again» in Settings); agents get a clear refusal. The button is reachable by mouse and Accessibility (VoiceOver) without taking focus.
- Settings: list of stopped agents with «Allow again».

## [0.3.2] — 2026-11-18

### Added
- Visible mode: the driver's agent cursor (glow, click ripple) plus a click-through, non-activating caption overlay «BB · <project>: <step>» that fades out after a few seconds.
- Optional `step` argument on `mac_action` and `mac_screenshot` for the caption; readable defaults by tool and app.
- Per-computer settings «Show agent actions» (on by default) and «Bring window to front» (off by default).

## [0.3.1] — 2026-11-18

### Added
- `THIRD_PARTY_NOTICES.md`: licenses of bundled and runtime dependencies, scaffolded UI components and the separately installed Cua Driver; trademark notice.

## [0.3.0] — 2026-11-18

### Added
- Command-line-first ladder for agents (shell/osascript → AppleScript, Shortcuts, APIs, Accessibility → GUI) in the skill, tool descriptions and READMEs.
- Required `why_gui` argument on `mac_screenshot` and `mac_action`; the reason is echoed in the result and kept in a GUI action journal on the settings screen.
- Separate «coordinate mouse» permission: with it off, agents act only on UI elements (no x,y clicks, drags, cursor moves or foreground delivery).

### Changed
- Settings wording: the plugin grants GUI access; command access through `bb terminal` is governed by BB.

## [0.2.0] — 2026-11-18

### Added
- Settings screen «Computers and access»: per-computer on/off, screen and mouse/keyboard switches, app allowlist.
- Cua Driver install/update from settings, verified by SHA-256 and Developer ID team `YCK386LBJ7`; update swaps the app bundle and keeps the previous copy in the Trash.
- macOS permission status and a button that opens the driver's permission guide.
- Connection check with a live screenshot thumbnail.
- One driver session per BB thread, so window snapshots and element tokens survive between tool calls.
- Compact tool help in `mac_tool_info`.

### Fixed
- Driver daemon auto-start (status text was read from the wrong stream).
- Machine lookup by name with a non-breaking space or em dash in the name; unique partial names also match.
- With an app allowlist, `list_windows` requires an allowed `app` or `pid` instead of listing every window.

## [0.1.0] — 2026-11-18

### Added
- Agent tools `mac_screenshot`, `mac_action`, `mac_tool_info` over Cua Driver; screenshots downscaled to JPEG; deny list for risky driver tools.
