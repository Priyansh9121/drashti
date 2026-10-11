# yt-dlp (third-party notice)

Drashti ships **yt-dlp 2026.08.19** as a separate program, for YouTube in **File › Import from a Link…** (Session 25c). It sits in the app's resources (`Resources/yt-dlp/` on a Mac, `resources\yt-dlp\` on Windows) as yt-dlp's own unpacked build: the program and its `_internal` folder. Drashti starts it as its own process and holds no YouTube downloading code of its own. yt-dlp starts Deno (`LICENSES/deno/`) to run YouTube's player JavaScript.

| Build                                         | From                                                                             | SHA-256 of the download                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| macOS, one folder for Apple silicon and Intel | `https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_macos.zip` | `07e54b0865303c864006925913bce2604f8ee8cc6f18699bac9c309f9328a6d8` |
| Windows, 64-bit                               | `https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_win.zip`   | `30b4c14aafab6082becff7881e41b76df46dc43ea7633479410a91e29da492bf` |

Each SHA-256 is the one in yt-dlp's own `SHA2-256SUMS` for that release, whose GPG signature checks with yt-dlp's `public.key` (key `AC0C BBE6 848D 6A87 3464 AF4E 57CF 6593 3B5A 7581`; checked on 11 Oct 2026). `scripts/fetch-youtube-tools.mjs` pins them and checks each download before it is unpacked. The programs are never committed to this repository.

Drashti changes no file in it. The one thing it does: the Mac zip holds yt-dlp's Python framework without its symbolic links (four copies of the same files), which macOS cannot sign; the fetch script checks the copies are byte for byte the same and puts the links back as yt-dlp's builder makes them.

**Licence:** yt-dlp's own code is under the Unlicense (`LICENSE`). Its standalone builds bundle Python and other projects, listed with their licences in `THIRD_PARTY_LICENSES.txt` (copied from yt-dlp's repository at tag `2026.08.19`; the same file is in each build's `_internal` folder). Among them is GPL code (in the Mac and Windows builds: mutagen 1.48.1, GPL version 2 or later), so, as yt-dlp's README says, "the combined work is licensed under GPLv3+". The full text of the GNU General Public License version 3 is in `../ffmpeg/GPL-3.0.txt`.

**Source code:** each Drashti release carries yt-dlp's source (`yt-dlp-2026.08.19.tar.gz`, yt-dlp's own `yt-dlp.tar.gz` for that release) and mutagen's (`mutagen-1.48.1.tar.gz`, from PyPI), each pinned and checked by `scripts/release-assets.mjs`. The builds were made by the scripts in yt-dlp's repository at tag `2026.08.19` (`https://github.com/yt-dlp/yt-dlp`: `bundle/pyinstaller.py`, `bundle/requirements/` and `.github/workflows/build.yml`). On request, the maintainers of Drashti will provide a copy of the complete corresponding source of the yt-dlp builds they distribute, for at least three years after the last time they were distributed.

## What the licence means for Drashti

- yt-dlp stays a **separate program** that Drashti starts and talks to through its command line and its output. The GPL treats a separate program shipped beside another ("an aggregate") as not making that other program GPL, so Drashti's own licence is unaffected.
- What Drashti must do when it hands a copy to anyone: ship this notice, the licences and the GPL text with it (they go in the app's `licenses/` folder), offer the source with each release, and give it on request.
- Drashti never updates yt-dlp itself: a newer yt-dlp comes with a newer Drashti.
