import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { LYRICS_STYLE } from './formats/text';
import { MediaStore } from './media-store';
import { listZip } from './zip';
import { exportKirtanBundle, withKirtanBundle } from './kirtan-bundle';

/* Made-up words and generated media only. */
const cleanup: { db: Db; dir: string }[] = [];
afterEach(async () => {
  for (const t of cleanup.splice(0)) {
    t.db.close();
    await rm(t.dir, { recursive: true, force: true });
  }
});

export async function bundleLibrary() {
  const dir = await mkdtemp(join(tmpdir(), 'drashti-bundle-test-'));
  const db = openDatabase(join(dir, 'library.sqlite'));
  cleanup.push({ db, dir });
  const mediaDir = join(dir, 'Media');
  await mkdir(mediaDir);
  const media = new MediaStore(db, { dir: mediaDir, freeBytes: () => 1024 ** 4 });
  const recording = join(dir, 'Placeholder.wav');
  // A generated, silent PCM WAV (no recorded sound).
  const wav = Buffer.alloc(46);
  wav.write('RIFF');
  wav.writeUInt32LE(38, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(2, 40);
  await writeFile(recording, wav);
  const imported = await media.importFile(recording, { kind: 'media', path: recording });
  if (!('mediaId' in imported)) throw new Error('Generated WAV was not imported');
  const repo = new PresentationRepo(db);
  const libraryId = repo.ensureLibrary('Placeholder library');
  const id = repo.insert({
    libraryId,
    name: 'Placeholder kirtan',
    notes: 'Placeholder presentation notes',
    groups: [
      {
        name: 'Verse',
        slides: [
          {
            notes: 'Placeholder slide notes',
            elements: [
              {
                id: randomUUID(),
                kind: 'text',
                frame: { x: 10, y: 20, width: 1000, height: 400 },
                text: 'નમૂના\nनमूना\nPlaceholder\nPlaceholder roman',
                style: LYRICS_STYLE,
                runs: [
                  { text: 'નમૂના\n', lang: 'gu' },
                  { text: 'नमूना\n', lang: 'hi' },
                  { text: 'Placeholder\n', lang: 'en' },
                  { text: 'Placeholder roman', lang: 'translit' },
                ],
              },
            ],
            cues: [
              {
                kind: 'audio',
                label: 'Placeholder recording',
                mediaId: imported.mediaId,
                props: { volume: 0.5, loop: false },
              },
            ],
          },
        ],
      },
      { name: 'Chorus', slides: [{ enabled: false, elements: [] }] },
    ],
    arrangements: [{ name: 'Placeholder order', groups: [0, 1, 0] }],
    selectedArrangement: 0,
    kirtan: {
      category: 'Kirtan',
      kavi: 'Placeholder poet',
      raag: 'Placeholder raag',
      occasions: ['Placeholder occasion'],
      audioMediaId: imported.mediaId,
    },
  });
  const rows = repo.content(id)!;
  rows.autoLines = [{ slide_id: rows.slides[0]!.id, lang: 'translit', text: 'Placeholder roman' }];
  repo.setContent(rows);
  const output = join(dir, 'Placeholder.drashti-kirtans');
  const exportBundle = (includeMedia = true) =>
    exportKirtanBundle({
      db,
      mediaDir,
      presentationIds: [id],
      output,
      includeMedia,
      freeBytes: () => 1024 ** 4,
    });
  return { db, dir, repo, media, mediaDir, id, output, exportBundle, wav };
}

describe('kirtan bundle export', () => {
  it('writes a versioned ZIP with checksums, tracks, details, arrangements, hidden slides and requested media', async () => {
    const t = await bundleLibrary();
    await t.exportBundle();
    expect((await listZip(t.output)).map((e) => e.name)).toContain('manifest.json');
    await withKirtanBundle(t.output, {}, async (bundle) => {
      expect(bundle.manifest).toMatchObject({ format: 'drashti-kirtans', version: 1 });
      expect(bundle.kirtans).toHaveLength(1);
      const k = bundle.kirtans[0]!;
      expect(k.name).toBe('Placeholder kirtan');
      expect(k.notes).toBe('Placeholder presentation notes');
      expect(k.content.kirtan?.row).toMatchObject({ kavi: 'Placeholder poet', raag: 'Placeholder raag' });
      expect(k.content.slides[1]?.enabled).toBe(0);
      expect(k.content.arrangementEntries).toHaveLength(3);
      expect(k.content.autoLines[0]?.text).toBe('Placeholder roman');
      expect(k.content.elements[0]?.props).toContain('translit');
      const file = bundle.media[0]!;
      expect(await readFile(file.path!)).toEqual(t.wav);
      expect(file.sha256).toBe(createHash('sha256').update(t.wav).digest('hex'));
      expect(JSON.stringify(bundle.manifest)).not.toContain(t.dir);
      expect(JSON.stringify(k)).not.toContain(t.dir);
    });
  });

  it('keeps each kirtan’s identity across exports, including renamed bundle files', async () => {
    const t = await bundleLibrary();
    const identity = () => withKirtanBundle(t.output, {}, async (b) => b.manifest.kirtans[0]!.id);
    await t.exportBundle();
    const first = await identity();
    await t.exportBundle();
    expect(await identity()).toBe(first);
  });

  it('exports words without media bytes when asked, keeping portable missing-media descriptions', async () => {
    const t = await bundleLibrary();
    await t.exportBundle(false);
    await withKirtanBundle(t.output, {}, async (b) => {
      expect(b.media).toHaveLength(1);
      expect(b.media[0]).toMatchObject({ name: 'Placeholder.wav', path: null });
      expect(b.kirtans[0]!.content.cues[0]!.media_id).toBe(b.media[0]!.id);
    });
    expect((await listZip(t.output)).every((e) => !e.name.startsWith('media/'))).toBe(true);
  });

  it('refuses a missing requested media file and leaves an existing output intact', async () => {
    const t = await bundleLibrary();
    await writeFile(t.output, 'Earlier finished bundle');
    await rm(t.mediaDir, { recursive: true });
    await expect(t.exportBundle()).rejects.toThrow(/media|missing|found/iu);
    expect(await readFile(t.output, 'utf8')).toBe('Earlier finished bundle');
  });

  it('refuses non-kirtans, unknown ids and a full disk without leaving a partial output', async () => {
    const t = await bundleLibrary();
    await expect(
      exportKirtanBundle({
        db: t.db,
        mediaDir: t.mediaDir,
        output: t.output,
        presentationIds: [randomUUID()],
        includeMedia: false,
      }),
    ).rejects.toThrow(/kirtan/iu);
    await expect(
      exportKirtanBundle({
        db: t.db,
        mediaDir: t.mediaDir,
        output: t.output,
        presentationIds: [t.id],
        includeMedia: true,
        freeBytes: () => 1,
      }),
    ).rejects.toThrow(/space|free/iu);
    await expect(readFile(t.output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
