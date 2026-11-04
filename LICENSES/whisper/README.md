# whisper.cpp (third-party notice)

Drashti's live captions (Session 55, Part 10) use **whisper.cpp 1.9.5** (its build `b5454`), a separate program in the app's resources (`Resources/whisper/` on a Mac, `resources\whisper\` on Windows). Drashti runs it as its own process, below the show's priority, on 127.0.0.1 only. It is not linked into Drashti's own code.

| Build                          | From                                                                                                                                                                                                                                                                                                                   | Licence |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Windows, 64-bit                | whisper.cpp's own `whisper-server.exe` and its DLLs, `https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip`                                                                                                                                                                             | MIT     |
| macOS, Apple silicon and Intel | whisper.cpp's prebuilt library `whisper.framework` (from `https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-b5454-xcframework.zip`), with `drashti-whisper`, Drashti's own small program on it (`tools/whisper-server/drashti-whisper.c`), compiled by the Mac's own compiler when it is fetched | MIT     |

Each download is pinned to one SHA-256 in `scripts/fetch-whisper.mjs` and checked before it is unpacked. Nothing of it is ever committed to this repository. The library needs macOS 13.3 or later.

**The models are not bundled.** When an admin turns captions on, Drashti downloads the chosen model once into its own data folder (`speech-models/`), from whisper.cpp's models on Hugging Face (`https://huggingface.co/ggerganov/whisper.cpp`, MIT), pinned to one revision and to each file's SHA-256 (`src/main/speech/models.ts`): `ggml-small.bin` (Standard) or `ggml-large-v3-turbo-q5_0.bin` (Most accurate). They are converted from OpenAI's Whisper models, which are MIT too.

**Copyright:** whisper.cpp is copyright (c) 2023-2026 The ggml authors. Its full licence is in `LICENSE`.

**Source code:** `https://github.com/ggml-org/whisper.cpp`, tag `v1.9.5`.
