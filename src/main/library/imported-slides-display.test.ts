import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import type { DisplayResult } from '../media/display-copies';
import { readPictureHeader } from '../media/picture-header';
import { PresentationRepo } from '../db/presentations';
import { originalWorld } from '../import/testing/original-fixture';
import { sourceWrite } from '../documents/source-write';
import type { SourceReader } from '../documents/source-reader';
import { ImportedSlides } from './imported-slides';
import { editDocOf } from './slides';

function picture(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt32BE(data.length);
    h.write(type, 4);
    const end = Buffer.alloc(4);
    end.writeUInt32BE(crc32(Buffer.concat([h.subarray(4), data])));
    return Buffer.concat([h, data, end]);
  };
  const h = Buffer.alloc(13);
  h.writeUInt32BE(6144);
  h.writeUInt32BE(3456, 4);
  h[8] = 8;
  h[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', h),
    chunk('IDAT', deflateSync(Buffer.alloc((6144 * 3 + 1) * 3456), { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

it('does not admit an oversized object extracted from a document until its display copy is ready', async () => {
  const w = originalWorld();
  let release: (result: DisplayResult) => void = () => undefined;
  const ready = new Promise<DisplayResult>((done) => {
    release = done;
  });
  const prepareDisplay = vi.fn(async (candidate: { path: string; sha256: string }) => {
    expect(w.db.inTransaction).toBe(false);
    expect((await readPictureHeader(join(w.mediaDir, candidate.path)))?.size).toEqual({
      width: 6144,
      height: 3456,
    });
    return await ready;
  });
  try {
    const imported = await w.importPdf();
    const presentations = new PresentationRepo(w.db);
    const rows = presentations.content(imported.id);
    if (!rows) throw new Error('The generated source was not imported.');
    const { doc } = editDocOf(rows, 'Placeholder document');
    const before = w.db.prepare('SELECT COUNT(*) AS n FROM media').get();
    const reader: SourceReader = (request) => {
      mkdirSync(request.outDir, { recursive: true });
      const file = join(request.outDir, 'Placeholder large asset.png');
      writeFileSync(file, picture());
      return Promise.resolve({
        ok: true,
        total: 1,
        failed: [],
        pages: [
          {
            sourceIndex: 0,
            width: 960,
            height: 540,
            background: null,
            issues: [],
            elements: [
              {
                id: 'placeholder-native-image',
                kind: 'image',
                mediaId: 'placeholder-asset',
                fit: 'fill',
                frame: { x: 0, y: 0, width: 960, height: 540 },
              },
            ],
            assets: [{ token: 'placeholder-asset', file, kind: 'image' }],
          },
        ],
      });
    };
    const preparation = new ImportedSlides(w.db, w.mediaDir, {
      sourceReader: reader,
      sourceWrite: sourceWrite(w.db),
      prepareDisplay,
    });
    let finished = false;
    const preparing = preparation
      .prepare(rows, doc, 'placeholder-display-stamp', {
        signal: new AbortController().signal,
        allowed: () => true,
      })
      .then((result) => {
        finished = true;
        return result;
      });
    await vi.waitFor(() => expect(prepareDisplay.mock.calls.length > 0 || finished).toBe(true));
    expect(prepareDisplay).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    expect(w.db.prepare('SELECT COUNT(*) AS n FROM media').get()).toEqual(before);
    release({
      ok: true,
      copy: {
        key: 'placeholder-copy',
        width: 1920,
        height: 1080,
        path: 'display/placeholder.png',
        hash: 'a'.repeat(64),
        bytes: 42,
        ext: 'png',
      },
    });
    const prepared = await preparing;
    expect(prepared.issues).toEqual([]);
    expect(w.db.prepare('SELECT COUNT(*) AS n FROM media').get()).not.toEqual(before);
  } finally {
    release({ ok: false, message: 'Test finished.' });
    w.clean();
  }
});
