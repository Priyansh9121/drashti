import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow, WebContents } from 'electron';
import { expect, it, vi } from 'vitest';
import type { PreparedSource } from '../../shared/editable-source';
import { EditablePdfSessions } from '../pictures/editable-pdf-session';
import { clippedDeckPdf } from './testing/pdf-native-effects';

class HiddenWindow extends EventEmitter {
  readonly webContents = Object.assign(new EventEmitter(), { id: 501 });
  private destroyed = false;

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
    this.emit('closed');
  }
}

it('returns only fully accepted PDF pages when the preparation budget ends', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drashti-pdf-deadline-'));
  const file = join(root, 'Placeholder clipped document.pdf');
  writeFileSync(file, clippedDeckPdf(4));
  const win = new HiddenWindow();
  const sender = { id: win.webContents.id } as WebContents;
  const { promise: opened, resolve: didOpen } = Promise.withResolvers<void>();
  const session = new EditablePdfSessions(() => {
    didOpen();
    return win as unknown as BrowserWindow;
  });
  let reading: Promise<PreparedSource> | undefined;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  try {
    reading = session.readNow({
      ext: 'pdf',
      file,
      outDir: join(root, 'output'),
      sourcePages: [0, 2],
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 5_000,
      checkpoint: () => Promise.resolve(true),
    });
    const done = vi.fn<(result: PreparedSource) => void>();
    void reading.then(done);
    await opened;
    const job = session.job(sender);
    if (!job) throw new Error('Missing editable PDF job.');
    expect(
      await session.page(sender, {
        mode: 'editable-checkpoint',
        jobId: job.jobId,
        sourceIndex: 0,
        total: 4,
      }),
    ).toBe(true);

    // This assertion concerns the Main transport and file write, not PDF/PNG decoding.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(
      await session.page(sender, {
        mode: 'editable-source',
        jobId: job.jobId,
        sourceIndex: 0,
        width: 480,
        height: 270,
        elements: [
          {
            id: 'placeholder-drawing',
            kind: 'image',
            mediaId: 'placeholder-png',
            fit: 'stretch',
            frame: { x: 12, y: 16, width: 20, height: 28 },
          },
        ],
        assets: [{ token: 'placeholder-png', png }],
        issues: [],
      }),
    ).toBe(true);

    // The second requested page stops responding; Main must finish before the outer deadline.
    await vi.advanceTimersByTimeAsync(4_900);
    expect(done).toHaveBeenCalledOnce();
    const prepared = await reading;
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.total).toBe(4);
    expect(prepared.pages.map((page) => page.sourceIndex)).toEqual([0]);
    expect(prepared.failed).toEqual([2]);
    const asset = prepared.pages[0]?.assets[0];
    if (!asset) throw new Error('The completed page’s generated asset was lost.');
    expect(readFileSync(asset.file)).toEqual(Buffer.from(png));
    expect(win.isDestroyed()).toBe(true);
    expect(session.job(sender)).toBeNull();
  } finally {
    session.stop();
    await reading;
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  }
});
