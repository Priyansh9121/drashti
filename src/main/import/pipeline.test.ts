import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ImportOptions, ImportProgress } from '../../shared/import';
import type { Db } from '../db/database';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import { PresentationRepo } from '../db/presentations';
import { MediaStore } from './media-store';
import { MAX_TEXT_BYTES, runImport } from './pipeline';
import { cocoaRtf, pp6Presentation } from './testing/pp6-fixtures';

const SONG_A = '[Verse 1]\nPlaceholder line one\nPlaceholder line two\n\n[Chorus]\nPlaceholder chorus\n';
const SONG_B = '[Verse]\nOther placeholder\n\nSecond slide\n\nThird slide\n';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-pipeline-'));
  const source = join(dir, 'source');
  mkdirSync(source);
  const mediaDir = join(dir, 'Media');
  mkdirSync(mediaDir);
  const db = openDatabase(join(dir, 'drashti.sqlite'));
  const media = new MediaStore(db, { dir: mediaDir, freeBytes: () => 1024 ** 4 });
  const write = (rel: string, content: string | Buffer) => {
    const full = join(source, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
    return full;
  };
  const run = async (
    paths: string[],
    options: ImportOptions = {},
    extra: Partial<Parameters<typeof runImport>[0]> = {},
  ) => {
    const progress: ImportProgress[] = [];
    const wrote: { presentationId: string; replaced: boolean }[] = [];
    const summary = await runImport({
      db,
      media,
      runId: randomUUID(),
      paths,
      options,
      progressEveryMs: 0,
      onProgress: (p) => progress.push(p),
      onWrote: (w) => wrote.push(w),
      ...extra,
    });
    return { summary, progress, wrote, report: new ImportRepo(db).report(summary.id) };
  };
  return { db, dir, source, write, run, presentations: new PresentationRepo(db) };
}

const names = (db: Db) =>
  (db.prepare('SELECT name FROM presentations ORDER BY name').all() as { name: string }[]).map((r) => r.name);

describe('runImport', () => {
  it('imports lyrics and media from a folder and keeps a report of everything', async () => {
    const t = setup();
    t.write('Song A.txt', SONG_A);
    t.write('sub/Song B.txt', SONG_B);
    t.write('media/Loop.mp4', 'placeholder video');
    t.write('Order of service.docx', 'x');
    t.write('Other.docx', 'x');
    t.write('Old Song.pro6', '<xml/>');
    const { summary, report, progress, wrote } = await t.run([t.source]);

    expect(summary.status).toBe('done');
    expect(summary.totals).toMatchObject({
      files: 6,
      imported: 3,
      unsupported: 2,
      failed: 0,
      presentations: 2,
      groups: 3,
      slides: 5,
      media: 1,
    });
    expect(names(t.db)).toEqual(['Song A', 'Song B']);
    expect(report?.items.map((i) => [i.format, i.outcome, i.name])).toEqual([
      // Presentations first (playlists will name them), then media, then files it does not read.
      ['pp6', 'unsupported', 'Old Song.pro6'],
      ['text', 'imported', 'Song A'],
      ['text', 'imported', 'Song B'],
      ['media', 'imported', 'Loop.mp4'],
      ['unknown', 'unsupported', '.docx files'],
    ]);
    expect(report?.items[0]?.message).toBe('Not a presentation or playlist (it holds xml).');
    expect(report?.items.at(-1)?.message).toBe(
      '2 files (.docx) not imported: Drashti does not read this type. For example: Order of service.docx, Other.docx.',
    );
    // Nothing in the report names the other product.
    expect(JSON.stringify(report)).not.toMatch(/propresenter/iu);

    const songA = t.presentations.get(report?.items[1]?.target?.id ?? '');
    expect(songA?.source).toMatchObject({ kind: 'text', path: join(t.source, 'Song A.txt'), ref: null });
    expect(songA?.groups.map((g) => [g.name, g.slides.length])).toEqual([
      ['Verse 1', 1],
      ['Chorus', 1],
    ]);
    expect(wrote).toHaveLength(2);
    expect(progress[0]?.phase).toBe('scanning');
    expect(progress.at(-1)).toMatchObject({ phase: 'finished', done: 6, total: 6 });
    expect(new ImportRepo(t.db).listRuns().map((r) => r.id)).toEqual([summary.id]);
  });

  it('finds media that cannot play, marks it in the library, and says what to do', async () => {
    const t = setup();
    // Headers only: an AVI file, a PNG, and a ProRes QuickTime movie a slide uses as its background.
    t.write(
      'media/Old clip.avi',
      Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI '), Buffer.alloc(32)]),
    );
    t.write('media/Logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
    const u32 = (n: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(n);
      return b;
    };
    const box = (type: string, ...parts: Buffer[]) => {
      const body = Buffer.concat(parts);
      return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]);
    };
    const prores = Buffer.concat([
      box('ftyp', Buffer.from('qt  '), u32(0)),
      box(
        'moov',
        box(
          'trak',
          box(
            'mdia',
            box('hdlr', u32(0), u32(0), Buffer.from('vide'), Buffer.alloc(12)),
            box('minf', box('stbl', box('stsd', u32(0), u32(1), box('apch', Buffer.alloc(16))))),
          ),
        ),
      ),
    ]);
    t.write('media/Blue Loop.mov', prores);
    t.write(
      'Placeholder Hymn.pro6',
      pp6Presentation({
        uuid: 'HYMN-P',
        groups: [
          {
            name: 'Verse',
            slides: [
              {
                background: { path: '/Volumes/Old/Blue Loop.mov', kind: 'video', loop: true },
                text: [{ rtf: cocoaRtf([['Placeholder line', 72, [255, 255, 255]]]) }],
              },
            ],
          },
        ],
      }),
    );
    const { report } = await t.run([t.source]);
    const item = (name: string) => report?.items.find((i) => i.name === name);
    const [avi] = item('Old clip.avi')?.issues ?? [];
    expect(avi).toMatchObject({
      severity: 'warning',
      code: 'unplayable-media',
      message:
        'Drashti cannot play Old clip.avi yet: AVI video. Converting files inside Drashti comes in a later version.',
      fix: { kind: 'convert-media' },
    });
    expect(avi?.fix?.kind === 'convert-media' && avi.fix.advice).toMatch(/H\.264 MP4/);
    expect(item('Old clip.avi')?.issues).toHaveLength(1);
    expect(item('Logo.png')?.issues).toEqual([]);
    expect(item('Placeholder Hymn')?.issues.find((i) => i.code === 'unplayable-media')?.message).toBe(
      'Drashti cannot play Blue Loop.mov yet: ProRes 422 HQ video (QuickTime). Converting files inside Drashti comes in a later version.',
    );
    // Marked in the library.
    expect(t.db.prepare('SELECT name, playable, format FROM media ORDER BY name').all()).toEqual([
      { name: 'Blue Loop.mov', playable: 0, format: 'ProRes 422 HQ video (QuickTime)' },
      { name: 'Logo.png', playable: 1, format: 'PNG picture' },
      { name: 'Old clip.avi', playable: 0, format: 'AVI video' },
    ]);
  });

  it('skips files that are already in the library, unchanged, even from another folder', async () => {
    const t = setup();
    const a = t.write('Song A.txt', SONG_A);
    t.write('clip.png', 'png bytes');
    await t.run([t.source]);
    const again = await t.run([t.source]);
    expect(again.summary.totals).toMatchObject({ skipped: 2, imported: 0 });
    expect(again.report?.items.map((i) => i.message)).toEqual([
      'Already in the library, unchanged since it was imported.',
      'Already in the media library as “clip.png”.',
    ]);
    const copy = t.write('copy/Song A again.txt', SONG_A);
    const moved = await t.run([copy]);
    expect(moved.report?.items[0]?.message).toBe(
      `Already in the library: the same file was imported from ${a}.`,
    );
    expect(names(t.db)).toEqual(['Song A']);
  });

  it('asks about a changed file, then replaces it in place or keeps both, as chosen', async () => {
    const t = setup();
    const a = t.write('Song A.txt', SONG_A);
    const first = await t.run([a]);
    const id = first.report?.items[0]?.target?.id ?? '';
    t.db.prepare("UPDATE presentations SET name = 'Renamed by the operator' WHERE id = ?").run(id);

    t.write('Song A.txt', `${SONG_A}\n[Verse 2]\nA new verse\n`);
    const asked = await t.run([a]);
    expect(asked.summary.totals).toMatchObject({ conflicts: 1, imported: 0 });
    expect(asked.report?.items[0]).toMatchObject({
      outcome: 'conflict',
      target: { kind: 'presentation', id },
      issues: [{ code: 'changed-since-import', fix: { kind: 'choose', sourcePath: a } }],
    });
    expect(t.presentations.get(id)?.groups).toHaveLength(2);
    expect(asked.wrote).toEqual([]);

    const skipped = await t.run([a], { decisions: { [a]: 'skip' } });
    expect(skipped.report?.items[0]?.outcome).toBe('skipped');

    const replaced = await t.run([a], { decisions: { [a]: 'replace' } });
    expect(replaced.report?.items[0]).toMatchObject({ outcome: 'replaced', target: { id } });
    expect(replaced.wrote).toEqual([{ presentationId: id, replaced: true }]);
    const doc = t.presentations.get(id);
    expect(doc?.name).toBe('Renamed by the operator');
    expect(doc?.groups.map((g) => g.name)).toEqual(['Verse 1', 'Chorus', 'Verse 2']);
    expect(names(t.db)).toEqual(['Renamed by the operator']);

    t.write('Song A.txt', 'Placeholder, third version\n');
    const both = await t.run([a], { onConflict: 'keep-both' });
    expect(both.report?.items[0]).toMatchObject({ outcome: 'kept-both', name: 'Song A' });
    expect(names(t.db)).toEqual(['Renamed by the operator', 'Song A']);
    // The newest import now matches the file: nothing to ask.
    expect((await t.run([a])).report?.items[0]?.outcome).toBe('skipped');
  });

  it('names a new presentation apart from one already called the same', async () => {
    const t = setup();
    await t.run([t.write('one/Song.txt', 'First placeholder\n')]);
    const second = await t.run([t.write('two/Song.txt', 'Second placeholder\n')]);
    expect(second.report?.items[0]).toMatchObject({ outcome: 'imported', name: 'Song (2)' });
  });

  it('reports files that are empty, too big, or missing', async () => {
    const t = setup();
    const empty = t.write('Empty.txt', '\n\n');
    const big = t.write('Huge.txt', '');
    truncateSync(big, MAX_TEXT_BYTES + 1);
    const gone = join(t.source, 'Gone.txt');
    const { summary, report } = await t.run([empty, big, gone]);
    expect(summary.totals).toMatchObject({ failed: 3, imported: 0 });
    expect(report?.items.map((i) => [i.name, i.outcome, i.issues.map((x) => x.code)])).toEqual([
      ['Gone.txt', 'failed', ['not-found']],
      ['Empty', 'failed', ['no-slides']],
      ['Huge.txt', 'failed', ['too-large']],
    ]);
    expect(names(t.db)).toEqual([]);
  });

  it('stops between files when cancelled, keeping what it finished', async () => {
    const t = setup();
    for (let i = 1; i <= 5; i++) t.write(`Song ${i}.txt`, `Placeholder ${i}\n`);
    let seen = 0;
    const { summary } = await t.run([t.source], {}, { isCancelled: () => ++seen > 2 });
    expect(summary.status).toBe('cancelled');
    expect(summary.message).toBe('Cancelled after 2 of 5 files.');
    expect(names(t.db)).toEqual(['Song 1', 'Song 2']);
  });

  it('keeps the files it finished when a run fails partway, and leaves no transaction open', async () => {
    const t = setup();
    for (let i = 1; i <= 3; i++) t.write(`Song ${i}.txt`, `Placeholder ${i}\n`);
    let reports = 0;
    await expect(
      t.run(
        [t.source],
        {},
        {
          onProgress: (p) => {
            if (p.phase === 'importing' && p.current === 'Song 2.txt' && ++reports === 1)
              throw new Error('boom');
          },
        },
      ),
    ).rejects.toThrow('boom');
    expect(t.db.inTransaction).toBe(false);
    expect(names(t.db)).toEqual(['Song 1']);
  });

  it('never imports from folders it is told to skip', async () => {
    const t = setup();
    t.write('own/Song.txt', 'Placeholder\n');
    const { summary } = await t.run([t.source], {}, { skipDir: (d) => d.endsWith('own') });
    expect(summary.totals.files).toBe(0);
  });
});
