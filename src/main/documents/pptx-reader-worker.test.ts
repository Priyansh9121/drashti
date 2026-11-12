import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { ShapeElement } from '../../shared/model';
import type { FromPptxReader } from './pptx-reader-protocol';
import { readEditableWithTiming } from './pptx-source-timing';

vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  setPriority: vi.fn(),
}));
vi.mock('./pptx-source-timing', () => ({ readEditableWithTiming: vi.fn() }));

it('reports the invalid page and still returns its valid sibling', async () => {
  const shape: ShapeElement = {
    id: 'placeholder-shape',
    kind: 'shape',
    frame: { x: 0, y: 0, width: 100, height: 100 },
    fill: '#123456',
    opacity: 1,
    cornerRadius: 0,
  };
  const slide = { hidden: false, background: null, issues: [] };
  vi.mocked(readEditableWithTiming).mockResolvedValueOnce({
    editable: {
      sourceCount: 3,
      width: 1280,
      height: 720,
      media: [],
      slides: [
        { ...slide, sourceIndex: 0, elements: [{ ...shape, fill: 'placeholder-invalid-colour' }] },
        { ...slide, sourceIndex: 1, elements: [shape] },
      ],
    },
    decks: new Map(),
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
        file: join(tmpdir(), 'Placeholder.pptx'),
        outDir: tmpdir(),
        sourcePages: [0, 1, 2],
      },
    });
    const result = await message;
    expect(result).toMatchObject({
      type: 'prepared',
      jobId: 'placeholder-job',
      total: 3,
      failed: [0, 2],
      pages: [{ sourceIndex: 1, elements: [shape] }],
    });
  } finally {
    if (parent) Object.defineProperty(process, 'parentPort', parent);
    else Reflect.deleteProperty(process, 'parentPort');
  }
});
