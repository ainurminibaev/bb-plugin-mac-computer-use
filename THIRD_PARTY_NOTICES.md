# Third-party notices

This plugin is MIT-licensed (see [LICENSE](LICENSE)). It builds on the
projects below. Licenses were checked on 2026-11-18; versions are pinned in
`package-lock.json`.

## Included in this repository

| Component | Where | License | Copyright |
| --- | --- | --- | --- |
| UI components scaffolded by `bb plugin new` (`components/ui/*`, `lib/utils.ts`, `hooks/*`), based on [shadcn/ui](https://github.com/shadcn-ui/ui) | source files | MIT | © 2026 Michael Yong ([get-bb/bb](https://github.com/get-bb/bb)); © 2023 shadcn |

## Bundled into the built plugin (`dist/`, produced locally by `bb plugin build`)

| Package | License | Copyright |
| --- | --- | --- |
| [@radix-ui/react-checkbox](https://github.com/radix-ui/primitives), @radix-ui/react-slot and other Radix primitives | MIT | © 2022 WorkOS |
| [class-variance-authority](https://github.com/joe-bell/cva) | Apache-2.0 | © 2022 Joe Bell |
| [clsx](https://github.com/lukeed/clsx) | MIT | © Luke Edwards |
| [tailwind-merge](https://github.com/dcastil/tailwind-merge) | MIT | © 2021 Dany Castillo |
| [zod](https://github.com/colinhacks/zod) | MIT | © 2025 Colin McDonnell |

The Apache-2.0 license text is available at https://www.apache.org/licenses/LICENSE-2.0.
class-variance-authority ships no NOTICE file.

## Provided by BB at runtime or used only for development

| Package | License |
| --- | --- |
| [@get-bb/plugin-sdk](https://www.npmjs.com/package/@get-bb/plugin-sdk) (types and runtime host APIs) | MIT |
| React, react-dom | MIT |
| TypeScript, @types/* | Apache-2.0 / MIT |
| sonner, vaul and other scaffold dev dependencies | MIT |

## Not included: Cua Driver

[Cua Driver](https://github.com/trycua/cua) (MIT, © Cua AI, Inc.) is not part
of this repository or of the built plugin. On the user's explicit action in
Settings, the plugin downloads an official release from GitHub, verifies its
SHA-256 checksum, Developer ID team `YCK386LBJ7` and Gatekeeper notarization,
and installs it on that Mac. Cua Driver carries its own license and
third-party notices inside its release archive. The plugin turns the driver's
telemetry off.

## Trademarks

Mac and macOS are trademarks of Apple Inc. This project is not affiliated with
or endorsed by Apple, Cua AI, Inc. or the BB project.
