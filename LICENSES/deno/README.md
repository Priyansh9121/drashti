# Deno (third-party notice)

Drashti ships **Deno 2.9.7** as a separate program, in the app's resources (`Resources/deno/` on a Mac, `resources\deno\` on Windows). Drashti never runs it itself for anything but its own check: only yt-dlp (`LICENSES/yt-dlp/`) starts it, to run YouTube's player JavaScript, with no file, network, environment or program access (no `--allow-*` flag), its update check off, and its cache in a Drashti work folder that is emptied afterwards (Session 25c).

| Build                | From                                                                                        | SHA-256 of the download                                            | SHA-256 of the program                                             |
| -------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| macOS, Apple silicon | `https://github.com/denoland/deno/releases/download/v2.9.7/deno-aarch64-apple-darwin.zip`   | `5cd46d6268f6f78f5d88bdc7159d20bd44cdaa4b3303474839f87ec6fe7ae25c` | `b73737579d5a84c160e3316487594783fa5c15f4e13252a6a07050b755317f1a` |
| macOS, Intel         | `https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-apple-darwin.zip`    | `95daaff11c116a52ad54785e7914c8e9c9cdcaba793c5ed929c74ca2d8e6259a` | `325cf9c4b7156f4efd96ad22177a276a4bf4384147d4c9d9f40f9caee28e5719` |
| Windows, 64-bit      | `https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-pc-windows-msvc.zip` | `a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238` | `e020f3e232bd16e33768dee528e5983349c962952051ced0a5d58ad42f5d9b33` |

Each SHA-256 is the one in Deno's own `.sha256sum` files on that release page. `scripts/fetch-youtube-tools.mjs` pins them, checks each download before it is unpacked and the program after, and never commits either. Drashti does not change it (on a Mac it is signed again with the rest of the app).

**Licence:** Deno is under the MIT licence (`LICENSE.md`, from Deno's repository at tag `v2.9.7`). The one program holds Deno's own code and what it is built from:

- **V8**, the JavaScript engine (BSD 3-clause): `V8-LICENSE.txt`, from V8 at the commit Deno's `rusty_v8` 150.4.0 builds (`denoland/v8` `ac1e23989121`).
- **ICU**, for text and dates in many languages (Unicode License V3): `ICU-LICENSE.txt`, from ICU at the commit `rusty_v8` 150.4.0 builds (`chromium/deps/icu` `ee5f27adc28b`).
- the C++ libraries V8 is built with, each under its own licence in its source (`rusty_v8` 150.4.0's `.gitmodules` and `third_party/`, `https://github.com/denoland/rusty_v8`);
- the Rust crates in Deno's `Cargo.lock` at tag `v2.9.7` (`crates.md`: each with the licence it gives on crates.io).

**Source code:** Deno's is `https://github.com/denoland/deno` at tag `v2.9.7` (and `deno_src.tar.gz` on its release page); each crate's is published on crates.io with the crate. None of these licences asks Drashti for more than this notice and the licence texts, which go in the app's `licenses/` folder; the few crates under the Mozilla Public License 2.0 (marked in `crates.md`) ask that their source be available, which it is, from crates.io.

Drashti never updates Deno itself: a newer Deno comes with a newer Drashti.
