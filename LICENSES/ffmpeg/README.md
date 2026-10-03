# FFmpeg (third-party notice)

Drashti ships **FFmpeg 9.0.2** as a separate program, `ffmpeg` (`ffmpeg.exe` on Windows), in the app's resources (`Resources/ffmpeg/` on a Mac, `resources\ffmpeg\` on Windows). Drashti runs it as its own process, for streaming, recording and converting media. It is not linked into Drashti, and it is not changed.

| Build                | From                                                                                                                    | Licence                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| macOS, Apple silicon | Martin Riedl, `https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip` (signed by its builder) | GPL version 3 (or later) |
| macOS, Intel         | Martin Riedl, `https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip` (signed by its builder) | GPL version 3 (or later) |
| Windows, 64-bit      | Gyan Doshi, `https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip`            | GPL version 3 (or later) |

Each download is pinned to one SHA-256 in `scripts/fetch-ffmpeg.mjs` and checked before it is unpacked. The executables are never committed to this repository.

**Copyright:** FFmpeg is copyright (c) 2000-2026 the FFmpeg developers. The builds also contain other free libraries, under their own licences, among them x264 (GPL), x265 (GPL), libvpx (BSD), OpenSSL (Apache 2.0) on macOS and GnuTLS (LGPL) on Windows, LAME (LGPL), Opus (BSD) and others; each build lists its libraries with `ffmpeg -version`.

**Source code:** the corresponding source is FFmpeg 9.0.2 (`https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz`; the Windows build names commit `946fcce07b` of `https://github.com/FFmpeg/FFmpeg`), with each builder's published build scripts and library versions (`https://git.martin-riedl.de/ffmpeg/build-script` for macOS; `https://www.gyan.dev/ffmpeg/builds/` for Windows). On request, the maintainers of Drashti will provide a copy of the complete corresponding source of the FFmpeg build they distribute, for at least three years after the last time it was distributed.

The full text of the GNU General Public License version 3 is in `GPL-3.0.txt`.

## What the licence means for Drashti

- These are GPL builds (not LGPL) because they include **x264**, the software H.264 encoder Drashti uses when a computer has no hardware encoder that works (VideoToolbox on a Mac; NVENC, Quick Sync or AMF on Windows). An LGPL build would leave such a computer with no good way to stream.
- FFmpeg stays a **separate program** that Drashti starts and talks to through pipes and its command line. The GPL treats a separate program shipped beside another ("an aggregate") as not making that other program GPL, so Drashti's own licence is unaffected.
- What Drashti must do when it hands a copy to anyone (each mandir included): ship this notice and the GPL text with it (they go in the app's `licenses/` folder), point to the source above, and give the source on request. If Drashti ever changed FFmpeg, those changes would have to be published under the GPL too; it does not.
- The GPL covers copyright only. H.264 and AAC are also covered by patents, licensed separately by their pools; that is outside this notice.
