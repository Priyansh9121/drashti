# Spout (third-party notice)

On Windows, Drashti's video out (x30, 19 Nov 2026) sends the stream's picture to other apps on the same computer by
**Spout**. `drashti-video-out.exe`, a separate program in the app's resources (`resources\video-out\`), is Drashti's
own small program (`tools/video-out/drashti-video-out-win.cpp`) with Spout's SpoutDX and the parts of SpoutGL it is
built with compiled in, by Visual Studio's compiler, when it is built (`scripts/fetch-video-out.mjs`): `SpoutDX`,
`SpoutCopy`, `SpoutDirectX`, `SpoutFrameCount`, `SpoutSenderNames`, `SpoutSharedMemory` and `SpoutUtils`. Drashti runs
it only while video out is on, below the show's priority. It is not linked into Drashti's own code.

| From                                                                                                                     | Licence      |
| ------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `https://github.com/leadedge/Spout2`, release 2.007.018, commit `6b68a5b4fdeca6130b851e5f9366467a844860e5` (10 Oct 2026) | BSD 2-clause |

Each file is downloaded at that commit and checked against its own SHA-256 (listed in `scripts/fetch-video-out.mjs`)
before anything is compiled. None of Spout's sources is ever committed to this repository.

**Copyright:** Copyright (c) 2014-2026 Lynn Jarvis. The licence is in `LICENSE`, as Spout gives it at that commit.
