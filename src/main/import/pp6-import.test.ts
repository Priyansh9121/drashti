import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ImportOptions } from '../../shared/import';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import { MediaRepo } from '../db/media';
import { PlaylistRepo } from '../db/playlists';
import { DbSlideSource, PresentationRepo } from '../db/presentations';
import { MediaStore } from './media-store';
import { BUNDLE_SEP, runImport } from './pipeline';
import { cocoaRtf, pp6Playlist, pp6Presentation, pp6Template } from './testing/pp6-fixtures';
import { makeZip } from './testing/zip-writer';

const hymn = (extra: Partial<Parameters<typeof pp6Presentation>[0]> = {}) =>
  pp6Presentation({
    uuid: 'HYMN-1',
    groups: [
      {
        name: 'Verse 1',
        uuid: 'G-V',
        slides: [
          {
            background: { path: '/Volumes/OldMac/Media/Blue Loop.mov', kind: 'video', loop: true },
            text: [{ rtf: cocoaRtf([['Placeholder hymn, first line', 72, [255, 255, 255]]]) }],
            audio: '/Volumes/Gone/Placeholder Tune.mp3',
          },
          { text: [{ rtf: cocoaRtf([['Placeholder hymn, second line', 72, [255, 255, 255]]]) }] },
        ],
      },
      {
        name: 'Chorus',
        uuid: 'G-C',
        slides: [{ image: { path: '/Users/op/Pictures/Logo.png', rect: [1600, 40, 280, 160] } }],
      },
    ],
    ...extra,
  });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-pp6-'));
  const source = join(dir, 'source');
  const mediaDir = join(dir, 'Media');
  const temp = join(dir, 'temp');
  mkdirSync(source);
  mkdirSync(mediaDir);
  mkdirSync(temp);
  const db = openDatabase(join(dir, 'drashti.sqlite'));
  const media = new MediaStore(db, { dir: mediaDir, freeBytes: () => 1024 ** 4, reserveBytes: 0 });
  const write = (rel: string, content: string | Buffer) => {
    const full = join(source, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
    return full;
  };
  const run = async (paths: string[], options: ImportOptions = {}) => {
    const summary = await runImport({
      db,
      media,
      runId: randomUUID(),
      paths,
      options,
      tempDir: temp,
      progressEveryMs: 0,
    });
    return { summary, report: new ImportRepo(db).report(summary.id) };
  };
  return {
    db,
    dir,
    source,
    temp,
    write,
    run,
    presentations: new PresentationRepo(db),
    playlists: new PlaylistRepo(db),
  };
}

describe('importing ProPresenter 6 kirtans', () => {
  /* Placeholder words only. */
  const white: [number, number, number] = [255, 255, 255];
  const kirtan = (extra: Partial<Parameters<typeof pp6Presentation>[0]> = {}) =>
    pp6Presentation({
      uuid: 'KIRTAN-1',
      ccliAuthor: 'Placeholder Kavi',
      groups: [
        {
          name: 'Verse',
          slides: [
            {
              // One box, one look for every line: the script of each line tells its language.
              text: [
                {
                  rtf: cocoaRtf([
                    ['નમૂનાની પંક્તિ', 72, white],
                    ['Namūnānī pankti', 72, white],
                    ['Placeholder meaning', 72, white],
                  ]),
                },
              ],
            },
            {
              text: [
                {
                  rtf: cocoaRtf([
                    ['બીજી પંક્તિ', 72, white],
                    ['Bījī pankti', 72, white],
                  ]),
                },
              ],
            },
          ],
        },
      ],
      ...extra,
    });

  it('makes a box whose lines are in different scripts into tracks, with the kavi from the author field', async () => {
    const t = setup();
    t.write('Placeholder Kirtan.pro6', kirtan());
    const { report } = await t.run([t.source]);
    const item = report?.items.find((i) => i.format === 'pp6');
    expect(item?.issues.find((i) => i.code === 'kirtan')?.message).toBe(
      'A kirtan: its lines are English (1 of 2 slides), Gujarati (every slide) and Transliteration (every slide), each line’s language going by its script. Kavi “Placeholder Kavi”, from the author field.',
    );
    const doc = t.presentations.get(item?.target?.id ?? '');
    expect(doc?.kirtan).toMatchObject({ kavi: 'Placeholder Kavi', tracks: ['en', 'gu', 'translit'] });
    const first = doc?.groups[0]?.slides[0]?.slide.elements[0];
    expect(first?.kind === 'text' ? first.runs?.map((r) => [r.lang, r.text.trim()]) : null).toEqual([
      ['gu', 'નમૂનાની પંક્તિ'],
      ['translit', 'Namūnānī pankti'],
      ['en', 'Placeholder meaning'],
    ]);
    expect(t.presentations.list()[0]?.kirtanTracks).toEqual(['en', 'gu', 'translit']);
  });

  it('keeps the details the operator gave a kirtan when it is imported again', async () => {
    const t = setup();
    const file = t.write('Placeholder Kirtan.pro6', kirtan());
    const first = await t.run([file]);
    const id = first.report?.items[0]?.target?.id ?? '';
    const rows = t.presentations.content(id);
    if (!rows) throw new Error('missing');
    t.presentations.setContent({
      ...rows,
      kirtan: {
        row: {
          category: 'Dhun',
          kavi: 'Placeholder Kavi',
          raag: 'Placeholder Raag',
          occasions: '["Diwali"]',
          audio_media_id: null,
        },
      },
    });
    t.write('Placeholder Kirtan.pro6', kirtan({ ccliAuthor: 'Another Placeholder' }));
    await t.run([file], { onConflict: 'replace' });
    expect(t.presentations.get(id)?.kirtan).toMatchObject({
      category: 'Dhun',
      kavi: 'Placeholder Kavi',
      raag: 'Placeholder Raag',
      occasions: ['Diwali'],
    });
  });

  it('leaves a presentation in one language, with no author, as it is', async () => {
    const t = setup();
    t.write('Placeholder Hymn.pro6', hymn());
    const { report } = await t.run([t.source]);
    const item = report?.items.find((i) => i.format === 'pp6');
    expect(item?.issues.some((i) => i.code === 'kirtan')).toBe(false);
    expect(t.presentations.get(item?.target?.id ?? '')?.kirtan).toBeNull();
  });
});

describe('importing ProPresenter 6 files', () => {
  it('imports a presentation with its media: background as a cue, placed image, missing audio kept for relinking', async () => {
    const t = setup();
    t.write('Placeholder Hymn.pro6', hymn());
    t.write('Logo.png', 'placeholder png'); // next to the file
    t.write('Loops/Blue Loop.mov', 'placeholder video'); // found by name in the imported folder
    const { summary, report } = await t.run([t.source]);
    const item = report?.items.find((i) => i.format === 'pp6');
    expect(item).toMatchObject({
      outcome: 'imported',
      name: 'Placeholder Hymn',
      counts: { presentations: 1, groups: 2, slides: 3, media: 3 },
    });
    expect(
      item?.issues.filter((i) => i.code === 'missing-media').map((i) => [i.message, i.fix?.kind]),
    ).toEqual([
      [
        'Missing media: Placeholder Tune.mp3 was not at its original path, next to the file or in the imported folders.',
        'relink-media',
      ],
    ]);
    // The loose media files were stored once, by the presentation that uses them.
    expect(report?.items.filter((i) => i.format === 'media').map((i) => i.outcome)).toEqual([
      'skipped',
      'skipped',
    ]);
    expect(summary.totals).toMatchObject({ presentations: 1, failed: 0 });

    const doc = t.presentations.get(item?.target?.id ?? '');
    expect(doc?.source).toMatchObject({ kind: 'pp6', ref: 'HYMN-1' });
    // The background is a cue for the background layer, not an element of the slide.
    const cues = t.db
      .prepare(
        `SELECT c.kind, c.label, json_extract(c.props, '$.fit') AS fit, json_extract(c.props, '$.loop') AS loop, m.name, m.missing
           FROM slide_cues c JOIN media m ON m.id = c.media_id ORDER BY c.slide_id, c.position`,
      )
      .all();
    expect(cues).toEqual([
      { kind: 'background', label: 'Background 0', fit: 'fill', loop: 1, name: 'Blue Loop.mov', missing: 0 },
      {
        kind: 'audio',
        label: 'Placeholder audio',
        fit: null,
        loop: 1,
        name: 'Placeholder Tune.mp3',
        missing: 1,
      },
    ]);
    const firstSlide = doc?.groups[0]?.slides[0]?.slide;
    expect(firstSlide?.elements.map((e) => e.kind)).toEqual(['text']);
    const logo = doc?.groups[1]?.slides[0]?.slide.elements[0];
    expect(logo).toMatchObject({ kind: 'image', fit: 'fit' });
    const logoMedia = t.db
      .prepare('SELECT name, missing FROM media WHERE id = ?')
      .get(logo?.kind === 'image' ? logo.mediaId : '');
    expect(logoMedia).toEqual({ name: 'Logo.png', missing: 0 });
  });

  it('knows a presentation by its own id: unchanged is skipped (even moved), changed asks, replace keeps it', async () => {
    const t = setup();
    const file = t.write('Placeholder Hymn.pro6', hymn());
    const first = await t.run([file]);
    const id = first.report?.items[0]?.target?.id ?? '';
    const moved = t.write('elsewhere/Renamed.pro6', hymn());
    expect((await t.run([moved])).report?.items[0]).toMatchObject({ outcome: 'skipped', target: { id } });

    const changed = hymn({
      groups: [
        { name: 'Verse 1', slides: [{ text: [{ rtf: cocoaRtf([['Rewritten', 72, [255, 255, 255]]]) }] }] },
      ],
    });
    t.write('Placeholder Hymn.pro6', changed);
    expect((await t.run([file])).report?.items[0]).toMatchObject({ outcome: 'conflict', target: { id } });
    const replaced = await t.run([file], { decisions: { [file]: 'replace' } });
    expect(replaced.report?.items[0]).toMatchObject({ outcome: 'replaced', target: { id } });
    expect(t.presentations.get(id)?.groups.map((g) => g.slides.length)).toEqual([1]);
  });

  it('keeps templates in their own library', async () => {
    const t = setup();
    t.write(
      'Templates/Blue Style.pro6Template',
      pp6Template([{ text: [{ rtf: cocoaRtf([['Title', 90, [255, 255, 255]]]) }] }]),
    );
    t.write('Placeholder Hymn.pro6', hymn());
    await t.run([t.source]);
    expect(t.presentations.list().map((p) => [p.libraryName, p.name])).toEqual([
      ['Default', 'Placeholder Hymn'],
      ['Templates', 'Blue Style'],
    ]);
  });

  it('links playlist items to presentations by file name, and keeps missing ones as placeholders', async () => {
    const t = setup();
    t.write('Placeholder Hymn.pro6', hymn());
    t.write(
      'Default.pro6pl',
      pp6Playlist([
        {
          name: 'Sunday',
          entries: [
            { header: 'Opening' },
            {
              document: '/Users/mandir/Documents/ProPresenter6/Placeholder Hymn.pro6',
              name: 'Placeholder Hymn',
            },
            { document: '/Users/mandir/Documents/ProPresenter6/Not Here.pro6', name: 'Not Here' },
          ],
        },
      ]),
    );
    const { report } = await t.run([t.source]);
    const pl = report?.items.find((i) => i.target?.kind === 'playlist');
    expect(pl).toMatchObject({ outcome: 'imported', name: 'Default', counts: { playlists: 2 } });
    expect(pl?.issues.map((i) => i.code)).toEqual(['missing-presentation']);
    const folder = t.playlists.list();
    expect(folder.map((p) => [p.name, p.isFolder, p.itemCount])).toEqual([
      ['Services', true, 0],
      ['Sunday', false, 3],
    ]);
    const hymnId = t.presentations.list().find((p) => p.name === 'Placeholder Hymn')?.id;
    expect(t.playlists.items(folder[1]?.id ?? '')).toEqual([
      { kind: 'header', label: 'Opening', presentationId: null, mediaId: null },
      { kind: 'presentation', label: 'Placeholder Hymn', presentationId: hymnId, mediaId: null },
      { kind: 'placeholder', label: 'Not Here', presentationId: null, mediaId: null },
    ]);
    // Unchanged: skipped. Changed: updated in place of the old one.
    expect((await t.run([join(t.source, 'Default.pro6pl')])).report?.items[0]?.outcome).toBe('skipped');
    t.write('Default.pro6pl', pp6Playlist([{ name: 'Sunday', entries: [{ header: 'Only a header' }] }]));
    expect((await t.run([join(t.source, 'Default.pro6pl')])).report?.items[0]?.outcome).toBe('replaced');
    expect(t.playlists.list().map((p) => [p.name, p.itemCount])).toEqual([
      ['Services', 0],
      ['Sunday', 1],
    ]);
  });

  it('keeps the arrangement a presentation plays in, and the one a playlist item names', async () => {
    const t = setup();
    const verse = { text: [{ rtf: cocoaRtf([['Placeholder verse', 72, [255, 255, 255]]]) }] };
    const chorus = { text: [{ rtf: cocoaRtf([['Placeholder chorus', 72, [255, 255, 255]]]) }] };
    t.write(
      'Placeholder Arranged.pro6',
      pp6Presentation({
        uuid: 'ARRANGED',
        groups: [
          { name: 'Verse', uuid: 'G-V', slides: [verse, verse] },
          { name: 'Chorus', uuid: 'G-C', slides: [chorus] },
        ],
        arrangements: [
          { name: 'Usual', groups: ['G-V', 'G-C', 'G-V', 'G-C'] },
          { name: 'Short', groups: ['G-C', 'G-V'] },
        ],
        selectedArrangement: 1,
      }),
    );
    t.write(
      'Default.pro6pl',
      pp6Playlist([
        {
          name: 'Sunday',
          entries: [
            {
              document: '/Users/mandir/Documents/ProPresenter6/Placeholder Arranged.pro6',
              name: 'Arranged',
              arrangement: 0,
            },
            { document: '/Users/mandir/Documents/ProPresenter6/Placeholder Arranged.pro6', name: 'As set' },
          ],
        },
      ]),
    );
    await t.run([t.source]);
    const id = t.presentations.list().find((p) => p.name === 'Placeholder Arranged')?.id ?? '';
    const doc = t.presentations.get(id);
    const [usual, short] = doc?.arrangements ?? [];
    expect(doc?.arrangements.map((a) => a.name)).toEqual(['Usual', 'Short']);
    expect(doc?.selectedArrangementId).toBe(short?.id);
    // Its own order plays Short; the Usual arrangement repeats the verse and chorus.
    const source = new DbSlideSource(t.presentations);
    expect(source.order(id)?.slides.map((s) => s.slide.elements.length)).toHaveLength(3);
    expect(source.order(id, usual?.id ?? null)?.slides).toHaveLength(6);
    expect(source.order(id, null)?.slides).toHaveLength(3);
    // The first playlist item names the Usual arrangement; the second follows the presentation.
    expect(
      t.db
        .prepare(
          "SELECT label, order_mode, arrangement_id FROM playlist_items WHERE kind = 'presentation' ORDER BY position",
        )
        .all(),
    ).toEqual([
      { label: 'Arranged', order_mode: 'arrangement', arrangement_id: usual?.id },
      { label: 'As set', order_mode: 'presentation', arrangement_id: null },
    ]);
  });

  it('imports a presentation that a playlist names but that was not dropped, when it can find the file', async () => {
    const t = setup();
    const elsewhere = join(t.dir, 'library');
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, 'Placeholder Hymn.pro6'), hymn());
    t.write(
      'Default.pro6pl',
      pp6Playlist([
        {
          name: 'Sunday',
          entries: [{ document: join(elsewhere, 'Placeholder Hymn.pro6'), name: 'Placeholder Hymn' }],
        },
      ]),
    );
    const { report } = await t.run([join(t.source, 'Default.pro6pl')]);
    expect(report?.items.map((i) => [i.format, i.outcome, i.name])).toEqual([
      ['pp6', 'imported', 'Placeholder Hymn'],
      ['pp6', 'imported', 'Default'],
    ]);
  });

  it('unpacks a bundle, imports what is inside with its media, and cleans up', async () => {
    const t = setup();
    const bundle = t.write(
      'Placeholder Hymn.pro6x',
      makeZip([
        { name: 'Placeholder Hymn.pro6', data: hymn(), deflate: true },
        { name: 'Media/Blue Loop.mov', data: 'bundled video' },
        { name: 'Media/Logo.png', data: 'bundled png' },
      ]),
    );
    const { report } = await t.run([bundle]);
    const item = report?.items.find((i) => i.target?.kind === 'presentation');
    expect(item).toMatchObject({
      outcome: 'imported',
      sourcePath: `${bundle}${BUNDLE_SEP}Placeholder Hymn.pro6`,
      counts: { media: 3 },
    });
    // Only the audio (not in the bundle) is missing.
    expect(item?.issues.filter((i) => i.code === 'missing-media')).toHaveLength(1);
    expect(readdirSync(t.temp)).toEqual([]);
  });

  it('fails a presentation that cannot be written without losing the others in its group', async () => {
    const t = setup();
    t.write('A.pro6', hymn({ uuid: 'A' }));
    t.write('B.pro6', hymn({ uuid: 'B', width: 99_999 })); // the library refuses a canvas that wide
    t.write('C.pro6', hymn({ uuid: 'C' }));
    const { report, summary } = await t.run([t.source]);
    const outcomes = report?.items.filter((i) => i.format === 'pp6').map((i) => [i.name, i.outcome]);
    expect(outcomes).toEqual([
      ['A', 'imported'],
      ['B', 'failed'],
      ['C', 'imported'],
    ]);
    expect(report?.items.find((i) => i.name === 'B')?.message).toMatch(/^Could not write this presentation/u);
    expect(summary.totals).toMatchObject({ presentations: 2, failed: 1 });
    expect(t.presentations.list().map((p) => p.name)).toEqual(['A', 'C']);
  });

  it('says plainly what the older app’s support files are, and imports its props', async () => {
    const t = setup();
    t.write('Props.pro6', hymn({ uuid: 'P' }));
    t.write('Messages.xml', '<array/>');
    t.write('CCLIData.txt', 'reporting data');
    const { report } = await t.run([t.source]);
    expect(report?.items.map((i) => [i.name, i.outcome, i.message])).toEqual([
      ['CCLIData.txt', 'unsupported', 'CCLI reporting data, not lyrics: not imported.'],
      // Props are imported now, one per slide (the logo's file is missing, and can be found later).
      ['Props.pro6', 'imported', '3 props: show them from Props, under the live picture.'],
      ['Messages.xml', 'unsupported', 'Messages are set up again in Drashti (see the audit report).'],
    ]);
  });
});

describe('a ProPresenter 6 video’s start and end points (Session 14)', () => {
  it('come with the media item in its time scale, marked to look over', async () => {
    const t = setup();
    t.write('Media/Marked Loop.mov', 'placeholder video');
    t.write(
      'Placeholder Marked.pro6',
      pp6Presentation({
        uuid: 'P6-MARKED',
        groups: [
          {
            name: 'Verse',
            slides: [
              {
                background: {
                  path: join(t.source, 'Media/Marked Loop.mov'),
                  kind: 'video',
                  loop: true,
                  points: { timeScale: 600, in: 1200, out: 3900, end: 6000 },
                },
                text: [],
              },
            ],
          },
        ],
      }),
    );
    const { report } = await t.run([join(t.source, 'Placeholder Marked.pro6')]);
    const item = report?.items.find((i) => i.format === 'pp6' && i.target?.kind === 'presentation');
    expect(item?.issues.find((i) => i.code === 'markers-read')?.message).toContain('not yet checked');
    const row = t.db.prepare("SELECT id FROM media WHERE name = 'Marked Loop.mov'").get() as { id: string };
    expect(new MediaRepo(t.db).markersOf(row.id)).toMatchObject({ startMs: 2000, endMs: 6500, markers: [] });
  });
});
