# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/), versions: [SemVer](https://semver.org/). Git tags: `vX.Y.Z`.

## [0.4.0] — 2026-11-18

### Added
- Visible mode v2: the **real pointer** glides to each action point before the action (`delivery_mode: "foreground"`), with a small soft halo that rides on the pointer.
- Compact translucent two-line caption (goal / current step) with a small Stop button; smart placement never covers the action target; dark (default), light and accent themes (setting «Оформление плашки»).
- Per-computer «Don't touch my mouse»: background delivery with the driver's own cursor.
- `mac_screenshot` for a window returns the element tree only; a downscaled window picture only with `image: true`. Skill: «picture only when needed» order.

### Changed
- Overlay is one process at most (pid file), event-driven: it exits ~8 s after hiding, when its parent host worker dies, or when replaced; leftover 0.3.x overlay processes are stopped.

### Measured (MacBook Pro, Apple silicon, Sonnet agent, task «open Chrome → ya.ru → search»)
- Real pointer mode: 5 calls, 0 pictures, ~36 s end to end, context ~69k tokens (mostly the fixed system prompt).
- «Don't touch my mouse»: 6 calls, 1 window picture (the search field was not yet in the first tree), ~42 s, context ~84k tokens.
- Overlay: one process, ~0.1 % CPU and ~66 MB RSS while visible; it exits ~8 s after the last action, so nothing runs when idle.

### Fixed
- The driver's agent cursor glow from 0.3.2 only appeared during the driver's own pointer animations and was easy to miss; v2 highlights the real pointer instead.

## [0.3.6] — 2026-11-18

### Added
- Discoverable agent RPC (`agent_status`, `agent_applescript`, `agent_action`) for sessions that do not list the `mac_*` tools, such as a Codex session started before an update. Same access policy, Stop agent and journal; call with `bb plugin rpc call mac-computer-use <method> --input-file …`.

### Changed
- The skill no longer suggests calling `cua-driver` or `osascript` from `bb terminal` as a fallback.

## [0.3.5] — 2026-11-18

### Added
- Access entries keep stable machine traits (BB machine name, salted SHA-256 of the Mac hardware UUID) and move to their Mac automatically after a BB reinstall with new host IDs — only on an unambiguous hardware match. Name-only or ambiguous matches only show a one-click «Bind to this computer». Rebinds and binds are journaled.
- Test for the «restore with new IDs» scenario.

## [0.3.4] — 2026-11-18

### Added
- `mac_applescript`: AppleScript runs inside a small ad-hoc signed background helper, «BB Automation» (built on the Mac with `osacompile`), so macOS Automation prompts name it instead of the BB host process ("node"). Respects the per-computer access policy, app allowlist, Stop agent and the action journal.
- Settings: an explanation of «… wants to control …» prompts and where to change the choice (Privacy & Security → Automation).

### Changed
- Ladder for agents: command line without driving other apps → Accessibility actions → AppleScript via the helper → GUI. Agents must not run `osascript` against other apps from `bb terminal`.

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
