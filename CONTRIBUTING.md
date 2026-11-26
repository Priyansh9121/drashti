# Working on Drashti

> Drashti is built independently for use at a BAPS mandir. It is not an official BAPS product.

This page is for developers: how to set Drashti up from a fresh clone, run it and its tests, and send a change.
`README.md` is the project's main document (how every part works, and why); `docs/` holds the operator, admin and
presenter guides, the Drashti Manual (`docs/manual/`), the API (`docs/api.md`) and the UI's rules
(`docs/design.md`).

Below, **the owner** is the maintainer: the owner of this repository and of the access list. Ask the owner before
working on Drashti, and before anything this page says needs the owner's yes.

> **Licence.** The repository is public to read, but Drashti has no open-source licence: `package.json` says
> `"license": "UNLICENSED"` and there is no `LICENSE` file. Ask the owner before working on it. The bundled programs
> and libraries keep their own licences (`LICENSES/`, `third_party/`).

## In short

1. Set up with Node.js 22.12 or later and pnpm 12 through corepack (below).
2. Work on a branch of your own, made from `phase1`. Never commit to `main` or `phase1` directly: they take a change
   only through a pull request with one approval.
3. Write the failing test first, then the fix. Run the typecheck, lint and the tests for what you changed. CI runs
   on every push.
4. Keep the rules: nothing paid; no new dependency or download without the owner's yes; no `Co-Authored-By` lines;
   no secrets, `.env` files, `.mcp.json` or stream keys; placeholder words only in tests and pictures.
5. Open a pull request against `phase1`. Only the owner and the release lead publish a release.

## What Drashti is

A presentation app for a mandir's sabha. One operator computer, a Mac or a Windows PC, drives the hall's screens,
the stage screens, a live stream and its recording, phones and tablets on the local network, and output nodes (other
computers whose screens show what Main shows). It is built with Electron 44, React 19, TypeScript (strict), Zustand,
Tailwind 4, SQLite (better-sqlite3), Vitest, Playwright, electron-builder and pnpm 12.

## Set up from a fresh clone

You need **Git**, **Node.js 22.12 or later** (`engines` in `package.json`; CI uses Node 22) and **pnpm 12**
(`packageManager`: pnpm 12.6.0, which corepack gives you). If Node did not include Corepack, install Corepack first,
or use the pinned pnpm version below. No compiler is needed for the app itself: better-sqlite3 ships prebuilt
binaries for both systems. Drashti runs on macOS 13 or later and on Windows 10 or 11 (64-bit).

macOS (Terminal):

```bash
git clone --branch phase1 https://github.com/Priyansh9121/drashti.git
cd drashti
corepack enable pnpm        # or: npm install -g pnpm@12.6.0
pnpm install
pnpm hooks                  # once: the secret scan before every push
```

Windows (PowerShell):

```powershell
git clone --branch phase1 https://github.com/Priyansh9121/drashti.git
cd drashti
corepack enable pnpm        # or: npm install -g pnpm@12.6.0
pnpm install
pnpm hooks                  # once: the secret scan before every push
```

Electron's own program downloads the first time something needs it (`pnpm dev` or `pnpm test`).

**The bundled programs** are never in Git. Each script downloads one pinned version, checks it against its SHA-256,
keeps the download in `~/.cache/drashti/` and puts the program in `vendor/`:

```bash
node scripts/fetch-ffmpeg.mjs            # FFmpeg: streaming, recording, conversions, and the FFmpeg unit tests
node scripts/fetch-youtube-tools.mjs     # yt-dlp and Deno: YouTube in File › Import from a Link…
node scripts/check-ffmpeg.mjs            # Drashti finds and runs them
```

Only for packaging, or for the feature each serves:

```bash
node scripts/fetch-whisper.mjs           # live captions (on a Mac it compiles a small program with the Mac's clang)
node scripts/fetch-video-out.mjs         # Send to other software: built from pinned Syphon or Spout sources
                                         # (the Mac's clang, or Visual Studio's compiler on Windows)
```

Windows captions also need the Visual Studio x64 C++ and OpenMP redistribution files; the fetch script stages
them beside Whisper. Build the video-out helper on the system it is for: Mac on Mac, Windows on Windows.

On an Apple-silicon Mac, `--target darwin-x64` fetches the Intel Mac's copy too, for packaging both.

After setup, run `pnpm typecheck` and `pnpm test`, then `pnpm dev`. The access step below is needed to use the window.

## Commands

| Command            | What it does                                                                     |
| ------------------ | -------------------------------------------------------------------------------- |
| `pnpm dev`         | Run Drashti with hot reload (it opens only once this computer is let in: below). |
| `pnpm build`       | Build main, preload and the pages into `out/`.                                   |
| `pnpm test`        | The unit tests (Vitest), inside Electron's own Node.                             |
| `pnpm typecheck`   | TypeScript for the Node side, the pages and the end-to-end tests.                |
| `pnpm lint`        | ESLint (no warnings allowed) and a Prettier check.                               |
| `pnpm format`      | Format everything with Prettier.                                                 |
| `pnpm test:smoke`  | Build, then the smoke test: start Drashti, put slide 1 up, see the output.       |
| `pnpm test:e2e`    | Build, then every end-to-end test (CI runs these: see below).                    |
| `pnpm package`     | Build unsigned installers into `release/`.                                       |
| `pnpm secret-scan` | Scan the whole history for secrets (it runs before every push and in CI).        |

README's "Commands" has them all, and the switches (`DRASHTI_*`) under "Switches".

## Tests

- **Unit tests:** `pnpm test`, or one folder or file: `pnpm test src/main/engine`. They are Vitest tests, and they
  run inside Electron's own Node (`scripts/vitest-electron.mjs`), so they use the Node, V8 and native modules the app
  ships with. Some FFmpeg tests skip where FFmpeg has not been fetched; others need it to make their fixtures and
  fail without it. Fetch FFmpeg before running the full suite; on CI's Mac and Windows a missing FFmpeg fails the
  checks.
- **End-to-end tests** are Playwright tests that start the real app. The whole suite runs on CI. On a computer
  someone is using, run one spec at a time, after a build: `pnpm build`, then
  `pnpm exec playwright test tests/e2e/smoke.spec.ts`. Runs outside CI are quiet: Drashti never comes to the front,
  covers the screen or makes a sound, and the few tests that need real focus or a whole display skip themselves.
  `DRASHTI_E2E_LOUD=1` runs those too, only when whoever uses the computer agrees. The tests that open the phones'
  and other devices' pages in a browser need Playwright's browsers once:
  `pnpm exec playwright install chromium webkit`.
- **No access, no internet, no real data.** Every Drashti a test starts is let in by a stand-in access list of its
  own on 127.0.0.1 (`tests/e2e/access.ts`, `tests/access-standin.ts`), never the real one, and has a data folder of
  its own with placeholder content. Never point a test, a self-test or the performance check at a real library or a
  real Drashti data folder, and never stream to the internet from a test.
- **The word tests.** The guides, the Manual and README are tested too: one name for each action, the words as they
  are written, every guide linked (`src/main/guides.test.ts`, `guide.test.ts`, `words.test.ts`, `strings.test.ts`,
  `books-words.test.ts`, `editor-guide.test.ts` and the others under `src/main/`). They run with the unit tests.
- **CI** (GitHub Actions, `.github/workflows/ci.yml`) runs on every push: typecheck, lint, the unit tests and the
  secret scan on Ubuntu. Pushes to `phase1` and `main`, and pull requests, also run the unit and end-to-end tests
  and packaging on macOS and Windows (each in three parts), and the suite again on Windows in the Black appearance.
  A push to any other branch gets the Ubuntu checks and the secret scan only, so open the pull request to see the
  Mac and Windows results. A test that passes only on its retry fails the run (`failOnFlakyTests`), and so does a
  `.only` left in.

## Branches and pull requests

**Work on a branch of your own.** Start it from the current working branch:

```bash
git fetch origin
git switch phase1
git pull --ff-only origin phase1
git switch -c your-change
```

After the failing test and fix are committed, run `pnpm typecheck`, `pnpm lint` and the tests for the changed
feature. Push the branch to this repository if the owner has given you write access (or to your fork), then open a
pull request with **base: phase1**. Say what changed, the test that failed before the fix, and what you checked on
each system. If you could check only one system, say so and ask the owner for the other CI result.

- **`phase1`** is the working branch. Start every branch from it, and open every pull request against it.
- **`main`, `phase1` and `release-dry-run` are protected** on GitHub. A change reaches them only through a pull
  request with one approval, given after its last push by someone other than whoever pushed it; a new push
  dismisses an earlier approval. Nobody force-pushes to them or deletes them. Release tags (`v…`) cannot be moved or
  deleted.
- **`main` moves only at a release**: the owner moves it to the release commit. Never open a pull request against
  `main`, and never force-push.
- `gh-pages` holds the access list's link page and `release-dry-run` the release workflow's dry run: leave them alone.
- Small commits with plain messages that say what changed and why. Commit with your GitHub noreply address, and with
  no `Co-Authored-By` lines.
- **The CHANGELOG is the owner's.** Put your change's one line, in plain words for operators, in the pull request's
  description.
- The owner reviews, merges into `phase1` and runs the full CI before a release.

## Releases

Only the owner and the release lead publish a release. The **Release** workflow (`.github/workflows/release.yml`)
publishes only when it is started by hand from `main` with **publish** ticked, and only past the release gate: the
tag new, the commit `main`, a CI run from a push of it green on every app job, and every file as its checksums say.
Started any other way, or on a push to `release-dry-run`, it is a dry run that publishes nothing.

So never start the Release workflow, push a `v…` tag, move `main`, or edit a release or its notes. A release's notes
are its section of `CHANGELOG.md`, which the owner writes.

## Rules

- **Nothing paid.** No paid product, service, plan or licence, anywhere. (So the installers are unsigned: signing
  needs paid certificates.)
- **No new dependency or download without the owner's yes.** A new package, a bundled program, a model or a font is
  agreed with the owner first, and is free and open-licensed. Whatever a script downloads is pinned to one version
  and checked against its SHA-256 before use, as `scripts/fetch-*.mjs` do.
- **No `Co-Authored-By` lines** in any commit, whoever or whatever helped write it.
- **No secrets, ever:** no keys, stream keys, tokens, passwords, PINs, pairing codes, certificates or Gmail
  addresses in the code, a commit, a test or a CI log. Never commit a `.env` file or `.mcp.json`: `.gitignore` blocks
  `.env`, `.env.*`, `.mcp.json` and `migration-samples/` as a safety net, so never force-add them. The repository and
  every CI log are public, and a pushed secret is public at once: `pnpm hooks` turns on the scan before each push.
- **Placeholder words only** in tests, fixtures, pictures (screenshots) and commits: placeholder names, places and
  words, and generated media. Never real names, places or private content: no real kirtan or scripture text,
  darshan pictures, a mandir's content, calendars, decks or music, no real camera pictures or sound, and never a
  real computer's name (`DRASHTI_TEST_COMPUTER_NAME` gives the tests one).
- **A failing test first.** Commit the failing test on its own (its message starting "Red"), see it fail for the right
  reason, then fix it and see it pass.
- **Never loosen a check to get green:** no raised time limit or budget, no skip, no retry, no longer timeout, no
  change to `failOnFlakyTests`. CI's bar guard lists such lines in the run's summary.
- **Mac and Windows both.** `path.win32`/`path.posix` for the other system's paths, Cmd on the Mac and Ctrl on
  Windows, and Windows hides the menu bar. CI's operator window is about 1024 × 645.
- **The show comes first.** Nothing may make the hall's screens, the stream, recovery or start-up less safe; a new
  feature is off until someone turns it on.
- **Words.** A feature's words go in the operator guide, the admin guide, `docs/api.md` and README, in plain words;
  the word tests (above) must pass.

## Why a source build won't open on your computer: the access list

Drashti opens only on a computer the owner's access list has let in (README's "Access by Gmail",
`docs/access-setup.md`, `access-list/PROTOCOL.md`), and needs the internet to check it. A build from source has the
real list's address and public key built in (`src/shared/access-config.ts`; neither is a secret) and asks it as an
installed Drashti does. Until your computer is let in, the lock window ("Let this computer in") opens in Drashti's
place. Today there are two ways to work:

1. **The owner lets your Gmail in.** In the lock window, **Request Access** with your Gmail; the owner approves it;
   you get a one-time token by email, and **I Have a Token** lets this computer in. A token works once, for its own
   Gmail and one computer, and runs out after 3 days unused.
2. **The tests and self-tests need no access.** The unit tests, and the end-to-end tests with their stand-in list,
   run without it, and a self-test (`DRASHTI_SELFTEST`, README's "Switches") opens at once with its controls locked,
   never asking. The performance check is the exception: it runs only on a computer let in.

> **Opening a source build.** It opens only on a computer the owner has let in through the access list, as above:
> ask the owner.
