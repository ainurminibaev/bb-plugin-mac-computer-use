# Mac Computer Use — BB plugin

[Русская версия](README.ru.md)

Lets BB agents in any thread, on any enrolled machine, see a Mac's screen and control it like a person: screenshots, clicks, typing, shortcuts, scrolling, launching apps. Built on the open-source [Cua Driver](https://github.com/trycua/cua) (MIT).

## Command line first, GUI last

Agents follow a ladder and pick the lowest rung that works:

1. **Command line that does not drive other apps**, via `bb terminal run --machine <mac>`: shell, `open`, `defaults`, `mdfind`, app CLIs, document files.
2. **Accessibility actions without the mouse** through Cua Driver (`element_token`, `set_value`, `invoke_menu`) — no new macOS prompts.
3. **AppleScript** only through `mac_applescript` and the «BB Automation» helper, so macOS asks «"BB Automation" wants to control "<App>"» instead of naming the BB host process ("node").
4. **GUI** — screen, mouse and keyboard — only when rungs 1–3 cannot do the job.

Agents must not run `osascript` against other apps from `bb terminal`: macOS would then show «"node" wants access to control …» for every app.

GUI tools require a `why_gui` argument: the agent states why the command line and scripting were not enough. The settings screen keeps a journal of GUI actions with these reasons. This plugin controls GUI access only; command access through `bb terminal` is governed by BB itself.

## Sessions without the tools

Agent sessions fix their tool list at start. A session that began before the plugin was installed or updated can use the discoverable RPC instead: `bb plugin rpc call mac-computer-use agent_applescript --input-file req.json` (also `agent_action`, `agent_status`), with the same policy, Stop agent and journal.

## Visible mode

While an agent works, the Mac shows it: the target app comes to the front, the **real pointer** glides to each action point at 60 fps (~0.45 s) with a blue agent arrow labelled «BB · <project>», and a translucent HUD above the Dock shows the goal, live progress (step number, current step, elapsed time) and a Stop button for the whole session. The HUD can be dragged anywhere (position remembered) and hides when the agent's turn ends. It is a non-activating overlay that never takes focus; one process at most, started on demand, it exits when idle or when its parent dies. «Don't touch my mouse» switches to background delivery with the driver's own cursor. Themes: dark (default), light, accent. Agents pass a `goal` once per thread (default: the thread title) and a short `step` per action (default: built from the tool and app).

The caption has a **Stop agent** button: one click revokes GUI access for that thread's session at once; its further GUI calls are refused until the user clicks «Allow again» in Settings (or 12 hours pass). No global hotkey is registered, because it would need an extra macOS Input Monitoring permission; the button and the per-computer switch cover this. Per computer: «Show agent actions» (on by default) and «Bring window to front» (off by default — background work stays the norm).

## Agent tools

| Tool | Purpose |
| --- | --- |
| `mac_screenshot {machine, pid?, window_id?, why_gui, step?, goal?}` | Full-screen screenshot, or one window with its accessibility tree and `snapshot_id`. |
| `mac_action {machine, tool, args, why_gui, step?, goal?}` | Any Cua Driver tool: `list_windows`, `launch_app`, `click`, `type_text`, `hotkey`, `scroll`, `run_steps`, … |
| `mac_applescript {machine, script, why, timeout_s?}` | AppleScript through the «BB Automation» helper (rung 3). |
| `mac_tool_info {machine, tool?}` | Tool list, a tool's arguments, or `status` (driver, macOS permissions, granted access). |

`machine` is a BB machine id (`host_…`) or its exact name. The bundled skill `mac-computer-use` teaches agents the observe → act → verify loop and the safety rules (no sending, buying, deleting or publishing without the user's confirmation; never type passwords).

## Settings → Mac Computer Use → Computers and access

- Grant or revoke GUI access per computer; separately allow screen viewing, actions in apps (Accessibility) and coordinate-based mouse input; optionally restrict to a list of apps (bundle id or name).
- A step-by-step wizard connects a new Mac; a journal lists recent GUI actions with the agent's reason.
- Install or update Cua Driver on a Mac: the release archive is checked against `SHA256SUMS`, `codesign --verify --deep --strict`, the Developer ID team `YCK386LBJ7` (Cua AI, Inc.) and Gatekeeper. Telemetry is turned off.
- macOS permission status and a button that opens the driver's permission guide on the Mac.
- Connection check with a live screenshot.

A computer that is not listed in the access policy is denied. Tools `kill_app`, `clipboard_read`, `set_config`, `install_extension`, `check_for_update`, `replay_trajectory`, `browser_download`, `browser_set_input_files` are blocked by default (`deniedTools`).

## Access survives a BB reinstall

Each access entry stores, besides the BB host ID, stable machine traits: the BB machine name and a salted SHA-256 of the Mac's hardware UUID (the UUID itself never leaves the Mac). After BB is restored with new host IDs, an old entry moves to its Mac automatically only when exactly one current Mac has the same hardware hash. A name-only match or any ambiguity grants nothing: Settings shows «Bind to this computer» for a one-click decision. Every rebind and bind is logged in the action journal.

## Install

```sh
bb plugin install git:https://github.com/ainurminibaev/bb-plugin-mac-computer-use.git@^0.4.0
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
