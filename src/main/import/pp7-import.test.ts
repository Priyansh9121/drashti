import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import { PlaylistRepo } from '../db/playlists';
import { PresentationRepo } from '../db/presentations';
import { MediaStore } from './media-store';
import { BUNDLE_SEP, runImport } from './pipeline';
import { cocoaRtf } from './testing/pp6-fixtures';
import { pp7Playlists, pp7Presentation, pp7Theme } from './testing/pp7-fixtures';
import { makeZip } from './testing/zip-writer';

const hymn = (uuid = 'P7-HYMN') =>
  pp7Presentation({
    uuid,
    name: 'Placeholder Hymn',
    groups: [
      {
        name: 'Verse 1',
        uuid: 'G-V',
        slides: [
          {
            id: `${uuid}-1`,
            background: { path: '/Volumes/OldPC/Media/Blue Loop.mov', kind: 'video', loop: true },
            text: [{ rtf: cocoaRtf([['Placeholder hymn, first line', 72, [255, 255, 255]]]) }],
            audio: '/Volumes/Gone/Placeholder Tune.mp3',
          },
          { id: `${uuid}-2`, image: { path: '/Users/op/Pictures/Logo.png', rect: [1600, 40, 280, 160] } },
        ],
      },
    ],
  });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-pp7-'));
  const source = join(dir, 'ProPresenter');
  const temp = join(dir, 'temp');
  mkdirSync(source);
  mkdirSync(temp);
  mkdirSync(join(dir, 'Media'));
  const db = openDatabase(join(dir, 'drashti.sqlite'));
  const media = new MediaStore(db, { dir: join(dir, 'Media'), freeBytes: () => 1024 ** 4, reserveBytes: 0 });
  const write = (rel: string, content: string | Uint8Array) => {
    const full = join(source, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
    return full;
  };
  const run = async (paths: string[]) => {
    const summary = await runImport({
      db,
      media,
      runId: randomUUID(),
      paths,
      options: {},
      tempDir: temp,
      progressEveryMs: 0,
    });
    return { summary, report: new ImportRepo(db).report(summary.id) };
  };
  return {
    db,
    temp,
    source,
    write,
    run,
    presentations: new PresentationRepo(db),
    playlists: new PlaylistRepo(db),
  };
}

describe('importing ProPresenter 7 kirtans', () => {
  it('fills the kavi from the artist field, and leaves legacy-font text in no language', async () => {
    const t = setup();
    const white: [number, number, number] = [255, 255, 255];
    t.write(
      'Libraries/Default/Placeholder Kirtan.pro',
      pp7Presentation({
        uuid: 'P7-KIRTAN',
        name: 'Placeholder Kirtan',
        ccliArtist: 'Placeholder Artist Kavi',
        groups: [
          {
            name: 'Verse',
            uuid: 'G-V',
            slides: [
              {
                id: 'k1',
                text: [
                  {
                    rtf: cocoaRtf([
                      ['નમૂનો', 72, white],
                      ['Namūno', 72, white],
                    ]),
                  },
                ],
              },
              { id: 'k2', text: [{ rtf: cocoaRtf([['nmUnO', 72, white]], 'qc', 'Gopika') }] },
            ],
          },
        ],
      }),
    );
    const { report } = await t.run([t.source]);
    const item = report?.items.find((i) => i.format === 'pp7');
    const message = item?.issues.find((i) => i.code === 'kirtan')?.message ?? '';
    expect(message).toContain('Gujarati (every slide) and Transliteration (every slide)');
    expect(message).toContain('Kavi “Placeholder Artist Kavi”, from the artist field.');
    expect(message).toContain('Text in a legacy font is in no language until it can be converted.');
    const doc = t.presentations.get(item?.target?.id ?? '');
    expect(doc?.kirtan).toMatchObject({ kavi: 'Placeholder Artist Kavi', tracks: ['gu', 'translit'] });
    // The legacy-font text stays exactly as typed, in its font.
    const legacy = doc?.groups[0]?.slides[1]?.slide.elements[0];
    expect(legacy?.kind === 'text' ? legacy.runs : null).toEqual([
      expect.objectContaining({ text: 'nmUnO', font: 'Gopika', legacy: true, lang: null }),
    ]);
  });
});

describe('importing ProPresenter 7 files', () => {
  it('imports a .pro with its media: background as a cue, placed image, missing audio kept', async () => {
    const t = setup();
    t.write('Libraries/Default/Placeholder Hymn.pro', hymn());
    t.write('Libraries/Default/Logo.png', 'placeholder png');
    t.write('Media/Assets/Blue Loop.mov', 'placeholder video');
    const { report } = await t.run([t.source]);
    const item = report?.items.find((i) => i.format === 'pp7' && i.target?.kind === 'presentation');
    expect(item).toMatchObject({
      outcome: 'imported',
      name: 'Placeholder Hymn',
      counts: { slides: 2, media: 3 },
    });
    expect(item?.issues.filter((i) => i.code === 'missing-media')).toHaveLength(1);
    const cues = t.db
      .prepare(
        'SELECT c.kind, m.name, m.missing FROM slide_cues c JOIN media m ON m.id = c.media_id ORDER BY c.position',
      )
      .all();
    expect(cues).toEqual([
      { kind: 'background', name: 'Blue Loop.mov', missing: 0 },
      { kind: 'audio', name: 'Placeholder Tune.mp3', missing: 1 },
    ]);
    const doc = t.presentations.get(item?.target?.id ?? '');
    expect(doc?.source).toMatchObject({ kind: 'pp7', ref: 'P7-HYMN' });
    expect(doc?.groups[0]?.slides.map((s) => s.slide.elements.map((e) => e.kind))).toEqual([
      ['text'],
      ['image'],
    ]);
  });

  it('keeps themes in the Templates library, named after their folders', async () => {
    const t = setup();
    t.write(
      'Themes/Clouds/Theme',
      pp7Theme([{ name: 'Title', rtf: cocoaRtf([['Title', 90, [255, 255, 255]]]) }]),
    );
    t.write('Libraries/Default/Placeholder Hymn.pro', hymn());
    await t.run([t.source]);
    expect(t.presentations.list().map((p) => [p.libraryName, p.name])).toEqual([
      ['Default', 'Placeholder Hymn'],
      ['Templates', 'Clouds'],
    ]);
  });

  it('links a playlist to presentations by file name', async () => {
    const t = setup();
    t.write('Libraries/Default/Placeholder Hymn.pro', hymn());
    t.write(
      'Playlists/Library',
      pp7Playlists([
        {
          name: 'Services',
          playlists: [
            {
              name: 'Sunday',
              entries: [
                { header: 'Opening' },
                {
                  presentation:
                    'C:\\Users\\mandir\\Documents\\ProPresenter\\Libraries\\Default\\Placeholder Hymn.pro',
                  name: 'Placeholder Hymn',
                },
              ],
            },
          ],
        },
      ]),
    );
    const { report } = await t.run([t.source]);
    const pl = report?.items.find((i) => i.target?.kind === 'playlist');
    expect(pl).toMatchObject({ outcome: 'imported', name: 'Library', counts: { playlists: 2 } });
    expect(pl?.issues).toEqual([]);
    const sunday = t.playlists.list().find((p) => p.name === 'Sunday');
    expect(t.playlists.items(sunday?.id ?? '').map((i) => i.kind)).toEqual(['header', 'presentation']);
  });

  it('unpacks .probundle and .proplaylist exports, and cleans up', async () => {
    const t = setup();
    const bundle = t.write(
      'Placeholder Hymn.probundle',
      makeZip([
        { name: 'Placeholder Hymn.pro', data: Buffer.from(hymn()), deflate: true },
        { name: 'Media/Blue Loop.mov', data: 'bundled video' },
      ]),
    );
    const playlist = t.write(
      'Sunday.proplaylist',
      makeZip([
        {
          name: 'data',
          data: Buffer.from(
            pp7Playlists([
              {
                name: 'Services',
                playlists: [
                  {
                    name: 'Sunday',
                    entries: [{ presentation: '/elsewhere/Second Hymn.pro', name: 'Second Hymn' }],
                  },
                ],
              },
            ]),
          ),
        },
        { name: 'Second Hymn.pro', data: Buffer.from(hymn('P7-SECOND')) },
      ]),
    );
    const { report } = await t.run([bundle, playlist]);
    expect(
      report?.items.map((i) => [i.format, i.outcome, i.name, i.sourcePath.includes(BUNDLE_SEP)]),
    ).toEqual([
      ['pp7', 'imported', 'Placeholder Hymn', true],
      // The bundle's loose copy of the video is already stored, by the presentation that uses it.
      ['media', 'skipped', 'Blue Loop.mov', true],
      ['pp7', 'imported', 'Placeholder Hymn (2)', true],
      ['pp7', 'imported', 'Sunday', true],
    ]);
    const sunday = t.playlists.list().find((p) => p.name === 'Sunday');
    expect(t.playlists.items(sunday?.id ?? '').map((i) => i.kind)).toEqual(['presentation']);
    expect(readdirSync(t.temp)).toEqual([]);
  });

  it('says plainly what settings files are, and fails a broken .pro alone', async () => {
    const t = setup();
    t.write('Libraries/LibraryData', Uint8Array.from([1, 2, 3]));
    t.write('Configuration/Screens', Uint8Array.from([1, 2, 3]));
    t.write('Libraries/Default/Broken.pro', 'TEMPLATE = app');
    t.write('Libraries/Default/Placeholder Hymn.pro', hymn());
    const { report } = await t.run([t.source]);
    expect(report?.items.map((i) => [i.name, i.outcome])).toEqual([
      ['Broken.pro', 'failed'],
      ['Placeholder Hymn', 'imported'],
      ['Screens', 'unsupported'],
      ['LibraryData', 'unsupported'],
    ]);
    expect(report?.items[0]?.message).toMatch(/^Not a readable \.pro file: /u);
  });

  it('stores rotation, outlines, shadows, transitions, auto-advance and the loop it reads', async () => {
    const t = setup();
    t.write(
      'Libraries/Default/Placeholder Timed.pro',
      pp7Presentation({
        uuid: 'P7-TIMED',
        name: 'Placeholder Timed',
        transition: { seconds: 0.6, effect: 'Dissolve' },
        groups: [
          {
            name: 'Verse',
            uuid: 'G-T',
            slides: [
              {
                id: 't1',
                text: [
                  {
                    rtf: cocoaRtf([['Placeholder timed line', 72, [255, 255, 255]]]),
                    rotation: 15,
                    stroke: { width: 2, color: [1, 1, 1, 1] },
                    shadow: { angle: 270, offset: 5, radius: 2 },
                  },
                ],
                transition: { seconds: 1.2 },
                completion: { target: 1, action: 3, seconds: 3 },
              },
              { id: 't2', completion: { target: 4, action: 3, seconds: 5 } },
            ],
          },
        ],
      }),
    );
    const { report } = await t.run([t.source]);
    const id = report?.items.find((i) => i.name === 'Placeholder Timed')?.target?.id ?? '';
    const doc = t.presentations.get(id);
    expect(doc).toMatchObject({ transition: { kind: 'dissolve', durationMs: 600 }, loop: true });
    const [first, second] = doc?.groups[0]?.slides ?? [];
    expect([first?.transition, first?.autoAdvanceMs, second?.autoAdvanceMs]).toEqual([
      { kind: 'dissolve', durationMs: 1200 },
      3000,
      5000,
    ]);
    expect(first?.slide.elements.map((e) => [e.kind, e.rotation])).toEqual([
      ['shape', 15],
      ['text', 15],
    ]);
    expect(first?.slide.elements[1]).toMatchObject({ style: { shadow: { x: 0, y: 5, blur: 2 } } });
  });
});
