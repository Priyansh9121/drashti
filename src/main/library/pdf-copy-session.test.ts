import { EventEmitter } from 'node:events';
import type { BrowserWindow, WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PdfPrintPage } from '../../shared/pdf-copy';
import { PdfCopySession } from './pdf-copy-session';

const sessions = new Set<PdfCopySession>();
afterEach(() => {
  for (const session of sessions) session.stop();
  sessions.clear();
});

const bytes = () => Buffer.from('%PDF-1.4\nGenerated protocol fixture\n%%EOF\n');
const metadata = [{ ref: { num: 3, gen: 0 }, view: [0, 0, 480, 319.91998], rotate: 0 }];
class Window extends EventEmitter {
  destroyed = false;
  setContentSize = vi.fn();
  webContents = Object.assign(new EventEmitter(), {
    id: 101,
    getOSProcessId: () => -1,
    printToPDF: vi.fn(() => Promise.resolve(bytes())),
    executeJavaScript: vi.fn(() => Promise.resolve(undefined)),
    capturePage: vi.fn(() =>
      Promise.resolve({ isEmpty: () => false, toPNG: () => Buffer.from('Generated effect pixels') }),
    ),
  });
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
}
function setup() {
  const win = new Window();
  const admission = { allowed: true };
  const normalize = vi.fn(
    (
      data: Uint8Array,
      _pages: PdfPrintPage[],
      _target: { width: number; height: number },
      _signal: AbortSignal,
    ) => Promise.resolve(new Uint8Array(data)),
  );
  const session = new PdfCopySession({
    open: () => win as unknown as BrowserWindow,
    assetDirs: () => [],
    normalize,
  });
  sessions.add(session);
  const signal = new AbortController();
  const result = session.run(
    {
      pages: [
        {
          kind: 'native',
          slide: { id: 'placeholder-page', width: 480, height: 320, background: '#ffffff', elements: [] },
        },
      ],
      sources: [],
    },
    () => admission.allowed,
    signal.signal,
  );
  const own = win.webContents as unknown as WebContents;
  const other = { id: 202 } as WebContents;
  const job = session.job(own);
  if (!job) throw new Error('The private generated job was not admitted.');
  return { win, admission, normalize, session, signal, result, own, other, job };
}

describe('the exact hidden PDF copy window protocol', () => {
  it('captures only the current owned sheet, keeps capture hidden and refuses it after printing', async () => {
    const s = setup();
    expect(await s.session.capture(s.other, s.job.id, 0)).toBeNull();
    expect(await s.session.capture(s.own, 'another-job', 0)).toBeNull();
    expect(await s.session.capture(s.own, s.job.id, 1)).toBeNull();
    expect(s.win.webContents.capturePage).not.toHaveBeenCalled();
    expect(await s.session.capture(s.own, s.job.id, 0)).toEqual(
      new Uint8Array(Buffer.from('Generated effect pixels')),
    );
    expect(s.win.setContentSize).toHaveBeenCalledWith(640, 427);
    expect(s.win.webContents.capturePage).toHaveBeenCalledWith(
      { x: 0, y: 0, width: 640, height: 427 },
      { stayHidden: true },
    );
    await s.session.print(s.own, s.job.id, 0);
    expect(await s.session.capture(s.own, s.job.id, 0)).toBeNull();
    expect(s.win.webContents.capturePage).toHaveBeenCalledTimes(1);
  });

  it('rejects overlapping captures and discards captured pixels after permission is withdrawn', async () => {
    const s = setup();
    let finish: ((image: Awaited<ReturnType<typeof s.win.webContents.capturePage>>) => void) | undefined;
    s.win.webContents.capturePage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = s.session.capture(s.own, s.job.id, 0);
    await vi.waitFor(() => expect(s.win.webContents.capturePage).toHaveBeenCalledOnce());
    expect(await s.session.capture(s.own, s.job.id, 0)).toBeNull();
    s.admission.allowed = false;
    expect(s.session.job(s.own)).toBeNull();
    expect(await s.result).toBeNull();
    if (!finish) throw new Error('The owned capture was not started.');
    finish({ isEmpty: () => false, toPNG: () => Buffer.from('Generated late pixels') });
    expect(await pending).toBeNull();
    expect(s.win.webContents.printToPDF).not.toHaveBeenCalled();
    expect(s.win.destroyed).toBe(true);
  });

  it('refuses another sender, a repeated job read and wrong print identity without normalizing', async () => {
    const s = setup();
    try {
      expect(s.session.job(s.other)).toBeNull();
      expect(s.session.job(s.own)).toBeNull();
      expect(await s.session.print(s.other, s.job.id, 0)).toBeNull();
      expect(await s.session.print(s.own, 'wrong-job', 0)).toBeNull();
      expect(await s.session.asset(s.other, 'wasmUrl', 'qcms_bg.wasm')).toBeNull();
      expect(s.normalize).not.toHaveBeenCalled();
      expect(s.win.destroyed).toBe(false);
    } finally {
      s.session.stop();
      await s.result;
    }
  });

  it('only normalizes bytes produced by its preceding Main print, then checks final exact geometry', async () => {
    const s = setup();
    expect(await s.session.normalized(s.own, s.job.id, 0, metadata)).toBeNull();
    expect(await s.session.print(s.own, s.job.id, 0)).toEqual(new Uint8Array(bytes()));
    expect(await s.session.print(s.own, s.job.id, 0)).toBeNull();
    expect(await s.session.normalized(s.other, s.job.id, 0, metadata)).toBeNull();
    expect(await s.session.normalized(s.own, s.job.id, 0, metadata)).toEqual(new Uint8Array(bytes()));
    expect(s.normalize).toHaveBeenCalledTimes(1);
    expect(s.normalize.mock.calls[0]?.[0]).toEqual(new Uint8Array(bytes()));
    expect(
      s.session.done(s.own, {
        id: s.job.id,
        data: new Uint8Array(bytes()),
        pages: [{ width: 480, height: 319.91998 }],
      }),
    ).toBe(false);
    expect(await s.result).toBeNull();
    expect(s.win.destroyed).toBe(true);
  });

  it('publishes only a complete correctly sized result after its print/normalization sequence', async () => {
    const s = setup();
    await s.session.print(s.own, s.job.id, 0);
    await s.session.normalized(s.own, s.job.id, 0, metadata);
    expect(
      s.session.done(s.other, {
        id: s.job.id,
        data: new Uint8Array(bytes()),
        pages: [{ width: 480, height: 320 }],
      }),
    ).toBe(false);
    expect(
      s.session.done(s.own, {
        id: s.job.id,
        data: new Uint8Array(bytes()),
        pages: [{ width: 480, height: 320 }],
      }),
    ).toBe(true);
    expect(await s.result).toEqual(new Uint8Array(bytes()));
    expect(s.win.destroyed).toBe(true);
  });

  it('cancels without accepting a late completed print after access is withdrawn', async () => {
    const s = setup();
    let complete: (data: ReturnType<typeof bytes>) => void = () => undefined;
    s.win.webContents.printToPDF.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const print = s.session.print(s.own, s.job.id, 0);
    s.admission.allowed = false;
    expect(s.session.job(s.own)).toBeNull();
    expect(await s.result).toBeNull();
    complete(bytes());
    expect(await print).toBeNull();
    expect(s.normalize).not.toHaveBeenCalled();
  });

  it('refuses a second concurrent export and shuts down an aborted owned window', async () => {
    const s = setup();
    expect(
      await s.session.run({ pages: [], sources: [] }, () => true, new AbortController().signal),
    ).toBeNull();
    s.signal.abort();
    expect(await s.result).toBeNull();
    expect(s.win.destroyed).toBe(true);
  });
});
