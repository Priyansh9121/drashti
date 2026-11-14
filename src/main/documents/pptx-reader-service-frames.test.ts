import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as protocol from './pptx-reader-protocol';
import { pptxReader } from './pptx-reader-service';

/*
 * C25's review LOW-2 and NIT-3: since PX-11 the page schema Main shares with the worker refuses a far frame first, so
 * Main's own frame check is never reached by the service's other tests. Main keeps it on purpose. Here the shared
 * schema loses its frame check, and Main's own must still refuse the page.
 */
vi.mock('./pptx-reader-protocol', async (original) => {
  const shared = await original<typeof protocol>();
  const { z } = await import('zod');
  const { slideElementSchema } = await import('../../shared/model-schema');
  const { EDITABLE_SOURCE_LIMITS } = await import('../../shared/editable-source');
  return {
    ...shared,
    pptxPageSchema: shared.pptxPageSchema.extend({
      elements: z.array(slideElementSchema).max(EDITABLE_SOURCE_LIMITS.pageElements),
    }),
  };
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const page = (x: number) => ({
  sourceIndex: 0,
  width: 960,
  height: 540,
  background: '#ffffff',
  elements: [
    {
      id: 'Placeholder shape',
      kind: 'shape',
      frame: { x, y: 0, width: 10, height: 10 },
      fill: '#123456',
      opacity: 1,
      cornerRadius: 0,
    },
  ],
  assets: [],
  issues: [],
});

it.each([
  [1_000_000, true],
  [1_000_001, false],
])('Main checks a drawing placed at %s itself, without the shared schema', async (x, kept) => {
  // The schema here lets any frame through, so only Main's own check can refuse it.
  expect(protocol.pptxPageSchema.safeParse(page(x)).success).toBe(true);
  const root = mkdtempSync(join(tmpdir(), 'drashti-source-frames-'));
  roots.push(root);
  const outDir = join(root, 'generated');
  mkdirSync(outDir);
  const sent: protocol.ToPptxReader[] = [];
  let message: (message: unknown) => void = () => undefined;
  let exit: (code: number) => void = () => undefined;
  const child: protocol.PptxReaderChild = {
    post: (start) => {
      sent.push(start);
    },
    onMessage: (listener) => {
      message = listener;
    },
    onExit: (listener) => {
      exit = listener;
    },
    kill: () => undefined,
  };
  const pending = pptxReader(() => child, { timeoutMs: 5_000, cancelGraceMs: 10, exitGraceMs: 10 })({
    ext: 'pptx',
    file: join(root, 'Placeholder.pptx'),
    outDir,
    sourcePages: [0],
    signal: new AbortController().signal,
    checkpoint: () => Promise.resolve(true),
  });
  await vi.waitFor(() => expect(sent).toHaveLength(1), { interval: 1 });
  const start = sent[0];
  if (start?.type !== 'read') throw new Error('No source start.');
  message({ type: 'prepared', jobId: start.jobId, total: 1, failed: [], pages: [page(x)] });
  exit(0);
  expect((await pending).ok).toBe(kept);
});
