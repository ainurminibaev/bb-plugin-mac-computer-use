Any agent in any thread — Claude, Codex or another provider, on any enrolled machine — can look at a Mac's screen and work in its desktop apps the way a person does: take screenshots, click, type, press shortcuts, scroll, launch and switch apps.

Agents follow a **command line first** rule: shell and `osascript` through `bb terminal`, then AppleScript, Shortcuts and app APIs, and the GUI only when nothing else works — with a stated reason.

## What you get

- Agent tools `mac_screenshot`, `mac_action` and `mac_tool_info`. The target Mac is always named explicitly with the `machine` argument.
- A settings screen, **Computers and access**: grant or revoke GUI access per computer, allow screen viewing, in-app actions and coordinate mouse input separately, limit agents to a list of apps, and review a journal of GUI actions with their reasons.
- A visible mode: a highlighted agent cursor and a two-line caption with the goal and the current step, plus a **Stop agent** button that revokes GUI access for that session at once.
- One-click install or update of Cua Driver on a Mac, macOS permission status with a guided fix, and a connection check that shows a live screenshot.
- A bundled skill that teaches agents the observe → act → verify loop and the safety rules.

## How it works

The BB server calls the plugin's host entry on the chosen Mac, which runs the open-source [Cua Driver](https://github.com/trycua/cua) (MIT). The driver works in the background with its own cursor, so the user can keep working. macOS permissions belong to the CuaDriver app, not to BB. Installs are verified by SHA-256 and the Developer ID of Cua AI, Inc. Driver telemetry is turned off.

## Requirements

- A Mac enrolled in BB, macOS 14 or later (Apple silicon or Intel).
- The user turns on Accessibility and Screen Recording for CuaDriver once in System Settings.
- Kill-app, clipboard reading and driver reconfiguration are blocked by default.
