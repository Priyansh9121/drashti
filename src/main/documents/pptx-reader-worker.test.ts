import { EventEmitter } from 'node:events';
import type * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { EDITABLE_SOURCE_LIMITS } from '../../shared/editable-source';
import type { ShapeElement, SlideElement } from '../../shared/model';
import type { FromPptxReader } from './pptx-reader-protocol';
import { readEditableWithTiming } from './pptx-source-timing';

vi.mock('node:os', async (original) => ({
  ...(await original<typeof os>()),
  setPriority: vi.fn(),
}));
vi.mock('./pptx-source-timing', () => ({ readEditableWithTiming: vi.fn() }));

const { fileSizes } = vi.hoisted(() => ({ fileSizes: new Map<string, number>() }));
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof fs>()),
  lstat: (file: string) => Promise.resolve({ isFile: () => fileSizes.has(file), size: fileSizes.get(file) }),
}));

it('keeps valid siblings when PowerPoint pages exceed their individual editing limits, or a drawing has no frame', async () => {
  const shape: ShapeElement = {
    id: 'placeholder-shape',
    kind: 'shape',
    frame: { x: 0, y: 0, width: 100, height: 100 },
    fill: '#123456',
    opacity: 1,
    cornerRadius: 0,
  };
  const slide = { hidden: false, background: null, issues: [] };
  const image = (index: number): SlideElement => ({
    id: 'placeholder-image-' + String(index),
    kind: 'image',
    frame: shape.frame,
    mediaId: 'media-ref:' + String(index),
    fit: 'fit',
  });
  const outDir = join(os.tmpdir(), 'placeholder-output');
  const shared = join(outDir, 'placeholder-shared.png');
  const extra = join(outDir, 'placeholder-extra.png');
  // Only the file metadata is simulated. No large picture needs to be generated or read.
  fileSizes.set(shared, EDITABLE_SOURCE_LIMITS.pageAssetBytes);
  fileSizes.set(extra, 1);
  const previousNote = 'Page 3 of the original has more than 500 objects, so it stays as its saved picture.';
  const beyond = (page: number) =>
    `Page ${String(page)} of the original has an object placed or sized beyond what Drashti can edit, so it stays as its saved picture.`;
  // Only a fault in the reader could give a drawing no frame (C25's review LOW-1): that page alone fails.
  const noFrame = { ...shape, id: 'placeholder-no-frame', frame: null } as unknown as ShapeElement;

  vi.mocked(readEditableWithTiming).mockResolvedValueOnce({
    editable: {
      sourceCount: 7,
      width: 1280,
      height: 720,
      media: [shared, shared, extra].map((originalPath) => ({ kind: 'image', originalPath })),
      failedNotes: { 2: [previousNote] },
      slides: [
        { ...slide, sourceIndex: 0, elements: [{ ...shape, fill: 'placeholder-invalid-colour' }] },
        { ...slide, sourceIndex: 1, elements: [shape] },
        { ...slide, sourceIndex: 3, elements: [{ ...shape, frame: { ...shape.frame, x: 1_000_001 } }] },
        { ...slide, sourceIndex: 4, elements: [image(0), image(2)] },
        { ...slide, sourceIndex: 5, elements: [image(0), image(1)] },
        { ...slide, sourceIndex: 6, elements: [shape, noFrame] },
      ],
    },
    decks: new Map(),
    sourceVideoShapeIds: new Map(),
  });

  const port = new EventEmitter();
  const message = new Promise<FromPptxReader>((resolve) => {
    Object.assign(port, { postMessage: resolve });
  });
  const parent = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: port });
  try {
    await import('./pptx-reader-worker');
    port.emit('message', {
      data: {
        type: 'read',
        jobId: 'placeholder-job',
        file: join(os.tmpdir(), 'Placeholder.pptx'),
        outDir,
        sourcePages: [0, 1, 2, 3, 4, 5, 6],
      },
    });
    const result = await message;
    expect(result).toMatchObject({
      type: 'prepared',
      jobId: 'placeholder-job',
      total: 7,
      failed: [0, 2, 3, 4, 6],
      pages: [
        { sourceIndex: 1, elements: [shape] },
        { sourceIndex: 5, elements: [image(0), image(1)] },
      ],
    });
    // These notes and no others: page 0's bad colour has none, so Edit slides gives it the general line (NIT-2).
    expect(result.type === 'prepared' ? result.failedNotes : undefined).toEqual({
      2: [previousNote],
      3: [beyond(4)],
      4: [
        'Page 5 of the original has more than 32 MB of pictures, more than Drashti can edit on one page, so it stays as its saved picture.',
      ],
      6: [beyond(7)],
    });
  } finally {
    if (parent) Object.defineProperty(process, 'parentPort', parent);
    else Reflect.deleteProperty(process, 'parentPort');
  }
});
