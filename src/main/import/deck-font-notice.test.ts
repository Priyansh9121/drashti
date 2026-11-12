import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import type * as Converters from './deck-converters';
import { MediaStore } from './media-store';
import { runImport } from './pipeline';
import { deckWithOldFonts } from './testing/deck-font-fixture';
import { editablePicture } from './testing/editable-pptx-fixture';
import { makeTestPdf } from './testing/make-pdf';
import { makeZip } from './testing/zip-writer';

vi.mock('./deck-converters', async (original) => {
  const actual = await original<typeof Converters>();
  return {
    ...actual,
    findConverters: () => Promise.resolve({ keynote: true, powerpoint: false }),
    convertersFor: (...[source, _platform, has]: Parameters<typeof Converters.convertersFor>) =>
      actual.convertersFor(source, 'darwin', has),
    convertToPdf: (_app, _input, work) => {
      const pdf = join(work, 'pictures.pdf');
      const editablePptx = join(work, 'keynote-export.pptx');
      writeFileSync(
        pdf,
        makeTestPdf([{ width: 960, height: 540, color: [32, 64, 96], text: 'Placeholder words' }]),
      );
      writeFileSync(editablePptx, deckWithOldFonts());
      return Promise.resolve({
        ok: true,
        pdf,
        slides: [{ hidden: false, notes: '', animated: false }],
        shownOnly: false,
        editablePptx,
      });
    },
  } satisfies typeof Converters;
});

it.each(['pptx', 'key'] as const)('reports old fonts from the theme and runs of a %s deck', async (ext) => {
  const root = mkdtempSync(join(tmpdir(), 'drashti-deck-fonts-'));
  const mediaDir = join(root, 'Media');
  mkdirSync(mediaDir);
  const db = openDatabase(join(root, 'drashti.sqlite'));
  try {
    const file = join(root, `Placeholder slides.${ext}`);
    writeFileSync(
      file,
      ext === 'pptx' ? deckWithOldFonts() : makeZip([{ name: 'Index/Document.iwa', data: Buffer.alloc(16) }]),
    );
    const run = await runImport({
      db,
      media: new MediaStore(db, { dir: mediaDir, freeBytes: () => 1024 ** 4 }),
      runId: randomUUID(),
      paths: [file],
      options: {},
      baker: false,
      ...(ext === 'pptx' ? { converters: 'stand-in' as const } : {}),
      tempDir: root,
      drawPdf: (_pdf, outDir) => {
        mkdirSync(outDir, { recursive: true });
        const picture = join(outDir, 'placeholder.png');
        writeFileSync(picture, editablePicture());
        return Promise.resolve({
          ok: true,
          width: 960,
          height: 540,
          pages: [{ index: 0, file: picture, notes: '' }],
          total: 1,
          failed: [],
        });
      },
    });
    const item = new ImportRepo(db).report(run.id)?.items[0];
    expect(item?.outcome).toBe('imported');
    expect(
      item?.issues
        .filter((issue) => issue.code === 'legacy-font')
        .flatMap((issue) => (issue.fix?.kind === 'convert-font' ? [issue.fix.font] : []))
        .sort(),
    ).toEqual(['Gopika', 'Kruti Dev 010']);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
