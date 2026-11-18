# Mac Computer Use — BB plugin

[Русская версия](README.ru.md)

Lets BB agents in any thread, on any enrolled machine, see a Mac's screen and control it like a person: screenshots, clicks, typing, shortcuts, scrolling, launching apps. Built on the open-source [Cua Driver](https://github.com/trycua/cua) (MIT).

## Command line first, GUI last

Agents follow a ladder and pick the lowest rung that works:

1. **Command line** on the Mac via `bb terminal run --machine <mac>`: shell, `open`, `defaults`, `mdfind`, `osascript`, app CLIs.
2. **Scripting and programmatic interfaces**: AppleScript/JXA dictionaries, `shortcuts run`, URL schemes and app APIs, Accessibility actions on UI elements without the mouse (`element_token`, `set_value`, `invoke_menu`).
3. **GUI** — screen, mouse and keyboard through this plugin — only when rungs 1–2 cannot do the job.

GUI tools require a `why_gui` argument: the agent states why the command line and scripting were not enough. The settings screen keeps a journal of GUI actions with these reasons. This plugin controls GUI access only; command access through `bb terminal` is governed by BB itself.

## Agent tools

| Tool | Purpose |
| --- | --- |
| `mac_screenshot {machine, pid?, window_id?, why_gui}` | Full-screen screenshot, or one window with its accessibility tree and `snapshot_id`. |
| `mac_action {machine, tool, args, why_gui}` | Any Cua Driver tool: `list_windows`, `launch_app`, `click`, `type_text`, `hotkey`, `scroll`, `run_steps`, … |
| `mac_tool_info {machine, tool?}` | Tool list, a tool's arguments, or `status` (driver, macOS permissions, granted access). |

`machine` is a BB machine id (`host_…`) or its exact name. The bundled skill `mac-computer-use` teaches agents the observe → act → verify loop and the safety rules (no sending, buying, deleting or publishing without the user's confirmation; never type passwords).

## Settings → Mac Computer Use → Computers and access

- Grant or revoke GUI access per computer; separately allow screen viewing, actions in apps (Accessibility) and coordinate-based mouse input; optionally restrict to a list of apps (bundle id or name).
- A step-by-step wizard connects a new Mac; a journal lists recent GUI actions with the agent's reason.
- Install or update Cua Driver on a Mac: the release archive is checked against `SHA256SUMS`, `codesign --verify --deep --strict`, the Developer ID team `YCK386LBJ7` (Cua AI, Inc.) and Gatekeeper. Telemetry is turned off.
- macOS permission status and a button that opens the driver's permission guide on the Mac.
- Connection check with a live screenshot.

A computer that is not listed in the access policy is denied. Tools `kill_app`, `clipboard_read`, `set_config`, `install_extension`, `check_for_update`, `replay_trajectory`, `browser_download`, `browser_set_input_files` are blocked by default (`deniedTools`).

## Install

```sh
bb plugin install git:https://github.com/ainurminibaev/bb-plugin-mac-computer-use.git@^0.3.1
```

Then open Settings → Mac Computer Use, install Cua Driver on your Mac, grant the two permissions on the Mac (System Settings → Privacy & Security → Accessibility and Screen & System Audio Recording → CuaDriver), enable access and run the connection check. Agent tools appear in new agent sessions.

From a local checkout: `npm ci && bb plugin build . && bb plugin install path:$PWD --yes`.

## Update and release

Users on a semver range get new versions with `bb plugin update mac-computer-use`.

Release steps:

1. Update `version` in `package.json` and add a `CHANGELOG.md` section.
2. `npm ci && npm run typecheck && npm test && bb plugin build .`
3. Commit, tag `vX.Y.Z`, push the tag, create a GitHub release with the changelog section.
4. Never move a published tag; ship fixes as a new version.

## Requirements

- macOS 14+ on the controlled Mac (Apple silicon or Intel), enrolled in BB.
- BB ≥ 0.49, Plugin SDK ≥ 0.6.132.

## License

MIT — see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Cua Driver is a separate MIT-licensed project by Cua AI, Inc.
