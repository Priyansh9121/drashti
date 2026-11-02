import { describe, expect, it } from 'vitest';
import type { PreparedSource } from '../../shared/editable-source';
import { StopList } from '../lifecycle';
import { SourceReaderQueue } from './source-reader-queue';

describe('source preparation before library shutdown', () => {
  it('drains owned source work before the library-close step', async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const queue = new SourceReaderQueue(
      (request) =>
        new Promise<PreparedSource>((resolve) => {
          release = () => {
            order.push('source drained');
            resolve({ ok: false, message: 'Placeholder stopped' });
          };
          request.signal.addEventListener('abort', () => undefined, { once: true });
          started();
        }),
    );
    const pending = queue.read({
      ext: 'pptx',
      file: '/Placeholder/source.pptx',
      outDir: '/Placeholder/output',
      sourcePages: [0],
      signal: new AbortController().signal,
      checkpoint: () => Promise.resolve(true),
    });
    await running;
    const stops = new StopList(() => undefined);
    let draining = Promise.resolve();
    // Same existing-API registration pattern as index.ts, not a missing future module.
    stops.add('document preparation', () => {
      draining = queue.stop();
      return draining;
    });
    stops.addLast('library', () => {
      order.push('library closed');
    });
    try {
      stops.run();
      release();
      await pending;
      await draining;
      // Current actual order is library closed, then source drained.
      expect(order).toEqual(['source drained', 'library closed']);
    } finally {
      release();
      await queue.stop();
    }
  });
});
