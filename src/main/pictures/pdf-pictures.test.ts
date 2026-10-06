import type { BrowserWindow, WebContents } from 'electron';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScreenConfig } from '../../shared/screens';
import { PdfPictures, pictureSize } from './pdf-pictures';

/*
 * Drawing a PDF's pages as pictures, the main process's side (Session 15): the
 * hidden window is a stand-in here; what it draws is tested end to end.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

class FakeWindow {
  destroyed = false;
  readonly handlers = new Map<string, () => void>();
  readonly webContents: {
    id: number;
    on: (e: string, f: () => void) => void;
    once: (e: string, f: () => void) => void;
    getOSProcessId: () => number;
  };

  constructor(id: number) {
    this.webContents = {
      id,
      on: (e, f) => this.handlers.set(e, f),
      once: (e, f) => this.handlers.set(e, f),
      // No such process: lowering its priority fails quietly.
      getOSProcessId: () => 2 ** 30,
    };
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
  }
}

function setup(assets: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-pdf-pictures-'));
  const pdf = join(dir, 'Placeholder.pdf');
  writeFileSync(pdf, '%PDF-1.4 placeholder');
  const windows: FakeWindow[] = [];
  const log: string[] = [];
  const pictures = new PdfPictures({
    open: () => {
      const w = new FakeWindow(100 + windows.length);
      windows.push(w);
      return w as unknown as BrowserWindow;
    },
    size: () => ({ width: 1920, height: 1080 }),
    assetDirs: () => assets,
    log: (m) => log.push(m),
  });
  const sender = (id: number) => ({ id }) as unknown as WebContents;
  // The window opens once the PDF has been read: wait for it.
  const opened = async () => {
    for (let i = 0; i < 100 && windows.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    const w = windows.at(-1);
    if (!w) throw new Error('no window');
    return w;
  };
  return { dir, pdf, pictures, windows, sender, opened, log };
}

describe('drawing a PDF as pictures (the main process)', () => {
  it('gives the job to the drawing window only, keeps each page as a PNG, and answers in page order', async () => {
    const t = setup();
    const out = join(t.dir, 'pages');
    const drawn = t.pictures.draw(t.pdf, out);
    const w = await t.opened();
    expect(t.pictures.job(t.sender(7))).toBeNull();
    const job = t.pictures.job(t.sender(w.webContents.id));
    expect(job).toMatchObject({ width: 1920, height: 1080, maxPages: 400 });
    expect(Buffer.from(job?.data ?? []).toString()).toBe('%PDF-1.4 placeholder');
    // Pages may come in any order; a page from another window is ignored.
    expect(
      await t.pictures.page(t.sender(w.webContents.id), { index: 1, png: PNG, notes: '  second  ' }),
    ).toBe(true);
    expect(await t.pictures.page(t.sender(w.webContents.id), { index: 0, png: PNG, notes: '' })).toBe(true);
    expect(await t.pictures.page(t.sender(9), { index: 2, png: PNG, notes: '' })).toBe(false);
    t.pictures.done(t.sender(w.webContents.id), { total: 3, failed: [2] });
    const result = await drawn;
    expect(result).toEqual({
      ok: true,
      width: 1920,
      height: 1080,
      pages: [
        { index: 0, file: join(out, 'page-0001.png'), notes: '' },
        { index: 1, file: join(out, 'page-0002.png'), notes: 'second' },
      ],
      total: 3,
      failed: [2],
    });
    expect(readFileSync(join(out, 'page-0002.png'))).toEqual(PNG);
    expect(existsSync(join(out, 'page-0003.png'))).toBe(false);
    // The window goes once the document is drawn.
    expect(w.destroyed).toBe(true);
  });

  it('keeps nothing that is not a PNG, or past the last page it may draw', async () => {
    const t = setup();
    const out = join(t.dir, 'pages');
    const drawn = t.pictures.draw(t.pdf, out);
    const w = await t.opened();
    const id = w.webContents.id;
    await t.pictures.page(t.sender(id), { index: 0, png: Buffer.from('not a picture'), notes: '' });
    await t.pictures.page(t.sender(id), { index: 400, png: PNG, notes: '' });
    await t.pictures.page(t.sender(id), { index: -1, png: PNG, notes: '' });
    t.pictures.done(t.sender(id), { total: 1, failed: [] });
    expect(await drawn).toEqual({ ok: false, message: 'No page could be drawn.' });
  });

  it('says why when the window could not read the PDF', async () => {
    const t = setup();
    const drawn = t.pictures.draw(t.pdf, join(t.dir, 'pages'));
    const w = await t.opened();
    t.pictures.done(t.sender(w.webContents.id), {
      total: 0,
      failed: [],
      error: 'The PDF is protected with a password: save a copy without one and import that.',
    });
    expect(await drawn).toEqual({
      ok: false,
      message: 'The PDF is protected with a password: save a copy without one and import that.',
    });
  });

  it('stops when the import is cancelled, and when the window stops', async () => {
    const t = setup();
    const stop = new AbortController();
    const cancelled = t.pictures.draw(t.pdf, join(t.dir, 'a'), stop.signal);
    const first = await t.opened();
    stop.abort();
    expect(await cancelled).toEqual({ ok: false, message: 'Cancelled.' });
    expect(first.destroyed).toBe(true);
    // One document at a time: the next has a window of its own.
    const crashed = t.pictures.draw(t.pdf, join(t.dir, 'b'));
    for (let i = 0; i < 100 && t.windows.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    t.windows[1]?.handlers.get('render-process-gone')?.();
    expect(await crashed).toEqual({
      ok: false,
      message: 'The window drawing the pages stopped unexpectedly.',
    });
  });

  it('gives pdf.js its own data by plain name only, from the first folder that has it', async () => {
    const t0 = mkdtempSync(join(tmpdir(), 'drashti-pdfjs-'));
    const [a, b] = [join(t0, 'a'), join(t0, 'b')];
    mkdirSync(a);
    mkdirSync(b);
    writeFileSync(join(b, 'FoxitSymbol.pfb'), 'placeholder font');
    writeFileSync(join(t0, 'secret.txt'), 'not for pdf.js');
    const t = setup([a, b]);
    const drawn = t.pictures.draw(t.pdf, join(t.dir, 'pages'));
    const w = await t.opened();
    const id = w.webContents.id;
    expect(
      Buffer.from(
        (await t.pictures.asset(t.sender(id), 'standardFontDataUrl', 'FoxitSymbol.pfb')) ?? [],
      ).toString(),
    ).toBe('placeholder font');
    expect(await t.pictures.asset(t.sender(id), 'standardFontDataUrl', '../secret.txt')).toBeNull();
    expect(await t.pictures.asset(t.sender(id), 'standardFontDataUrl', '.hidden')).toBeNull();
    expect(await t.pictures.asset(t.sender(id), 'somethingElse', 'FoxitSymbol.pfb')).toBeNull();
    expect(await t.pictures.asset(t.sender(3), 'standardFontDataUrl', 'FoxitSymbol.pfb')).toBeNull();
    t.pictures.done(t.sender(id), { total: 0, failed: [] });
    await drawn;
  });
});

describe('the size pictures are made at', () => {
  const screen = (groupId: string, w: number, h: number) =>
    ({ id: `${groupId}-s`, groupId, canvasWidth: w, canvasHeight: h }) as ScreenConfig;
  it("is the first audience group's canvas, or 1920 × 1080", () => {
    expect(pictureSize([screen('stage', 1280, 720), screen('hall', 3840, 1080)], 'hall')).toEqual({
      width: 3840,
      height: 1080,
    });
    expect(pictureSize([], null)).toEqual({ width: 1920, height: 1080 });
    expect(pictureSize([screen('hall', 99_999, 10)], 'hall')).toEqual({ width: 7680, height: 180 });
  });
});
