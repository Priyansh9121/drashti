# Syphon (third-party notice)

On a Mac, Drashti's video out (x30, 19 Nov 2026) sends the stream's picture to other apps on the same Mac by
**Syphon**. `drashti-video-out`, a separate program in the app's resources (`Resources/video-out/`), is Drashti's own
small program (`tools/video-out/drashti-video-out-mac.m`) with these sources of the Syphon framework compiled in, by
the Mac's own compiler, when it is built (`scripts/fetch-video-out.mjs`): `SyphonServerBase`, `SyphonServerDirectory`,
`SyphonServerConnectionManager`, `SyphonClientBase`, `SyphonClientConnectionManager`, `SyphonPrivate`,
`SyphonMessaging`, `SyphonMessageSender`, `SyphonMessageReceiver`, `SyphonCFMessageSender`, `SyphonCFMessageReceiver`,
`SyphonMessageQueue` and `SyphonDispatch`, with the framework's headers. Drashti runs it only while video out is on,
below the show's priority. It is not linked into Drashti's own code.

| From                                                                                                          | Licence      |
| ------------------------------------------------------------------------------------------------------------- | ------------ |
| `https://github.com/Syphon/Syphon-Framework`, commit `f4761677a45b8034a3c2069ec0f3d2553da81fba` (21 Sep 2026) | BSD 3-clause |

Each file is downloaded at that commit and checked against its own SHA-256 (listed in `scripts/fetch-video-out.mjs`)
before anything is compiled. None of Syphon's sources is ever committed to this repository.

**Copyright:** Copyright 2010-2023 bangnoise (Tom Butterworth) & vade (Anton Marini); some of the framework's headers
also Copyright 2020-2023 Maxime Touroute & Philippe Chaurand (www.millumin.com). The licence is in `License.txt`, as the
framework gives it at that commit. The name of the Syphon Project and its contributors' names are not used to endorse
or promote Drashti.
