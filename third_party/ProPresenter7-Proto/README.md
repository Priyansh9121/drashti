# ProPresenter7-Proto (third-party, MIT)

Unofficial, reverse-engineered Protocol Buffers definitions for the ProPresenter 7 file formats, by greyshirtguy. Drashti's ProPresenter 7 importer reads `.pro` presentations, playlists and themes with them.

- **Source:** https://github.com/greyshirtguy/ProPresenter7-Proto
- **Commit:** `bf6325d243897a6c64dde46eec803ec29f5f8569` (12 August 2026), folder `autogen-proto/`
- **Version:** that folder follows ProPresenter releases; at this commit it matches ProPresenter 21.4 (build 352583705). Field numbers are stable across versions, so it also reads the 18.4 files it is tested against.
- **Licence:** MIT, see `LICENSE` (checked on 28 September 2026 before use).
- **Files:** only the 36 definitions that `presentation.proto`, `propresenter.proto` (playlists) and `template.proto` (themes) need, in `proto/`, unchanged. `google/protobuf/descriptor.proto`, which `customOptions.proto` imports, is not copied: the generator takes it from the `protobufjs` package.

## How Drashti uses them

The app does not load these files at run time. `scripts/gen-pp7-descriptor.mjs` reads them (with `protobufjs`, a development dependency) and writes the field numbers and types the importer needs to `src/main/import/formats/pp7-descriptor.json`, which is committed. A small decoder in `src/main/import/protobuf.ts` reads files with that table and keeps every field it does not know, so a file from a newer version loses nothing silently.

To update: replace `proto/` with the same files from a newer commit, update the commit above, and run `node scripts/gen-pp7-descriptor.mjs`.
