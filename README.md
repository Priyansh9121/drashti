# Drashti

Drashti (v1.0, package `drashti`) is the presentation app for BAPS mandirs. It replaces ProPresenter 6 on the mandir's Mac and ProPresenter 7 on its Windows PC, on the same machines and the same screens. The plan is in `PLAN.md` at the workspace root.

Stack: Electron, React, TypeScript (strict), Zustand, Tailwind, SQLite (better-sqlite3), Vitest, Playwright, electron-builder and pnpm.

## Setup

You need **Node.js 22.12 or later** and **pnpm 12**. Nothing else: better-sqlite3 ships prebuilt binaries, so no compiler is needed on either OS.

macOS (Terminal):

```bash
cd app
corepack enable pnpm        # or: npm install -g pnpm@12
pnpm install
```

Windows (PowerShell):

```powershell
cd app
corepack enable pnpm        # or: npm install -g pnpm@12
pnpm install
```

The Electron binary downloads the first time something needs it (for example `pnpm dev` or `pnpm test`).

## Commands

| Command           | What it does                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`        | Run the app with hot reload.                                                                                                 |
| `pnpm build`      | Build main, preload and renderer into `out/`.                                                                                |
| `pnpm test`       | Unit tests (Vitest), run inside Electron's own Node so they use the exact Node, V8 and native-module ABI the app ships with. |
| `pnpm test:e2e`   | Build, then run the Playwright tests against the real Electron app.                                                          |
| `pnpm lint`       | ESLint (type-aware) and a Prettier check.                                                                                    |
| `pnpm typecheck`  | TypeScript for the Node side (main, preload, shared, tests) and the web side (renderer, shared).                             |
| `pnpm format`     | Format everything with Prettier.                                                                                             |
| `pnpm test:audit` | Tests for the audit kit in `tools/audit/`.                                                                                   |
| `pnpm package`    | Build installers into `release/` (`.dmg` and `.zip` on macOS, `.exe` on Windows). They are unsigned for now.                 |

Output windows cover their whole display. To try outputs on a computer with a single screen, run `DRASHTI_WINDOWED_OUTPUTS=1 pnpm dev` (macOS) or `$env:DRASHTI_WINDOWED_OUTPUTS=1; pnpm dev` (Windows) to open them as normal windows instead. This is for development only.

If you start these from inside another Electron app's process (for example an editor extension), make sure `ELECTRON_RUN_AS_NODE` is not set in that environment. When it's set, Electron starts as plain Node. The end-to-end tests clear it automatically.

CI (`.github/workflows/ci.yml`) runs install, typecheck, lint, unit tests, end-to-end tests and packaging on `macos-latest` and `windows-latest`, and uploads the installers.

## Running a show (Phase 0)

1. Open **Screens**, add a group (for example "Main Hall"), and press **Use this display** next to each display that feeds the audience. Set the canvas size and scaling if a screen needs something other than 1920 × 1080 fit. The setup is saved and comes back on the next start.
2. Pick a presentation on the left, then click a slide, or press Space or the right arrow, to put it on the screens.
3. Use the clear buttons (or F1 to F7) and **Black-out** (B) on the right.

Every shortcut is defined in one file, `src/renderer/src/operator/keymap.ts`. The current keys are provisional and will be changed to match the ones the operators use in ProPresenter once the setup checklist is back.

## What keeps the screens up (watchdog)

- Every output window is its own renderer process with its own copy of the show state. The operator window crashing, hanging or reloading cannot change what the screens show: they keep their last frame.
- The main process watches every window. A crashed window is reloaded (after about 0.1 s, then with back-off, giving up after 5 crashes in a minute). A window that stays unresponsive for 5 seconds is restarted. A reloaded window picks up the live state at once.
- A crashed _output_ is black for a moment (well under a second here) until the watchdog reloads it, and then shows the live slide again.
- Closing the operator window while screens are showing asks first, because quitting blacks out every screen.
- Not covered yet: a crash of the main process itself ends the app. ProPresenter stays installed as the practised fallback until cutover (PLAN.md section 5.1).

**Manual check.** Start Drashti with diagnostics turned on:

```bash
DRASHTI_DIAGNOSTICS=1 pnpm dev                                        # macOS, from the source
DRASHTI_DIAGNOSTICS=1 /Applications/Drashti.app/Contents/MacOS/Drashti  # macOS, installed app
```

```powershell
$env:DRASHTI_DIAGNOSTICS=1; pnpm dev                                  # Windows, from the source
```

Then set up a screen, put a slide live, and choose **Diagnostics > Run Watchdog Self-Test**. It crashes and reloads the operator window and one output, then reports each check. Everything should say PASS. You can also try **Diagnostics > Crash the Operator Window** or **View > Reload Operator Window** (Cmd/Ctrl+R) yourself and watch the screens keep their picture.

The same self-test runs headless in the end-to-end tests (`tests/e2e/watchdog.spec.ts`) with `DRASHTI_SELFTEST=watchdog`, because Playwright cannot stay attached to a renderer that crashes.

## Folder layout

| Path            | What lives there                                                                            |
| --------------- | ------------------------------------------------------------------------------------------- |
| `src/main/`     | Electron main process: windows, security, and later the show engine, database and displays. |
| `src/preload/`  | The preload script. It exposes the typed `window.drashti` bridge and nothing else.          |
| `src/shared/`   | Contracts used by every process: IPC channel names and payload types. No Node or DOM code.  |
| `src/renderer/` | React UI. `index.html` is the operator window and `output.html` is a screen output.         |
| `tests/e2e/`    | Playwright tests that launch the built app.                                                 |
| `scripts/`      | Small build and test helpers.                                                               |
| `tools/audit/`  | The read-only audit kit for the two ProPresenter machines. See `tools/audit/README.md`.     |

## Security model

Every window runs with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. The preload script exposes one typed object, `window.drashti`. Pages cannot open pop-ups, attach `<webview>`s, navigate away from the app's own pages, or get any permission (camera, notifications and so on). The HTML pages carry a strict Content Security Policy (`script-src 'self'`, local fonts only).

## Open risk: minimum OS versions

Drashti currently targets **Electron 44** (the current stable release). Electron 44 runs on:

- **macOS 13 Ventura or later**, Intel or Apple silicon;
- **Windows 10 or later, 64-bit** (x64 or arm64). Electron 44 dropped 32-bit Windows.

The OS versions of the PP6 Mac and the PP7 PC are unknown until the audit runs. Each audit report says whether its machine can run Electron 44. If the Mac is older, the options are an older Electron line or a macOS upgrade:

| Electron | Oldest macOS it supports |
| -------- | ------------------------ |
| 43       | macOS 12 Monterey        |
| 37       | macOS 11 Big Sur         |
| 32       | macOS 10.15 Catalina     |

Electron only supports its latest three major versions with security fixes, so going back further than 42 means running an unsupported Electron.
