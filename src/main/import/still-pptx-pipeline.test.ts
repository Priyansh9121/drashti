import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { PicturesResult } from '../../shared/pictures';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import type * as Converters from './deck-converters';
import { MediaStore } from './media-store';
import { runImport } from './pipeline';
import { editablePicture } from './testing/editable-pptx-fixture';
import { makeTestPdf } from './testing/make-pdf';
import { makeTestPptx } from './testing/make-pptx';

const convert = vi.hoisted(() => vi.fn<typeof Converters.convertToPdf>());
vi.mock('./deck-converters', async (original) => {
  const actual = await original<typeof Converters>();
  return {
    ...actual,
    findConverters: () => Promise.resolve({ keynote: false, powerpoint: true }),
    // Linux's unit runner exercises the same PowerPoint choice as a supported host.
    convertersFor: (
      source: Parameters<typeof Converters.convertersFor>[0],
      platform: NodeJS.Platform,
      has: Converters.Converters,
    ) => actual.convertersFor(source, platform === 'linux' ? 'win32' : platform, has),
    convertToPdf: convert,
  };
});

it('uses the found PowerPoint picture converter for a still deck with movie baking off', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drashti-still-converter-'));
  const db = openDatabase(join(root, 'drashti.sqlite'));
  try {
    const deck = join(root, 'Placeholder still deck.pptx');
    writeFileSync(deck, makeTestPptx([{ color: '204060', text: 'Placeholder words' }]));
    convert.mockImplementation((_app, _deck, work) => {
      const pdf = join(work, 'Placeholder conversion.pdf');
      writeFileSync(pdf, makeTestPdf([{ width: 960, height: 540, color: [0, 0, 0] }]));
      return Promise.resolve({ ok: true, pdf, slides: null, shownOnly: false });
    });
    const draw = vi.fn((_pdf: string, outDir: string): Promise<PicturesResult> => {
      mkdirSync(outDir, { recursive: true });
      const file = join(outDir, 'placeholder-page.png');
      writeFileSync(file, editablePicture());
      return Promise.resolve({
        ok: true,
        width: 960,
        height: 540,
        pages: [{ index: 0, file, notes: '' }],
        total: 1,
        failed: [],
      });
    });
    const run = await runImport({
      db,
      media: new MediaStore(db, { dir: join(root, 'Media'), freeBytes: () => 1024 ** 4 }),
      runId: randomUUID(),
      paths: [deck],
      options: {},
      progressEveryMs: 0,
      converters: true,
      baker: false,
      drawPdf: draw,
    });
    expect(convert).toHaveBeenCalledTimes(1);
    expect(convert).toHaveBeenCalledWith(
      'powerpoint',
      expect.any(String),
      expect.any(String),
      expect.any(Object),
    );
    expect(draw).toHaveBeenCalledTimes(1);
    expect(new ImportRepo(db).report(run.id)?.items[0]).toMatchObject({
      outcome: 'imported',
      format: 'pictures',
    });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
