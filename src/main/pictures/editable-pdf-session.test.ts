import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow, WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceRead } from '../documents/source-reader';
import { EditablePdfSessions } from './editable-pdf-session';

// This is a private-transport test. Real PDF extraction is covered by the real source/core and native E2E tests.
class Window extends EventEmitter {
  destroyed = false;
  webContents = Object.assign(new EventEmitter(), { id: 500, getOSProcessId: () => 2 ** 30 });
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
    this.emit('closed');
  }
}
const roots: string[] = [];
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'drashti-editable-pdf-'));
  roots.push(root);
  const file = join(root, 'Placeholder.pdf');
  writeFileSync(file, '%PDF-1.4 Placeholder transport fixture');
  const outDir = join(root, 'generated');
  const stop = new AbortController();
  const win = new Window();
  const session = new EditablePdfSessions(() => win as unknown as BrowserWindow);
  const request: SourceRead = {
    ext: 'pdf',
    file,
    outDir,
    sourcePages: [0],
    signal: stop.signal,
    checkpoint: () => Promise.resolve(true),
  };
  const sender = { id: win.webContents.id } as WebContents;
  const foreign = { id: 501 } as WebContents;
  return { root, outDir, stop, win, session, request, sender, foreign };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('private editable PDF session', () => {
  it('accepts only its hidden sender and allocates generated files in Main', async () => {
    const t = setup();
    const result = t.session.readNow(t.request);
    await vi.waitFor(() => expect(t.session.job(t.sender)).not.toBeNull(), { interval: 1 });
    const job = t.session.job(t.sender);
    if (!job) throw new Error('No editable source job.');
    expect(t.session.job(t.foreign)).toBeNull();
    const page = {
      mode: 'editable-source',
      jobId: job.jobId,
      sourceIndex: 0,
      width: 960,
      height: 540,
      elements: [
        {
          id: 'Placeholder image',
          kind: 'image',
          mediaId: 'pdf-paint-1',
          fit: 'stretch',
          frame: { x: 1, y: 2, width: 30, height: 40 },
        },
      ],
      assets: [{ token: 'pdf-paint-1', png }],
      issues: [],
    };
    expect(await t.session.page(t.foreign, page)).toBe(false);
    expect(readdirSync(t.outDir)).toEqual([]);
    expect(await t.session.page(t.sender, page)).toBe(true);
    t.session.done(t.sender, { mode: 'editable-source', jobId: job.jobId, total: 1, failed: [] });
    const prepared = await result;
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.message);
    const asset = prepared.pages[0]?.assets[0];
    expect(asset?.file).toMatch(/generated[/\\][0-9a-f-]+\.png$/u);
    if (!asset) throw new Error('No generated asset.');
    expect(readFileSync(asset.file)).toEqual(Buffer.from(png));
    expect(t.win.destroyed).toBe(true);
    expect(t.session.job(t.sender)).toBeNull();
    expect(await t.session.page(t.sender, page)).toBe(false);
  });

  it('cancels a blocked checkpoint without accepting a late page or stranding Main output', async () => {
    const t = setup();
    let blocked = false;
    const result = t.session.readNow({
      ...t.request,
      checkpoint: () => (blocked ? new Promise<boolean>(() => undefined) : Promise.resolve(true)),
    });
    await vi.waitFor(() => expect(t.session.job(t.sender)).not.toBeNull(), { interval: 1 });
    const job = t.session.job(t.sender);
    if (!job) throw new Error('No editable source job.');
    blocked = true;
    const acknowledgement = t.session.page(t.sender, {
      mode: 'editable-checkpoint',
      jobId: job.jobId,
      sourceIndex: 0,
    });
    t.stop.abort();
    expect(await acknowledgement).toBe(false);
    expect((await result).ok).toBe(false);
    expect(t.win.destroyed).toBe(true);
    expect(readdirSync(t.outDir)).toEqual([]);
  });
});
