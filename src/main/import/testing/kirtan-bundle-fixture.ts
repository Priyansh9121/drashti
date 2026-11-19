import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { openDatabase, type Db } from '../../db/database';
import { PresentationRepo } from '../../db/presentations';
import { LYRICS_STYLE } from '../formats/text';
import { MediaStore } from '../media-store';
import { exportKirtanBundle } from '../kirtan-bundle';

export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing placeholder fixture value');
  return value;
}

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
                lang: null,
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
  const rows = repo.content(id);
  if (!rows) throw new Error('Placeholder content missing');
  rows.autoLines = [
    { slide_id: rows.slides[0]?.id ?? 'missing', lang: 'translit', text: 'Placeholder roman' },
  ];
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
