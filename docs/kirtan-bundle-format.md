# Sharing kirtans: the bundle format

A kirtan bundle shares chosen kirtans with another Drashti library. It keeps the slides, their language tracks and styles, notes, details, arrangements, hidden slides and the marks for transliteration made by Drashti. Media is optional. It holds no playlists, screen settings, accounts or live-show state.

Use **Export kirtan bundle…** in the Library, choose the kirtans and whether to include their media, then save the file. On the other computer use **Library > Import… > Files…** or drop the file on the Library. This is a Pro Mode action. Nothing is sent over the network by Drashti.

Export copies wait while the stream is on air or recording. The import runs in the background. Its saved report has a line for each kirtan: added, updated, already there, or kept because it was edited locally. Problems appear in the usual import notices. Importing never puts anything on the screens or changes the current live slide.

## Importing again

- Each kirtan has a permanent random identity, independent of its name, the bundle's name and where the file was saved. Two unrelated kirtans with the same title remain separate.
- Importing the same version again does nothing. A newer copy with the same identity updates the same library item, so playlists keep pointing at it.
- A local change to words, slide design, notes, details or arrangements is kept. The incoming copy is skipped and the report says **Local edits kept**. It does not make another kirtan. Rename is a local change too. No automatic merge guesses which words are right.
- An item deleted locally stays deleted when a bundle carrying its identity is imported again. Restore it through the library before updating it.
- An explicit skip choice skips an incoming change.
- Leaving a kirtan out of a later bundle never deletes it at the receiving library.
- Without media bytes, the import uses matching media already present by checksum, or keeps a named missing-media item with a notice. It never follows a path from the sending computer or downloads anything.

## ZIP layout

The file extension is `.drashti-kirtans`. Version 1 is an ordinary single-disk ZIP, with stored or deflated entries, UTF-8 names and no encryption or ZIP64. There are no directory entries. Every entry is listed in the manifest; extra entries are refused.

```text
manifest.json
kirtans/<kirtan-identity>.json
media/<sha256>.<extension>      (only when media is included)
```

All JSON is UTF-8. `manifest.json` has these fields (no others):

| Field     | Value                                                 |
| --------- | ----------------------------------------------------- |
| `format`  | `"drashti-kirtans"`                                   |
| `version` | `1`                                                   |
| `kirtans` | A nonempty array of kirtan file descriptions, below.  |
| `media`   | Media descriptions; an empty array when none is used. |

A kirtan file description has `id` (a lowercase UUID), `entry` (exactly `kirtans/<id>.json`), `sha256` (64 lowercase hexadecimal digits, over the uncompressed file bytes) and `bytes` (the exact uncompressed length).

A media description has `id` (its portable reference in the kirtans), `name` (a filename only), `kind` (`image`, `video` or `audio`), `entry` (the media entry path, or `null` when omitted), `sha256` (its checksum, or `null` for a file that was already missing), `bytes`, and `markers` (the start/end points and named markers, or `null`) and optional `look` (the picture look, or `null`). Entries sharing bytes are stored once. The extension is 1–10 lowercase letters or digits. A checksum checks integrity; it does not prove who sent a bundle.

## Kirtan files

Each kirtan JSON has exactly `name`, `notes` and `content`. `name` is the title, and `notes` are presentation notes. `content` is the portable row model defined and checked in `src/main/import/kirtan-bundle-schema.ts`:

| Field                   | What it holds                                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presentationId`        | The permanent identity from the manifest.                                                                                                                               |
| `width`, `height`       | The slide canvas size.                                                                                                                                                  |
| `transition`, `loop`    | The default transition as JSON or `null`, and 0 or 1 for looping.                                                                                                       |
| `themeId`               | Always `null`; the theme's styles are already on the slides.                                                                                                            |
| `editorMaster`          | Optional master-slide JSON, or `null`.                                                                                                                                  |
| `groups`                | Ordered groups: `id`, `name`, `color`, `position`.                                                                                                                      |
| `slides`                | Ordered slides with their group reference, label, notes, background, darkening, transition, advance time, enabled flag and optional design, guides, deck and page data. |
| `elements`              | Styled slide elements with their ids, slide references, positions, frames, rotation and JSON properties.                                                                |
| `cues`                  | Slide cues, their media references and JSON settings.                                                                                                                   |
| `arrangements`          | Named group orders: `id`, `name`, `position`, `source_ref` (always `null`).                                                                                             |
| `arrangementEntries`    | `arrangement_id`, `position`, `group_id`; repeats are kept.                                                                                                             |
| `selectedArrangementId` | The arrangement to play, or `null`.                                                                                                                                     |
| `kirtan.row`            | `category`, `kavi`, `raag`, `occasions` (JSON array) and `audio_media_id`; nullable details remain null.                                                                |
| `autoLines`             | Each made line's `slide_id`, language and original text.                                                                                                                |

The words remain the slides' styled runs; there is no second copy of a language track. All ids and references are checked and mapped into the receiving library's own ids. Local library themes, source paths and macro bindings are not portable. A kirtan carrying a macro binding is refused for export rather than binding it to an unrelated macro at another mandir.

## Bounds and damaged files

Version 1 accepts at most 1,000 kirtans, 4,096 ZIP entries, 3,000 media descriptions, a 1 MiB manifest, 16 MiB per kirtan JSON, 64 MiB of kirtan JSON in all, 512 MiB per media entry and 2 GiB in the archive or unpacked in total. Deflated entries may expand at most 200 times. The ZIP directory is at most 2 MiB. Both export and import keep 2 GiB free on disk. Import checks the unpacking disk and the receiving database disk separately, allowing space for rows, indexes and the write-ahead log as well as the archive and media.

The reader refuses unknown versions, unknown manifest fields, missing or extra entries, repeated identities or paths, links, absolute paths, parent paths, backslashes, drive paths, unsupported compression, invalid references, wrong lengths, CRC errors and checksum errors. It bounds the ZIP directory before reading it and bounds each entry while inflating it. It validates the whole bundle before writing library items. Temporary files are removed after success, failure or cancellation. A finished export takes its chosen name only after the archive is complete.

Drashti ships no real kirtan text in this format. Tests use placeholder words and generated media only. Keep a received bundle private; real mandir content does not belong in a source repository or CI.
