# Drashti

Drashti (v1.0, package `drashti`) is the presentation app for BAPS mandirs. It replaces ProPresenter 6 on the mandir's Mac and ProPresenter 7 on its Windows PC, on the same machines and the same screens. The plan is in `PLAN.md` at the workspace root.

Stack: Electron 44, React 19, TypeScript 6 (strict), Zustand, Tailwind 4, SQLite (better-sqlite3), Vitest, Playwright, electron-builder and pnpm 12.

## Status

Phase 0 (foundations) is in place:

- the read-only **audit kit** for the two ProPresenter machines (`tools/audit/`);
- the **show engine** in the main process: versioned, serializable state sent as snapshots and patches through a transport interface;
- the **SQLite library** with the full core model, migrations and two placeholder presentations;
- **screens**: displays as the OS reports them, screen groups, a canvas size and scaling per screen, and one output window per assigned display, restored on restart;
- one **shared renderer** with bundled Noto fonts, used by the operator preview, the thumbnails and every output;
- a minimal **operator UI** with a single keymap, and an **output watchdog**.

Phase 1 has started:

- text boxes hold **styled runs** (font, size, colour, weight and language per run);
- the **import pipeline** runs in a background worker process: plain-text lyrics and media files so far, with re-import rules, a media folder that stores each file once, and a report kept for every import.

Next: drag-and-drop and the import report in the operator window, then the ProPresenter 6 and 7 importers, built against the audit results and the files in `migration-samples/`.

## Setup

You need **Node.js 22.12 or later** and **pnpm 12**. Nothing else: better-sqlite3 ships prebuilt Node-API binaries, so no compiler is needed on either OS.

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
| `pnpm test:e2e`   | Build, then run every Playwright test against the real app.                                                                  |
| `pnpm test:smoke` | Build, then run only the smoke test: launch, go live on slide 1, check the output window shows it.                           |
| `pnpm lint`       | ESLint (type-aware) and a Prettier check.                                                                                    |
| `pnpm typecheck`  | TypeScript for the Node side, the web side and the end-to-end tests.                                                         |
| `pnpm format`     | Format everything with Prettier.                                                                                             |
| `pnpm test:audit` | Tests for the audit kit in `tools/audit/`.                                                                                   |
| `pnpm package`    | Build installers into `release/`: `.dmg` and `.zip` on macOS, `.exe` on Windows. They are unsigned for now.                  |

CI runs on GitHub Actions in the private `drashti` repository. `.github/workflows/ci.yml` runs typecheck, lint and unit tests on Ubuntu for every push. Pull requests, pushes to `main` and manual runs also get unit tests, the end-to-end tests (including the smoke test) and packaging on `macos-latest` and `windows-latest`, and keep the installers for 7 days. macOS minutes count ten times and Windows minutes twice on a private repository, which is why those jobs don't run on every push. A manual run can pick one OS:

```bash
gh workflow run CI --ref <branch> -f os=windows   # or os=macos, os=both
```

`.github/workflows/audit-kit.yml` tests the audit scripts on both OSes, including under Windows PowerShell 5.1, when they change on `main` or in a pull request, or when started by hand.

### Switches

| Environment variable          | Effect                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `DRASHTI_USER_DATA_DIR=<dir>` | Use this folder for the library and settings (tests use a fresh one each run).               |
| `DRASHTI_WINDOWED_OUTPUTS=1`  | Development only: outputs open as normal windows, to try them on a computer with one screen. |
| `DRASHTI_DIAGNOSTICS=1`       | Adds a Diagnostics menu with the watchdog self-test and crash buttons.                       |
| `DRASHTI_SELFTEST=watchdog`   | Runs the watchdog self-test headless, prints the result and exits (used by the tests).       |
| `DRASHTI_NO_QUIT_CONFIRM=1`   | Skips the "Quit Drashti?" question (used by the tests).                                      |

If you start Drashti from inside another Electron app's process (for example an editor extension), make sure `ELECTRON_RUN_AS_NODE` is not set in that environment. When it's set, Electron starts as plain Node. The end-to-end tests clear it automatically.

## Running a show (Phase 0)

1. Open **Screens**, add a group (for example "Main Hall"), and press **Use this display** next to each display that feeds the audience. Set the canvas size and scaling if a screen needs something other than 1920 × 1080 fit. **Identify screens** shows each screen's name on it. The setup is saved and comes back on the next start. If a display is missing at startup, its screen says "Display not connected" and opens by itself when the display returns.
2. Pick a presentation on the left, then click a slide, or press Space or the right arrow, to put it on the screens.
3. Use the clear buttons (or F1 to F7) and **Black-out** (B) on the right.

**Keeping the controls reachable.** Before an output goes on the display the operator window is on, Drashti asks, because the output would cover the controls. If an output ends up over the operator window anyway (a display unplugged or rearranged), the operator window moves to a free display when there is one. **Cmd+Shift+U** (macOS) or **Ctrl+Shift+U** (Windows), "Uncover the controls", turns off any output covering the operator window. It also works when Drashti isn't the active app, and it's in the Window menu.

Every shortcut is defined in one file, `src/renderer/src/operator/keymap.ts`. The current keys are provisional and will be changed to match the ones the operators use in ProPresenter once the setup checklist is back.

## What keeps the screens up (watchdog)

- Every output window is its own renderer process with its own copy of the show state. The operator window crashing, hanging or reloading cannot change what the screens show: they keep their last frame.
- The main process watches every window. A crashed window is reloaded (after about 0.1 s, then with back-off, giving up after 5 crashes in a minute). A window that stays unresponsive for 5 seconds is restarted. A reloaded window picks up the live state at once.
- A crashed _output_ is black for a moment (well under a second here) until the watchdog reloads it, and then shows the live slide again.
- Closing the operator window while screens are showing asks first, because quitting blacks out every screen.
- While any output is showing, Drashti keeps the displays from sleeping or dimming (a 'prevent-display-sleep' power blocker, which also keeps the screen saver away). It lets go when no output is showing.
- Not covered yet: a crash of the main process itself ends the app. ProPresenter stays installed as the practised fallback until cutover (PLAN.md section 5.1).

**Manual check.** Start Drashti with diagnostics turned on:

```bash
DRASHTI_DIAGNOSTICS=1 pnpm dev                                           # macOS, from the source
DRASHTI_DIAGNOSTICS=1 /Applications/Drashti.app/Contents/MacOS/Drashti   # macOS, installed app
```

```powershell
$env:DRASHTI_DIAGNOSTICS=1; pnpm dev                                     # Windows, from the source
```

Then set up a screen, put a slide live, and choose **Diagnostics > Run Watchdog Self-Test**. It crashes and reloads the operator window and one output, then reports each check. Everything should say PASS. You can also try **Diagnostics > Crash the Operator Window** or **View > Reload Operator Window** (Cmd/Ctrl+R) yourself and watch the screens keep their picture.

The same self-test runs headless in the end-to-end tests (`tests/e2e/watchdog.spec.ts`), because Playwright cannot stay attached to a renderer that crashes.

## Importing

Imports run in a separate worker process (an Electron utility process, `src/main/import/`), one run at a time. The main process only passes messages along, so slides keep going live during a big import. The end-to-end test imports 400 generated presentations while changing slides every 40 ms. It checks that each change still reaches the output within a frame, and that the import really ran in its own process.

- **Formats so far.** Plain-text lyrics (`.txt`): a blank line starts a new slide, and a line like `[Verse 1]` or `[Chorus]` starts a group. A header repeated with no text after it repeats that group, which gives the presentation an arrangement. Each line gets the language of its script. Image, video and audio files go into the media library. Other files are listed in the report, one line per file type, and never dropped silently.
- **One transaction per presentation.** Each file is parsed into an intermediate model with no database access. The presentation and its report line are then written together, so a failure never leaves half a presentation behind.
- **Importing again.** A file already imported with the same content is skipped, even from another folder. A changed file is not touched until the operator chooses **replace** (same presentation, new slides; its name and playlists stay) or **keep both** (a second presentation, for example "Song (2)").
- **Media.** Files are copied into the media folder, stored once per sha256 whatever they are called. Drashti checks free space first and always leaves 2 GB free for the show. Missing media is looked for by its original path, then by the same name next to the imported file or in a bundle or collected folder, then anywhere in the imported folders. Anything still missing is kept as a missing item, ready to relink from a folder the operator picks.
- **Reports.** Every run, each file's outcome and each issue (with its fix) are stored in the library database.

## How it fits together

- **Show engine** (`src/main/engine/`). The main process owns the state: the live presentation and slide, the six layers (audio, background, slide, props, messages, masks) and black-out. Commands from the operator are validated (zod), resolved against the library, and applied by a pure reducer. Every change goes out as a patch with a revision number through `EngineTransport` (`src/shared/engine/transport.ts`). Windows keep an `EngineMirror` and ask for a snapshot if they miss a revision. Phase 3's remote Drashti Nodes will be another transport.
- **Library** (`src/main/db/`). SQLite in WAL mode, one migration per schema version (an existing database is backed up before an upgrade), and a repository that feeds slides to the engine.
- **Screens** (`src/main/outputs/`). The output manager matches saved screens to connected displays (by id, then label, then position; never guessing between equal displays) and keeps one frameless, always-on-top, non-focusable window per screen covering its display. Drashti never changes display modes.
- **Rendering** (`src/renderer/src/render/`). `SlideView` draws a slide at its design size; `Scene` composites the layers on a screen's canvas; `placeContent` handles fit, fill and stretch. The operator preview, thumbnails and every output use these components. Outputs record how long each update takes to reach a painted frame (about 6 ms median here). A text box can hold styled runs: each run has its own font, size, colour, weight, italic and language, so one box can carry a large Gujarati line over a smaller italic transliteration. A run without a language gets one from its script (`src/shared/text-runs.ts`), and each run draws with the bundled font for its language unless it names its own.

## Where data lives

The library is `drashti.sqlite` in Electron's userData folder: `~/Library/Application Support/Drashti/` on macOS and `%APPDATA%\Drashti\` on Windows. Imported media is in the `Media` folder next to it. Real ProPresenter data from the mandir machines belongs in `migration-samples/` at the workspace root, outside this repository, and is never committed.

## Folder layout

| Path                                                      | What lives there                                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/engine/`                                        | Show engine: reducer, commands to actions, slide source.                                                                         |
| `src/main/db/`                                            | SQLite: migrations, presentations and screens repositories, seed.                                                                |
| `src/main/outputs/`                                       | Displays, output windows, the output manager and the screens service.                                                            |
| `src/main/import/`                                        | Importers: the pipeline, the worker process, file formats, the media folder and relinking.                                       |
| `src/main/transport/`, `src/main/ipc/`                    | IPC transport for engine messages; IPC handler helpers.                                                                          |
| `src/main/windows/`                                       | Operator window, security and web preferences.                                                                                   |
| `src/main/watchdog.ts`, `selftest.ts`, `menu.ts`          | Watchdog, its self-test, the application menu.                                                                                   |
| `src/preload/`                                            | The preload script: the typed `window.drashti` bridge and nothing else.                                                          |
| `src/shared/`                                             | Code for every process: model and IPC contracts, engine state and protocol, scaling, display matching. No Node, DOM or Electron. |
| `src/renderer/src/operator/`                              | Operator UI. The single keymap it uses is `src/shared/keymap.ts` (the menu and global shortcuts use it too).                     |
| `src/renderer/src/output/`                                | Output window page.                                                                                                              |
| `src/renderer/src/render/`                                | The shared renderer and bundled fonts.                                                                                           |
| `src/renderer/src/screens/`, `library/`, `engine/`, `ui/` | Screens panel, library and engine stores, small UI parts.                                                                        |
| `tests/e2e/`                                              | Playwright tests against the built app. Unit tests sit next to the code as `*.test.ts`.                                          |
| `tools/audit/`                                            | The read-only audit kit for the two ProPresenter machines. See `tools/audit/README.md`.                                          |
| `docs/`                                                   | Hand checks, starting with `docs/windows-checks.md` for the Windows PC during the parallel run.                                  |
| `LICENSES/`                                               | Licences for bundled fonts (shipped inside the app).                                                                             |

## Security model

Every window runs with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`, and the OS reports the renderers as sandboxed. The preload script exposes one typed object, `window.drashti`. The main process refuses IPC from pages that are not the app's own, validates every argument, and only lets the operator window control the show or change screens. Pages cannot open pop-ups, attach `<webview>`s, navigate away, or get any permission (camera, notifications and so on). The HTML pages carry a strict Content Security Policy (`script-src 'self'`, local fonts only). Lint rules stop renderer and shared code from importing Electron, Node or main-process modules.

## Open risks

**Minimum OS versions.** Drashti currently targets **Electron 44** (the current stable release). Electron 44 runs on:

- **macOS 13 Ventura or later**, Intel or Apple silicon;
- **Windows 10 or later, 64-bit** (x64 or arm64). Electron 44 dropped 32-bit Windows.

The OS versions of the PP6 Mac and the PP7 PC are unknown until the audit runs. Each audit report says whether its machine can run Electron 44. If the Mac is older, the options are an older Electron line or a macOS upgrade:

| Electron | Oldest macOS it supports |
| -------- | ------------------------ |
| 43       | macOS 12 Monterey        |
| 37       | macOS 11 Big Sur         |
| 32       | macOS 10.15 Catalina     |

Electron only supports its latest three major versions with security fixes, so going back further than 42 means running an unsupported Electron.

**Unsigned installers.** macOS Gatekeeper and Windows SmartScreen will warn when the installers are first opened. Signing belongs with internal distribution (PLAN.md section 4).

**Windows is untested on real hardware.** `docs/windows-checks.md` lists the hand checks for the parallel run. The Windows build, the end-to-end tests and the Windows audit script run in CI on `windows-latest`, and all of them passed there on the first run, including the audit script under Windows PowerShell 5.1. A CI runner has one virtual display and no ProPresenter, so none of this has met a real Windows PC with real screens yet.
