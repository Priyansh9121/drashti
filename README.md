# Drashti

> Drashti is built independently for use at a BAPS mandir. It is not an official BAPS product.

Drashti (v1.0, package `drashti`) is a presentation app for BAPS mandirs. It replaces ProPresenter 6 on the mandir's Mac and ProPresenter 7 on its Windows PC, on the same machines and the same screens. The plan is in `PLAN.md` at the workspace root.

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
- the **import pipeline** runs in a background worker process: plain-text lyrics, ProPresenter 6 and 7 presentations, templates and themes, playlists and bundles, and media files, with re-import rules, a media folder that stores each file once, and a report kept for every import;
- **importing from the operator window**: drag files or folders onto the presentation list, or use **Import…**; progress, then a migration report with a fix for each item; removing presentations with Delete, and Undo;
- **arrangements** set the order a presentation plays in (a repeated chorus shows and plays each time), chosen per presentation or per playlist item;
- **playlists** in the operator window: imported ones with their folders, headers, media and placeholders, and the operator's own, built by dragging from the library;
- **search** as you type, by title and slide text in English, Gujarati, Hindi and transliteration, ignoring Latin accents (about 3 to 4 ms a query at 5,000 presentations); text in legacy fonts is left out, and the results say so;
- **editing words as plain text**: any presentation's words in the lyrics format, saved back with each slide's look, backgrounds and cues kept, the live slide updated and Undo; "New…" makes a presentation from pasted words;
- **themes**: a look per language (font, size, weight, colour, shadow), the text box's place and alignment, and a background, applied to any number of presentations with one Undo; presentations made in Drashti start with the default theme;
- **props**: a logo or a line of words that stays up whatever slide is live, made from a picture or words, and imported from both older formats' props files;
- **messages**: templates with fields ("Car {plate} please move", or a live timer), filled in and shown on the audience screens, several at once;
- **timers**: countdowns, count-ups, countdowns to a time of day and clocks, started, paused, reset and edited by the operator, shown on the audience screens and the stage; only start, pause and reset are sent, and each window works out the time;
- a **stage screen** for the performers: current and next text, notes, the clock and a stage-only message, in large text;
- **running a sabha from a playlist**: Next and Previous carry on across items (stepping over headers and placeholders), pictures and videos go up as the background and sounds on the audio layer, the next slide shows beside the live one, outputs load the next slide's images and videos ahead, and restart recovery keeps the place in the playlist;
- **media playback**: library media reaches the windows by id only (`drashti-media://`); slide backgrounds play on the background layer and audio cues on the audio layer; images and videos on slides draw everywhere, with still frames for video thumbnails; every screen shows the same frame of a video, and one audio player makes all the sound, on the output chosen in settings;
- **media Drashti cannot play** (ProRes, AVI, HEIC and the like) is found at import, marked, and listed in the report with what to do;
- a rotating **log file** in the data folder, and **Help > Save Diagnostics…** for one file to send after a problem, with no library content;
- **backing up and restoring the library** (File menu): a consistent copy of the library, with the media if wanted, in a folder the operator picks; a restore checks the backup, asks once, keeps the current library under `Backups/` and restarts with nothing live;
- the **slide editor**: text boxes, shapes (rectangles, rounded rectangles, ellipses, lines), pictures and videos on slides, moved, resized, turned and snapped with guides; text styles for a box or its selected words, with full shadows, outlines and shrink-to-fit; typing in place in any language; its own Undo and Redo; one change for the operator's Undo when saved;
- **Simple Mode**: one screen with big buttons for a volunteer (the playlist, Next and Back, Black out, Logo, Clear all and Put it back), which cannot change anything, remembered over a restart;
- a **design system** and a redesigned operator window (see "The design system");
- **restart recovery** of the whole show: after an unexpected stop the slide, background, black-out and place in the playlist come back by themselves, with the sound, props, messages, the stage message and running or paused timers (the sound and timers carry on from where they would be), and a slide moving on by itself carries on with the time it had left;
- **transitions** (a cut, or a dissolve on every screen at once, with the background a slide brings) and **auto-advance** (slides moving on by themselves, looping or not, with the time left shown);
- a **library list** that stays cheap at any size (about 2 ms at 5,000 presentations), and a **performance check** to run by hand on the real machines.

Next (PLAN.md section 5.2): Session 8 is the kirtan library (language tracks, which tracks each screen shows, auto-transliteration, categories and kavi, raag and occasion details; sabha templates; the setup wizard). The importers meet the mandir's own files, and the keys become the operators' own, at the mandir setup after the features are finished.

## The repository is public

`Priyansh9121/drashti` is public: everything pushed, and every CI log, can be read by anyone. So:

- **No secrets, no real content.** No keys, stream keys or passwords; no real kirtan or scripture text; nothing from the mandir's library or a computer's ProPresenter libraries. Tests and screenshots use placeholder text and generated media, and test output about real libraries is counts only. `.gitignore` blocks `.env`, `.mcp.json` and `migration-samples/` as a safety net.
- **Commits use the GitHub noreply address.**
- **Three checks catch a secret:** GitHub secret scanning with push protection (turned on 1 Oct 2026), a gitleaks scan of the whole history before each push (`.githooks/pre-push`; run `pnpm hooks` once in a new clone), and the same scan in CI. gitleaks has no allowlist: nothing in the history needs one.

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

| Command            | What it does                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`         | Run the app with hot reload.                                                                                                 |
| `pnpm build`       | Build main, preload and renderer into `out/`.                                                                                |
| `pnpm test`        | Unit tests (Vitest), run inside Electron's own Node so they use the exact Node, V8 and native-module ABI the app ships with. |
| `pnpm test:e2e`    | Build, then run every Playwright test against the real app.                                                                  |
| `pnpm test:perf`   | Build, then run the performance check (by hand only; see "Performance check").                                               |
| `pnpm test:smoke`  | Build, then run only the smoke test: launch, go live on slide 1, check the output window shows it.                           |
| `pnpm lint`        | ESLint (type-aware) and a Prettier check.                                                                                    |
| `pnpm typecheck`   | TypeScript for the Node side, the web side and the end-to-end tests.                                                         |
| `pnpm format`      | Format everything with Prettier.                                                                                             |
| `pnpm test:audit`  | Tests for the audit kit in `tools/audit/`.                                                                                   |
| `pnpm secret-scan` | Scan the whole git history for secrets (gitleaks, findings redacted). Runs before every push and in CI.                      |
| `pnpm hooks`       | Turn on the git hooks in `.githooks/` for this clone (the secret scan before each push). Run once after cloning.             |
| `pnpm package`     | Build installers into `release/`: `.dmg` and `.zip` on macOS, `.exe` on Windows. They are unsigned for now.                  |

CI runs on GitHub Actions in the public `drashti` repository, where standard runners are free. `.github/workflows/ci.yml` runs typecheck, lint and unit tests on Ubuntu for every push. Every push to `phase1` or `main`, pull requests and manual runs also get unit tests, the end-to-end tests (including the smoke test) and packaging on `macos-latest` and `windows-latest`, and keep the installers for 7 days. A push cancels the run still going on the same branch, so the last push's run is the one that counts. A manual run can pick one OS:

```bash
gh workflow run CI --ref <branch> -f os=windows   # or os=macos, os=both
```

A **secret scan** job runs on every push and pull request: `scripts/secret-scan.mjs` downloads one pinned gitleaks release (its sha256 is written in the script and checked before use), proves on a throwaway repository that a planted token is found and printed redacted, then scans every commit of every branch with `--redact` and fails the run on any finding. The end-to-end jobs wait for it.

Each unit or end-to-end run keeps its temporary files in one folder, `drashti-run-<process id>-…` in the system's temporary folder (`scripts/temp-root.mjs`; TMPDIR, TEMP and TMP point into it for the tests and the apps they start), and removes it at the end. A run that crashed leaves its folder behind; the next run clears it, and any loose `drashti-*` folders over an hour old.

`.github/workflows/audit-kit.yml` tests the audit scripts on both OSes, including under Windows PowerShell 5.1, when they change on `main` or in a pull request, or when started by hand.

### Switches

| Environment variable                | Effect                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DRASHTI_USER_DATA_DIR=<dir>`       | Use this folder for the library and settings (tests use a fresh one each run).                                                                                                        |
| `DRASHTI_WINDOWED_OUTPUTS=1`        | Development only: outputs open as normal windows, to try them on a computer with one screen.                                                                                          |
| `DRASHTI_EXTRA_DISPLAYS=<n>`        | With windowed outputs: up to 4 pretend displays (copies of the main one), to try several outputs on one screen.                                                                       |
| `DRASHTI_DIAGNOSTICS=1`             | Adds a Diagnostics menu with the watchdog self-test and crash buttons.                                                                                                                |
| `DRASHTI_SELFTEST=watchdog`         | Runs the watchdog self-test headless, prints the result and exits (used by the tests).                                                                                                |
| `DRASHTI_SELFTEST=performance`      | Runs the performance check headless in a throwaway library, prints the result and exits (see "Performance check").                                                                    |
| `DRASHTI_SELFTEST=restore-relaunch` | Backs up, asks for a restore and restarts for real, then the new copy checks the library and writes `result.json` into `DRASHTI_SELFTEST_DIR` (used by `scripts/check-relaunch.mjs`). |
| `DRASHTI_NO_QUIT_CONFIRM=1`         | Skips the "Quit Drashti?" question (used by the tests).                                                                                                                               |
| `DRASHTI_LOG_PERMISSIONS=1`         | Logs every permission a page checks or asks for (to see why a sound output cannot be chosen).                                                                                         |
| `DRASHTI_TEST_MEDIA_DELAY_MS=<ms>`  | Tests only: media answers this late (up to 5 s), as from a slow disk.                                                                                                                 |
| `DRASHTI_TEST_NO_RELAUNCH=1`        | Tests only: after Restore Library…, quit instead of restarting (the test starts Drashti again itself).                                                                                |

If you start Drashti from inside another Electron app's process (for example an editor extension), make sure `ELECTRON_RUN_AS_NODE` is not set in that environment. When it's set, Electron starts as plain Node. The end-to-end tests clear it automatically.

## Running a show

1. Open **Screens**, add a group (for example "Main Hall"), and press **Use this display** next to each display that feeds the audience. Set the canvas size and scaling if a screen needs something other than 1920 × 1080 fit. **Identify screens** shows each screen's name on it. The setup is saved and comes back on the next start. If a display is missing at startup, its screen says "Display not connected" and opens by itself when the display returns.
2. Pick a presentation on the left, then click a slide, or press Space or the right arrow, to put it on the screens. The slides fill the middle in play order, flowing on from one group to the next; each has its group's colour beside its number, and the first slide each time a group comes up carries the group's name. The slider above them sets their size (Drashti remembers it).
3. Use the clear buttons along the bottom (or F1 to F7) and **Black-out** (B) at their right. A layer's clear is lit, with a dot, while that layer has something on the screens.

**Simple Mode.** **Simple Mode** in the header (or **View > Switch to Simple Mode**) turns the window into one screen with big buttons for a volunteer: the playlist on the left (pick it at the top), what is on the screens and what comes next, and **Back**, **Next**, **Black out**, **Logo** and **Clear all** along the bottom. The keys keep working, including a presentation clicker's (Page Down and Up, B or .), and Next starts the playlist when nothing is live. **Back** undoes the last Next exactly (one Next too many into a video takes the video down again), as long as nothing else changed in between; otherwise it is Previous. **Black out** and **Logo** cover the picture without clearing it, so pressing them again brings back exactly what was there, and the stage screens keep working. Straight after **Clear all**, **Put it back** (or Cmd/Ctrl+Z) brings everything back, with videos and sound carrying on. Nothing in Simple Mode can change the library, playlists, props, messages, timers, themes, the screens or the sound, and Back Up and Restore leave the File menu: the window does not offer them, and the main process refuses them too (`src/main/simple-mode.ts`). Drashti remembers the mode, so it starts, and comes back after a crash, in Simple Mode. Leaving takes a deliberate step: **View > Switch to Pro Mode…** (on Windows press Alt for the menu bar), then type **pro**. **Logo** shows the prop marked as the logo in Pro Mode (Props, the stamp button), on black, instead of the picture; **L** does the same in both modes, and Pro Mode has **Logo** and, after Clear all, **Put it back** beside the layer clears.

**Importing.** Drag files or folders onto the presentation list, or use **Import…** above it (files, or a whole folder). Progress shows in the status bar along the bottom, with **Cancel**. When the import ends, the report opens, unless a slide is live (then **Report** in the status bar opens it). The report shows what came across and lists each problem with its fix: **Replace**, **Keep both** or **Skip** for a file that changed since it was imported, **Try again**, **Find…** for missing media, and **Open** to check an imported presentation. Earlier reports stay available from the report's list of earlier imports.

**Arrangements.** A presentation plays in the order its arrangement sets: its groups as the arrangement lists them, repeats included, so a chorus sung three times shows three times in the slide grid and comes up each time with Next. Choose another arrangement, or **All slides in order**, above the slides; the choice stays with the presentation. Changing it while the presentation is live keeps the slide on screen, and Next carries on in the new order. Imported presentations keep the arrangement they were set to play in, and lyrics files with a repeated header play as written.

**Playlists.** The top of the left column lists playlists and folders; click one to open it (**‹** goes back). The **New** button (a folder with a plus) beside **Playlists** makes a playlist or a folder (inside the selected folder, or beside the selected playlist) and lets you name it straight away. Drag presentations, or media from the library's **Media** tab, into an open playlist where you want them, or onto a playlist's name to add them at the end. Drag items to reorder them (Cmd/Ctrl-click and Shift-click mark several). **⋯ > Add a header** adds a header; double-click a header or the playlist's name to rename it. Right-click a playlist, folder or item (or use **⋯**, or press Shift+F10 or the Menu key on it) for the rest. Items the import could not find are placeholders, drawn with a dashed amber border and counted as "missing" in the list of playlists: drop a presentation on one to put it there. **Delete** or **Backspace** removes the marked items at once; removing a playlist or a folder (with the playlists in it) asks first. Undo brings back any of these, as it does presentations. Removed playlists and items are deleted for good after 30 days.

**The stage screen.** In **Screens**, set a group to show **The stage view (performers)** instead of the audience picture. Its screens then show, in large text on black: the slide on the screens (**Now**), the slide Next will bring (**Next**, or the next picture or sound, or **End**), the slide's notes when it has any, and the clock. Backgrounds, pictures and videos are never drawn there. In **Stage screen**, under the live picture (it shows a small copy of what the stage screens show), a message for the stage across the top of every stage screen (for example "Two minutes left"); the audience screens never show it, and **Clear all** leaves it, so it goes only with its own **Clear**. There is one layout for now; layouts of one's own are Phase 3.

**Props.** A prop is a logo or a fixed line of words (the mandir's name, say) that stays up over whatever slide is live. Under the live picture, **Props** lists them: **Show** puts one up and **Hide** takes it down (it stays up through Next, and through clearing the slide); **Clear props** (F4) takes them all down. **New prop** makes one from words (size, colour, along the top or the bottom, left, centre or right) or from a picture or video in the library (a corner and a size). Props are laid out on a 1920 × 1080 canvas, and each screen scales them as it does slides. Importing a ProPresenter 6 `Props.pro6` or a ProPresenter 7 `Configuration/Props` file brings its props in (importing it again replaces them); **×** deletes one.

**Messages.** Under the live picture, **New message** (in **Messages**) makes a template: a name, and its words with fields in braces, for example "Car {plate} please move". Each field is typed in when the message is shown, or can show a timer live (choose the timer for the field). To show one, fill in its fields and press **Show**: it goes across the bottom of the audience screens, next to any others already up. **Update** replaces it with what is in the fields now, **Take off** removes it, and **Clear messages** (F5) removes them all. Stage screens never show these messages.

**Timers.** Under the live picture, **New timer** (in **Timers**) makes a countdown (with its length, for example 5:00), a count-up, a countdown to a time of day (for example 19:30), or a clock. Countdowns can keep counting below zero (shown as -0:12) or stop at 0:00. **Start**, **Pause** and **Reset** (or **Stop** for the time of day and the clock); **Edit** changes a timer, even while it runs. **Show on the screens** puts the timer's name and time across the bottom of the audience screens, so a countdown named "Sabha starts in" shows "Sabha starts in 4:59"; **Take off the screens** removes it (as does **Clear messages**, F5). Stage screens show every timer that is running or paused. Only start, pause and reset travel from the engine to the windows; each window works out the time from the clock the windows share, so every screen turns over within a tenth of a second of the others and nothing is sent each second. Timers are kept in the library; whether they are running is not kept over a restart.

**Editing words.** **Edit words**, above the slides, opens the presentation's words as plain text, in the same format lyrics files are imported in: a line in square brackets such as `[Verse 1]` or `[Chorus]` starts a group, a blank line starts a new slide, and a header again with nothing under it repeats that group (the presentation then plays in that "As written" order). Fix words, add or remove slides and groups, or move a group by moving its block, and **Save** (or **Cmd+Enter** on macOS, **Ctrl+Enter** on Windows). Groups are matched by name, and slides by their words, so a slide whose words you changed keeps its look, its background and its cues; a new slide looks like the first slide of its group (or the default look, in a new group). Slides without words (a picture, a blank slide) and hidden slides are not in the text and stay where they are. Arrangements keep the groups that are still there. If the slide on the screens changed, the screens show the new words at once. **Undo** (at the foot of the left column, or **Edit > Undo**) puts the words back as they were. Words typed in a legacy Gujarati or Hindi font open read-only, with the font named, because saving them as plain text would garble them. **New…**, beside the search box, opens the same editor with a name: paste a kirtan's words, press **Make slides**, and it is a presentation in the library.

**Editing slides.** **Edit slides**, beside **Edit words** (or a double-click on a slide), opens the slide editor over the operator window, at the slide on the screens (or the one a search found). The slides are on the left, the slide being edited in the middle (drawn by the same renderer as the screens), and what is selected on the right.

- **Select and move.** Click something to select it (Shift-click adds or takes away; drag across the empty slide to select several). Drag to move: it snaps to the slide's edges and middle and to the edges and middles of the other elements, and pink guides show where; hold **Alt** to place it freely. The square handles resize it (the corner opposite stays put, also when it is turned; pictures and videos keep their proportions, Shift lets them go), and the round handle above turns it (Shift for steps of 15 degrees; it holds at a quarter turn unless Alt is down).
- **The keyboard.** **Tab** selects the next element; the arrows move it a pixel (ten with **Shift**); **Enter** types in a text box; **Delete** removes; **Cmd/Ctrl+D** duplicates; **Esc** stops typing, then lets go of the selection, then closes.
- **Adding.** **Words** adds a text box in the presentation's theme (its place and style; what is typed takes each language's look), **Shape** a rectangle, rounded rectangle, ellipse or line, and **Picture or video** one from the library at its own proportions.
- **The inspector.** Place, size, turn and opacity as numbers; lining up (with each other, or one element with the slide), spacing out evenly, bringing forward and sending back, duplicating and deleting; for words, the language, font, size, weight, italic, colour, a shadow (none, Drashti's soft one, or its own colour, blur and offset), an outline round the letters, and for the whole box its alignment, line spacing and shrink-to-fit. Text styles go to the selected words while typing with words selected, otherwise to the whole box. Shapes have a fill, an outline and a corner radius; pictures and videos their fit, and a video its looping and sound.
- **Typing in place** uses ProseMirror (`src/renderer/src/editor/`, MIT, `LICENSES/editor/`). Gujarati and Hindi input methods work as in any text field; pasted text comes in as plain text. Each run's look travels with its words, so a box's runs come back exactly as they were where nothing changed. Words typed in a legacy font can be moved, resized and turned, but not edited.
- **Slides and groups.** Above the slides: a new slide after the one being edited, a new group, duplicate, move up or down (on into the next group at the end of one), and delete; thumbnails can be dragged to another place or group. With nothing selected, the inspector shows the slide: its label, its group (or a new one), hidden in the show, a colour behind it, its group's name and colour (or deleting the group with its slides), its background picture or video and its sound (cues: they go on the background and audio layers when it goes live), its notes for the stage screens, how it comes on (the presentation's transition, a cut, or a dissolve of so many seconds) and whether it moves on by itself after so many seconds; then the presentation's transition and whether moving on by itself loops back to the first slide; **Give every slide this slide's look** (its colour, its shapes, and the place and style of its words, each language in its look; words never change; one step for Undo); **Make a theme from this slide**; and Drashti's own default transition for presentations without one, a cut until it is changed (it changes at once). Other cues a slide has (clears, messages) are kept as they are.
- **Undo and Redo** inside the editor (the buttons, **Cmd/Ctrl+Z**, **Cmd+Shift+Z** or **Ctrl+Y**; a drag is one step, and arrow-key moves close together are one step). While typing they undo the typing.
- **Save** (or **Cmd/Ctrl+S**) writes the slides as one change: the slide on the screens shows it at once, and **Undo** in the operator window puts all of it back. Saving keeps everything that did not change exactly as stored (a moved element changes only its place), and data Drashti does not know about inside an element stays with it. If the presentation changed somewhere else while it was open (an import, Edit words, a theme), Drashti asks before saving over that. **Cancel**, or closing with changes, asks first, and keeps nothing.

**Themes.** **Themes**, in the header, lists the library's themes; **Drashti default** is the one presentations made in Drashti start with (the words editor's new slides use a presentation's theme too). A theme sets, for English, Gujarati, Hindi and transliteration each, the font (empty uses Drashti's bundled font for that language), size (for a 1080-high slide; other sizes scale), weight, colour and shadow; where the first text box on each slide goes and how its text is aligned; and the background: left as it is, a colour behind every slide, or a picture or video from the library, which becomes a background cue on every slide (so it is up wherever you go live, and carries on from slide to slide). The preview shows a line in each language. To apply a theme, mark presentations in the library (click one, Cmd/Ctrl-click to add more) and press **Apply to …**: each line takes its language's look, the words never change, text typed in a legacy font keeps its font, and a live slide changes at once. **Undo** puts every one of them back. On a presentation from the **Templates** library, **Make a theme from this** (above its slides) makes a theme from its first text box: its place, alignment, each language's look as it has it, and its first slide's background.

**Searching.** Type in the box above the library (**Cmd+F** on macOS, **Ctrl+F** on Windows, goes there): results come as you type, from titles and from the words on the slides, in any of the four languages. Each word you type can be the start of a word ("nam" finds "Namūnā"), and Latin accents do not matter ("namuna" finds "Namūnā"). A result shows the line that matched; opening it (a click, or Enter for the first) selects the presentation and brings that slide into view. **Esc** empties the box. Text typed in a legacy Gujarati or Hindi font cannot be searched until a converter for that font exists: the results say how many presentations have such text, with **Show them** to list them (their titles are still searched).

**Running a sabha from a playlist.** Click an item in the open playlist to see it in the middle: a presentation's slides in the item's order, or the picture, video or sound. Click a slide (or press Space) to start; Next and Previous then go along the presentation and on into the next item, or back to the previous item's last slide, stepping over headers, placeholders and anything missing. A picture or video item goes up as the background and takes the slide off; a sound item plays on the audio layer and leaves the picture as it is. **Shift+→** and **Shift+←** jump to the first slide of the next or previous item. The live item has a red dot, and the middle follows the show from item to item (unless you have clicked away to look at something else). Each presentation item can play in its own arrangement: choose it above its slides; **As the presentation plays** follows the presentation's own choice. Under the live picture, **Next** shows what Next will put up, and every output loads that slide's images and videos ahead, so they appear with its text.

**Backgrounds.** A slide with a background image or video puts it on the background layer when it goes live. It stays up on later slides without a background of their own. A later slide with the same file lets it carry on playing; a different file replaces it, and the old picture stays until the new one has its first frame, so the screens never flash black. **Clear background** (F3) removes it and leaves the text. Videos loop, or play once and hold their last frame, as the slide says. A window that opens late (or the live preview after a reload) starts the video where the others are. If a file cannot play, the screens show no background and the live preview says so.

**Transitions.** Each slide comes on with its own transition, else its presentation's, else Drashti's default (a cut until it is changed; all three are set in the slide editor). A dissolve fades the old slide out as the new one comes in, the new one added light for light over the old (`plus-lighter`), so the picture never dips and nothing goes black; a background picture or video that the slide brings dissolves with it, and one that carries on from the slide before just carries on. The fade is timed from the moment the engine put the slide up, so every screen is at the same point. It starts once the new slide's pictures and videos can be drawn (the old slide stays up meanwhile; the next slide's media is loaded ahead anyway). A screen that opens or reloads after it has finished shows the finished slide. The stage screens always cut, and clearing and black-out are immediate. Recovery after a restart puts the slide back without a fade.

**Auto-advance.** A slide set to move on by itself (in the slide editor) does so after its time, in play order, with its transition and cues as if Next had been pressed. On the last slide it goes back to the first when the presentation loops, and otherwise stays; it never goes on into the next playlist item. Under the live picture (in Pro Mode and Simple Mode) the time left counts down. Anything that puts another slide up (Next, Previous, a click, Back, Put it back) starts that slide's own count; clearing the slide stops it; black-out and the logo leave it counting; editing the live slide keeps its count with the new time. While a slide counts, what is live is saved again every second, so after an unexpected stop it carries on with the time it had left.

**Images and videos on slides** draw on the outputs and in the live preview where the slide places them; a video plays from when its slide goes live. Slide thumbnails show images, and a still frame for each video (with the slide's background behind its text): thumbnails never play video. Drashti makes a video's still frame the first time a thumbnail needs it and keeps it in the media folder.

**Sound.** One hidden audio player plays every sound: a slide's audio cue (on the audio layer, at the cue's volume, looping or not as the cue says, and carrying on through later slides until **Clear audio** (F6) or another sound replaces it), and the sound of the background video and of videos on the live slide, each in step with the picture. The header shows what is on the audio layer, and slide thumbnails mark the slides that start a sound. The screens and the live preview are always silent. Choose where the sound goes (usually the mixer) under **Screens > Sound output**; Drashti remembers the choice. If that output is not connected when Drashti starts (or goes away during a show), sound plays on the system default and a warning stays in the status bar until it is back (the status bar always says where the sound goes). Every screen showing the same video shows the same frame: all windows follow one clock and correct any drift (by playing a few percent faster or slower, or jumping when far out), and a screen that opens late or reloads joins where the others are.

**Removing.** Select presentations in the list (Cmd/Ctrl-click adds one, Shift-click a range) and press **Delete** or **Backspace**. Drashti asks first, and warns when one of them is live, whose slide then stays up until it changes. **Undo** at the foot of the left column, or **Edit > Undo** (Cmd/Ctrl+Z), brings them back. Removed presentations are deleted for good after 30 days.

**Keeping the controls reachable.** Before an output goes on the display the operator window is on, Drashti asks, because the output would cover the controls. If an output ends up over the operator window anyway (a display unplugged or rearranged), the operator window moves to a free display when there is one. **Cmd+Shift+U** (macOS) or **Ctrl+Shift+U** (Windows), "Uncover the controls", turns off any output covering the operator window. It also works when Drashti isn't the active app, and it's in the Window menu.

**Trying Drashti at the mandir.** `docs/parallel-run.md` is the volunteers' guide to the parallel run: checking the Mac's macOS version, installing the builds from CI, importing the ProPresenter library, setting up screens and sound, running a sabha from a playlist, falling back to ProPresenter, saving diagnostics, the performance check and the Windows checks, and a card of the keys.

Every shortcut is defined in one file, `src/shared/keymap.ts`. The current keys are provisional and will be changed to match the ones the operators use in ProPresenter once the setup checklist is back.

## What keeps the screens up (watchdog)

- Every output window is its own renderer process with its own copy of the show state. The operator window crashing, hanging or reloading cannot change what the screens show: they keep their last frame.
- The main process watches every window. A crashed window is reloaded (after about 0.1 s, then with back-off, giving up after 5 crashes in a minute). A window that stays unresponsive for 5 seconds is restarted. A reloaded window picks up the live state at once.
- A crashed _output_ is black for a moment (well under a second here) until the watchdog reloads it, and then shows the live slide again.
- Sound comes from one hidden **audio player** window, a renderer process of its own that the watchdog also watches. The operator window crashing or reloading never touches it, so the sound carries on. If the audio player itself crashes, it is reloaded and rejoins every sound at the right point.
- Closing the operator window while screens are showing asks first, because quitting blacks out every screen.
- While any output is showing, Drashti keeps the displays from sleeping or dimming (a 'prevent-display-sleep' power blocker, which also keeps the screen saver away). It lets go when no output is showing.
- **Diagnostics.** After a problem, **Help > Save Diagnostics…** writes one file to the Desktop (`Drashti diagnostics <date> <time>.txt`) to send to whoever looks after Drashti: the app, Electron and system versions, the displays, screen groups and sound output, library counts, the last 20 imports as counts and issue codes, the watchdog's events since the start, and the log. It never holds library content (no presentation names, slide words or file paths); as a safety net, every name in the library is blanked out of the whole file before it is written.
- **Restart recovery.** What is live (the slide on the screens, the background, black-out, the sound, props, messages, the stage message, and timers that are running or paused) is saved to a small file as it changes, in the background and a quarter of a second at most after the change, never in the way of a slide change. If Drashti itself stops unexpectedly (a crash of the main process, a power cut), the next start opens the screens, puts it all back by itself (a background video, the sound and running timers carry on from where they would be by then; a paused timer keeps its count; a timer deleted meanwhile is left out) and tells the operator what it put back. A slide played from a playlist comes back at its place in the playlist, which opens by itself, so Next carries on into the next item. After a clean quit it starts with nothing live.
- A crash of the main process still blacks out the screens until Drashti is started again. ProPresenter stays installed as the practised fallback until cutover (PLAN.md section 5.1).

**Manual check.** Start Drashti with diagnostics turned on:

```bash
DRASHTI_DIAGNOSTICS=1 pnpm dev                                           # macOS, from the source
DRASHTI_DIAGNOSTICS=1 /Applications/Drashti.app/Contents/MacOS/Drashti   # macOS, installed app
```

```powershell
$env:DRASHTI_DIAGNOSTICS=1; pnpm dev                                     # Windows, from the source
```

Then set up a screen, put a slide live, and choose **Diagnostics > Run Watchdog Self-Test**. It crashes and reloads the operator window, one output and the audio player, then reports each check. Everything should say PASS. You can also try **Diagnostics > Crash the Operator Window** or **View > Reload Operator Window** (Cmd/Ctrl+R) yourself and watch the screens keep their picture.

The same self-test runs headless in the end-to-end tests (`tests/e2e/watchdog.spec.ts`), because Playwright cannot stay attached to a renderer that crashes.

## Performance check

Slide changes must keep reaching the screens within a frame while a big import runs. CI checks everything about that except the timing itself (`tests/e2e/import.spec.ts`: the import runs in its own process, every slide change reaches the output), because CI's virtual machines stall now and then and timing limits there were flaky. The timing limits live in the app's own performance self-test, run by hand:

- **On the mandir's machines**, with the installed app. Close Drashti first. It covers the first display for about half a minute, imports 400 generated placeholder lyrics files into a throwaway library (never the real one) while changing slides every 40 ms, and prints one line.

  ```bash
  # macOS
  DRASHTI_SELFTEST=performance /Applications/Drashti.app/Contents/MacOS/Drashti | grep DRASHTI_PERFTEST_RESULT
  ```

  ```powershell
  # Windows, PowerShell (the usual install folder; otherwise see docs/windows-checks.md, check 7.1)
  $env:DRASHTI_SELFTEST = 'performance'
  Start-Process -Wait -NoNewWindow "$env:LOCALAPPDATA\Programs\drashti\Drashti.exe" -RedirectStandardOutput "$env:TEMP\drashti-perf.txt"
  Select-String DRASHTI_PERFTEST_RESULT "$env:TEMP\drashti-perf.txt"
  ```

  The line is JSON: `passed`, each check with its figure, and a `summary` with every timing. It passes when, during the import, half the slide changes reach a painted frame within 17 ms (one frame at 60 Hz), 9 in 10 within 34 ms, and no more than 2% take over 100 ms. Run it twice and keep the second line with the parallel-run notes: the first run after installing can be slow while the system checks the new app (on the dev Mac the first run of a fresh build failed, and the next two passed easily).

- **From the source**: `pnpm test:perf` runs the same self-test and prints each check.
- **On CI's machines**, by hand: the **Performance** workflow (Actions, then Performance, then Run workflow), for comparing one change with another.

On the dev Mac: 400 files in about 1.1 s, with slide changes during the import at a median of 3 to 4 ms and at worst 19 ms.

Two budgets for the main process are ordinary unit tests at 5,000 generated placeholder presentations, compared by their median so a stall does not fail them: the library list under 20 ms (`src/main/db/library-list.test.ts`, about 2 ms on the dev Mac) and a search query under 15 ms (`src/main/db/search-budget.test.ts`: every keystroke of a typed query and a few others, with 9 in 10 under 30 ms; about 3 to 4 ms median on the dev Mac, about twice that on CI's machines; building the index for all 5,000 takes about 1 s, done once when a library made by an older version first opens).

## Importing

Imports run in a separate worker process (an Electron utility process, `src/main/import/`), one run at a time, at the lowest process priority so the show's processes always come first when the computer is busy. The main process only passes messages along, so slides keep going live during a big import. The end-to-end test imports 400 generated presentations while changing slides every 40 ms. It checks that each change still reaches the output within a frame, and that the import really ran in its own process.

- **Plain-text lyrics** (`.txt`): a blank line starts a new slide, and a line like `[Verse 1]` or `[Chorus]` starts a group. A header repeated with no text after it repeats that group, which gives the presentation an arrangement. Each line gets the language of its script.
- **ProPresenter 6** (`src/main/import/formats/pp6.ts`; formats confirmed against PP6 6.5 files on the dev Mac): `.pro6` presentations with their groups and colours, slides (disabled ones too), arrangements, notes, text boxes (RTF, as styled runs) with their shadows and outlines, filled boxes, rectangles, rounded rectangles and circles with their outlines, images placed on slides, every element's rotation, and each slide's transition and timer (a timer that goes back to the first slide from the last slide is a loop). A transition of type 0 is a dissolve and other kinds dissolve too; the slide timer cue and the transition's place follow the community notes on the format (this Mac's files have neither), so `migration-samples/` will confirm them. Custom shapes, shapes' shadows and boxes that grow to fit their words are counted in the report. `.pro6Template` templates go to a separate **Templates** library, so they never mix with the kirtans. `.pro6pl` playlists keep their folders, headers and media; each presentation they name is linked by its file name, imported then if it was not dropped but can be found, or kept as a placeholder. `.pro6x` and `.pro6plx` bundles are unpacked to a temporary folder, imported with the media inside them, and cleaned up. Its `Props.pro6` file becomes props (one per slide, named by the slide's label). The app's other support files (masks, messages, clocks, stage layouts, CCLI data) get a line of their own in the report.
- **ProPresenter 7** (`src/main/import/formats/pp7.ts`; checked against PP7 18.4 files on the dev Mac): `.pro` presentations (groups, slides, arrangements, notes, text boxes with their shadows, outlines and shrink-to-fit, fills, rectangles, rounded rectangles, ellipses and two-point lines with their outlines, every element's rotation, placed images and videos, background and audio cues, each slide's transition and the presentation's, and each slide's "go to the next slide after" time, where going back to the first slide from the last is a loop), themes (`Themes/<name>/Theme`, to the Templates library), the extensionless playlist files in `Playlists/`, props (`Configuration/Props`), and `.probundle` and `.proplaylist` exports (unpacked like PP6 bundles). The files are Protocol Buffers, read with the community definitions in `third_party/ProPresenter7-Proto` (MIT, recorded there with the commit they come from). `scripts/gen-pp7-descriptor.mjs` turns them into a field table (`pp7-descriptor.json`), and `src/main/import/protobuf.ts` decodes with it. Fields the table does not know are kept and counted, and the report says how many were not imported. On this Mac, one theme file has one such field, which the newer definitions list as removed. The bundle layouts follow the community documentation; they still need confirming with real exports.
- **Legacy fonts** (`src/main/import/legacy-fonts.ts`). Text typed in a legacy (non-Unicode) Gujarati or Hindi font, such as Gopika, Terafont or Kruti Dev (the same list the audit kit uses), keeps its font name and its codes. It is marked legacy, so it is never mistaken for English, and it still shows correctly wherever that font is installed. The report names each font and how many text boxes use it. A converter (a mapping table to Unicode) can be registered per font, and converted text then draws in the bundled fonts. No tables ship yet: the audit shows which fonts the mandir actually uses.
- **Backgrounds are cues.** A slide's background image or video is imported as a background cue on the slide (PLAN.md 4.3), not into the slide: it plays on the background layer, keeps running on later slides without a background of their own, and Clear background removes it while the text stays. Slide audio and other cues are kept the same way.
- **Other files** are listed in the report, one line per file type, never dropped silently. Image, video and audio files go into the media library.
- **Written in small groups.** Each file is parsed into an intermediate model with no database access, then written with its report line. On the Windows CI runner nearly all of an import's time went to commits (129 s of 135 s for 400 presentations), so writes are grouped: a group is committed once it has been open for about 250 ms. Each file is a savepoint inside its group, so one that fails is rolled back alone; if a commit fails, every file of that group is written again on its own. The group is always committed before media is copied, so the library is never locked during a long copy.
- **Arrangements.** Both formats' arrangements come across with the one each presentation was set to play in (ProPresenter 6 `selectedArrangementID`, ProPresenter 7 `selected_arrangement`) and the one a playlist item names. The ProPresenter 6 attributes follow the community documentation of the format: this Mac's library has no arrangements to confirm them, so `migration-samples/` will.
- **Importing again.** A file already imported with the same content is skipped, even from another folder. A changed file is not touched until the operator chooses **replace** (same presentation, new slides; its name and playlists stay) or **keep both** (a second presentation, for example "Song (2)").
- **Media.** Files are copied into the media folder, stored once per sha256 whatever they are called. Drashti checks free space first and always leaves 2 GB free for the show. Missing media is looked for by its original path, then by the same name next to the imported file or in a bundle or collected folder, then anywhere in the imported folders. Anything still missing is kept as a missing item, ready to relink from a folder the operator picks.
- **Media Drashti cannot play.** Each copied file is recognised from its own bytes (`src/main/import/probe.ts`: containers and codecs from their headers, no FFmpeg), and the library marks whether it plays. ProRes, MPEG-4 Part 2, Motion JPEG, DV and other editing codecs in `.mov` or `.mp4`, AVI, WMV, MPEG program and transport streams, Flash video, HEIC and TIFF pictures, AIFF, ADPCM WAV and Apple Lossless sound cannot play: the report lists each one with what to do (export an H.264 MP4, a JPEG or PNG, or an MP3 or AAC), and a slide thumbnail whose background cannot play says so. HEVC, and pictures whose sound cannot play (AC-3, DTS), are marked "not sure": they are tried when used. Converting inside Drashti comes with FFmpeg in Phase 2. On this Mac's ProPresenter 6 library every one of the 187 files found plays except 2 TIFF pictures.
- **Reports.** Every run, each file's outcome and each issue (with its fix) are stored in the library database.
- **This Mac's own libraries.** `src/main/import/real-libraries.test.ts` imports the ProPresenter libraries of the computer running the tests into a temporary library, and prints counts only. It runs when the libraries exist and never in CI. On the dev Mac, ProPresenter 6: 78 files, 17 presentations (16 of them templates), 127 slides, 6 playlists, 198 media files, 0 failures. ProPresenter 7: 32 files, 13 presentations (12 of them themes), 120 slides, 3 playlists, 0 failures.
- **RTF.** Slide text in both presentation formats is RTF. The reader (`src/main/import/rtf/`) keeps paragraphs and line breaks, and per run the font, size, colour, bold, italic, letter spacing, outline and shadow (Cocoa's `\strokewidth` and `\shad` words), plus each paragraph's alignment. It reads `\uN` and `\'hh` escapes in the right code page. Formatting Drashti cannot show yet (underline, text backgrounds, hollow letters and so on) is listed in the report. On this Mac's own libraries it read all 586 RTF texts without an error.

## Screenshots

With placeholder content only, from `tests/e2e/screenshots.spec.ts` (`pnpm build`, then `DRASHTI_SCREENSHOTS=1 pnpm exec playwright test tests/e2e/screenshots.spec.ts`):

- [The operator window at 1920 × 1080](docs/screenshots/operator-1920x1080.png) and [at 1280 × 720](docs/screenshots/operator-1280x720.png)
- [Simple Mode at 1280 × 720](docs/screenshots/simple-mode-1280x720.png), and [after Clear all, with Put it back](docs/screenshots/simple-mode-put-it-back.png)
- [Edit words](docs/screenshots/edit-words.png), [Themes](docs/screenshots/themes.png) and [Screens](docs/screenshots/screens.png)
- [The slide editor](docs/screenshots/slide-editor.png), [with nothing selected (the slide's own settings)](docs/screenshots/slide-editor-slide.png) and [at 1280 × 720](docs/screenshots/slide-editor-1280x720.png)
- [The component gallery](docs/screenshots/component-gallery.png)

![The operator window](docs/screenshots/operator-1920x1080.png)

## The design system

The operator UI is built from one set of tokens and shared components. The rules are in `docs/design.md`, the tokens in `src/renderer/src/styles/app.css` (Tailwind 4 `@theme`), and the components in `src/renderer/src/ui/`.

- **Dark by default**, for dim halls. Colours are named for their job (`panel`, `muted`, `live`, `warning`), and every text colour meets 4.5:1.
- **"Live" looks the same everywhere:** one colour (`live`) and always a label (LIVE, BLACK-OUT, ON SCREENS), never colour alone.
- **The UI font is the bundled Noto Sans with its Gujarati and Devanagari companions**, so names in all three scripts look right offline.
- **Icons are Lucide** (ISC licence, `LICENSES/icons/`), imported only through `src/renderer/src/ui/icons.ts`.
- **The component gallery** shows every component in each state: start Drashti with `DRASHTI_DIAGNOSTICS=1` and choose **Diagnostics > Component Gallery**, or open `/gallery.html` under `pnpm dev`. `tests/e2e/design.spec.ts` runs axe-core on it (no serious or critical findings), and `DRASHTI_GALLERY_SHOTS=<folder>` with that test saves a picture of each section.

## How it fits together

- **Show engine** (`src/main/engine/`). The main process owns the state: the live presentation and slide, the six layers (audio, background, slide, props, messages, masks) and black-out. Commands from the operator are validated (zod), resolved against the library, and applied by a pure reducer. Every change goes out as a patch with a revision number through `EngineTransport` (`src/shared/engine/transport.ts`). Windows keep an `EngineMirror` and ask for a snapshot if they miss a revision. The operator window runs keys and buttons in turn, each once its mirror has the revision the one before it made (`src/renderer/src/operator/actions.ts`), so Next pressed twice quickly at the start of an item goes on to the second slide instead of starting the item again. Phase 3's remote Drashti Nodes will be another transport.
- **Library** (`src/main/db/`). SQLite in WAL mode, one migration per schema version (an existing database is backed up before an upgrade), and a repository that feeds slides to the engine. The library list stays cheap at any size: each presentation keeps its slide count and kirtan languages (written with its content), an index gives the order, and the operator window draws only the rows in view. At 5,000 presentations the list takes about 2 ms in the main process on this Mac; a unit test holds it under 20 ms (`src/main/db/library-list.test.ts`). During an import the list refreshes at most every 2 s.
- **Screens** (`src/main/outputs/`). The output manager matches saved screens to connected displays (by id, then label, then position; never guessing between equal displays) and keeps one frameless, always-on-top, non-focusable window per screen covering its display. Drashti never changes display modes.
- **Rendering** (`src/renderer/src/render/`). `SlideView` draws a slide at its design size; `Scene` composites the layers on a screen's canvas; `placeContent` handles fit, fill and stretch. The operator preview, thumbnails and every output use these components. Outputs record how long each update takes to reach a painted frame (about 6 ms median here). A text box can hold styled runs: each run has its own font, size, colour, weight, italic and language, so one box can carry a large Gujarati line over a smaller italic transliteration. A run without a language gets one from its script (`src/shared/text-runs.ts`), and each run draws with the bundled font for its language unless it names its own. Any element can be turned. Shapes (rectangles, rounded or not, ellipses and lines, with a fill, an outline and opacity) are drawn as SVG, so an outline sits on the edge. Text can have Drashti's soft shadow or one of its own (colour, blur, offset), an outline painted under the letters, both for the whole box or for some words, and shrink-to-fit, which measures the words and makes them smaller until they fit the box (the same on every screen and in thumbnails).

## Where data lives

The library is `drashti.sqlite` in Electron's userData folder: `~/Library/Application Support/Drashti/` on macOS and `%APPDATA%\Drashti\` on Windows. Imported media is in the `Media` folder next to it (each file once, named by its sha256), with the video thumbnails' still frames in `Media/stills/`. `live-state.json` holds what is live, for restart recovery, and `live-state.clean` marks a clean quit. `logs/drashti.log` is the log (versions at each start, errors, watchdog events, imports, display and sound-device changes), rotated at about 2 MB into `drashti.1.log` to `drashti.4.log`. Log lines carry counts and ids, never presentation names, slide text or file paths (the home folder is written as `~`). The audio player keeps its own browser data under `Partitions/drashti-audio`. `Backups/` holds the library from before each restore (`Before restore <date>`, and `Failed restore <date>` when a restored library would not open), and `restore-request.json` is a restore asked for, carried out at the next start. Real ProPresenter data from the mandir machines belongs in `migration-samples/` at the workspace root, outside this repository, and is never committed.

## Backing up and restoring

**File > Back Up Library…** asks for a folder (a drive other than the computer's own is best), then whether to include the media, saying how much there is. It makes a new folder there, `Drashti backup <date> <time>` (in the computer's own time, as the diagnostics file is named), holding:

- `drashti.sqlite`, the library, copied with SQLite's online backup, so it is whole even while a show runs;
- `Media/`, if the media was included (a long copy shows a progress bar under the live preview, and on the Dock or taskbar icon);
- `backup.json`, the Drashti version, schema and time. It is written last: a folder without it is a backup that did not finish, and a backup that fails is removed.

Drashti checks there is room first, keeping 2 GB free when the backup goes on its own disk, and refuses a folder inside its own data folder. The operator is told where the backup went.

**File > Restore Library…** asks for a backup folder and checks it: a finished backup, from this Drashti or an older one. Then it asks once, saying what will happen and that the screens go black while Drashti restarts. At the restart, before the library opens, the backup is copied in beside the current library, the current library (and its media, when the backup brings its own) is kept in `Backups/Before restore <date> <time>`, and only then is the backup swapped in, so a failure on the way leaves the library as it was. The restart quits cleanly without the usual question, so the restored library starts with nothing live, and the operator is told which backup came back and where the old library is. The kept folder is a finished backup itself, so a restore can be undone with Restore Library… too. A backup without media leaves the media folder as it is. Copies an earlier upgrade kept beside the library (`drashti.sqlite.v<N>.bak`) go with it into the kept folder.

If the restored library will not open (a backup damaged in a way the check cannot see, or one whose upgrade fails), Drashti puts the library from before back by itself, with its media and upgrade copies, opens that, and tells the operator. The restored copy that failed goes to `Backups/Failed restore <date> <time>` for whoever looks into it; the backup it came from is not touched.

The code is in `src/main/library/backup.ts` (the work) and `backup-ui.ts` (the questions). The end-to-end test runs a backup, changes the library, restores and starts again, with the quit question switched on. It quits instead of restarting, because a copy of Drashti started by the restart would wait for Playwright. The restart itself is checked by `node scripts/check-relaunch.mjs` (`--packaged` for the app in `release/`), which CI runs on macOS and Windows for the built and the packaged app: Drashti starts with `DRASHTI_SELFTEST=restore-relaunch`, backs up, changes the library, asks for a restore and restarts with `app.relaunch()`, and the copy that starts again checks it is a new process, that the restore was done, and that the library is the backup's.

## Folder layout

| Path                                                            | What lives there                                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/engine/`                                              | Show engine: reducer, commands to actions, slide source.                                                                                     |
| `src/main/db/`                                                  | SQLite: migrations, presentations, playlists, media, search index and screens repositories, seed.                                            |
| `src/main/playlists/`                                           | The playlist requests from the operator window, checked and applied.                                                                         |
| `src/main/library/`                                             | Editing presentations (words as plain text, slides from the editor, themes, kept copies for Undo), and backing up and restoring the library. |
| `src/renderer/src/themes/`                                      | The Themes panel.                                                                                                                            |
| `src/main/outputs/`                                             | Displays, output windows, the output manager and the screens service.                                                                        |
| `src/main/import/`                                              | Importers: the pipeline, the worker process, file formats, the media folder and relinking.                                                   |
| `src/main/media/`                                               | Serving library media to the windows (`drashti-media://`), and still frames for thumbnails.                                                  |
| `src/main/audio/`                                               | The sound output choice (remembered in the library's settings).                                                                              |
| `src/main/transport/`, `src/main/ipc/`                          | IPC transport for engine messages; IPC handler helpers.                                                                                      |
| `src/main/windows/`                                             | Operator window, security and web preferences.                                                                                               |
| `src/main/watchdog.ts`, `selftest.ts`, `perftest.ts`, `menu.ts` | Watchdog, its self-test, the performance self-test, the application menu.                                                                    |
| `src/preload/`                                                  | The preload script: the typed `window.drashti` bridge and nothing else.                                                                      |
| `src/shared/`                                                   | Code for every process: model and IPC contracts, engine state and protocol, scaling, display matching. No Node, DOM or Electron.             |
| `src/renderer/src/operator/`                                    | Operator UI. The single keymap it uses is `src/shared/keymap.ts` (the menu and global shortcuts use it too).                                 |
| `src/renderer/src/output/`                                      | Output window page.                                                                                                                          |
| `src/renderer/src/audio/`                                       | The audio player page: the one place Drashti makes sound.                                                                                    |
| `src/renderer/src/render/`                                      | The shared renderer and bundled fonts.                                                                                                       |
| `src/renderer/src/playlists/`                                   | The playlist panel: the list of playlists, a playlist's items, dragging.                                                                     |
| `src/renderer/src/screens/`, `library/`, `engine/`              | Screens panel, library and engine stores, Undo.                                                                                              |
| `src/renderer/src/ui/`                                          | The design system's shared components (buttons, dialogs, rows, fields, badges, splitters…) and the one icon module (`icons.ts`).             |
| `src/renderer/src/gallery/`, `src/renderer/gallery.html`        | The component gallery, for development (Diagnostics > Component Gallery).                                                                    |
| `src/renderer/src/editor/`                                      | The slide editor: canvas, inspector, typing in place (ProseMirror), its geometry and its own Undo.                                           |
| `tests/e2e/`                                                    | Playwright tests against the built app. Unit tests sit next to the code as `*.test.ts`.                                                      |
| `tests/perf/`                                                   | The performance check, run by hand (`pnpm test:perf`), never in CI.                                                                          |
| `tools/audit/`                                                  | The read-only audit kit for the two ProPresenter machines. See `tools/audit/README.md`.                                                      |
| `docs/`                                                         | The design rules (`docs/design.md`); for the parallel run, the volunteers' guide `docs/parallel-run.md` and `docs/windows-checks.md`.        |
| `third_party/`                                                  | Vendored third-party files with their licences (the ProPresenter 7 protobuf definitions).                                                    |
| `LICENSES/`                                                     | Licences shipped inside the app: the bundled fonts, the Lucide icons, ProseMirror, and the MIT notice for the protobuf definitions.          |

## Security model

Every window runs with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`, and the OS reports the renderers as sandboxed. The preload script exposes one typed object, `window.drashti`. The main process refuses IPC from pages that are not the app's own, validates every argument, and only lets the operator window control the show or change screens. Pages cannot open pop-ups, attach `<webview>`s, navigate away, or get any permission (camera, microphone, notifications and so on), with one exception: the audio player may see the sound outputs and play on one ('speaker-selection', which shows output devices only, never microphones). It has a session of its own and the grant is tied to its window and page. It starts after the operator window, because when it was created first, Chromium 152 sometimes handed the operator window the audio player's list of outputs without asking (the end-to-end test checks that the operator window and outputs see none). The HTML pages carry a strict Content Security Policy (`script-src 'self'`, local fonts only). Pages never see file paths: they load library media by id from `drashti-media://media/<id>`, which the main process answers only with files inside the media folder (streamed in byte ranges, so video can seek; anything else is a 404), and the policy allows that scheme for images and media only, not for `fetch`. Lint rules stop renderer and shared code from importing Electron, Node or main-process modules.

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

**The importers have not met the mandir's files yet.** They are checked against synthetic files and against this Mac's small ProPresenter 6 and 7 libraries, where every file imports. The `.probundle` and `.proplaylist` layouts follow the community documentation and are not confirmed with real exports. `migration-samples/` will settle both.

**Images on a slide load when the slide goes live**, so a large picture can appear a frame or two after the text. Audio cues that loop a set number of times, or for a set time, loop until cleared.

**Sound and picture latency.** Sound and pictures follow the same clock, but the sound output (especially over HDMI or Bluetooth) and the displays each add their own delay. On the mandir's mixer this should be checked by eye and ear; an adjustable sound delay can be added if it is noticeable.

**Disk writes on Windows.** On the Windows CI runner each database commit took about 320 ms (almost certainly real-time antivirus scanning, which the mandir PC probably has too). Imports now write in groups, so this costs seconds instead of minutes. An operator's own change during an import (removing a presentation, changing a screen) can wait up to about a quarter of a second for the current group. Slide changes never write to the database.

**Windows is untested on real hardware.** `docs/windows-checks.md` lists the hand checks for the parallel run. The Windows build, the end-to-end tests and the Windows audit script run in CI on `windows-latest`, and all of them passed there on the first run, including the audit script under Windows PowerShell 5.1. A CI runner has one virtual display and no ProPresenter, so none of this has met a real Windows PC with real screens yet.
