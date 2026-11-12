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
/** A captured picture as Electron gives it: its size in pixels, its PNG, and its raw pixels (made-up values). */
const capturedImage = (width: number, height: number, empty = false) => ({
  isEmpty: () => empty,
  getSize: () => ({ width, height }),
  toPNG: vi.fn(() => Buffer.from('Generated effect pixels')),
  toBitmap: () => Buffer.alloc(width * height * 4, 7),
});
const metadata = [{ ref: { num: 3, gen: 0 }, view: [0, 0, 480, 319.91998], rotate: 0 }];
class Window extends EventEmitter {
  constructor(private readonly displayScale = 1) {
    super();
  }
  destroyed = false;
  setContentSize = vi.fn();
  webContents = Object.assign(new EventEmitter(), {
    id: 101,
    getOSProcessId: () => -1,
    printToPDF: vi.fn(() => Promise.resolve(bytes())),
    executeJavaScript: vi.fn(() => Promise.resolve(undefined)),
    capturePage: vi.fn((rect: { width: number; height: number }) =>
      Promise.resolve(
        capturedImage(Math.ceil(rect.width * this.displayScale), Math.ceil(rect.height * this.displayScale)),
      ),
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
function setup(size = { width: 480, height: 320 }, picture = false, displayScale = 1) {
  const win = new Window(displayScale);
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
    scaleFactor: () => displayScale,
    assetDirs: () => [],
    normalize,
  });
  sessions.add(session);
  const signal = new AbortController();
  const slide = { id: 'placeholder-page', ...size, background: '#ffffff', elements: [] };
  const current = () => admission.allowed;
  const result = picture
    ? session.picture(slide, {}, current, signal.signal)
    : session.run(
        {
          pages: [{ kind: 'native', slide }],
          sources: [],
        },
        current,
        signal.signal,
      );
  const own = win.webContents as unknown as WebContents;
  const other = { id: 202 } as WebContents;
  const job = session.job(own);
  if (!job) throw new Error('The private generated job was not admitted.');
  return { win, admission, normalize, session, signal, result, own, other, job };
}

it('returns a phone picture only from Main’s capture of its owned hidden window, as its pixels, never encoded on Main', async () => {
  const s = setup({ width: 2560, height: 1440 }, true);
  expect(s.job.picture).toMatchObject({ scale: 0.75 });
  expect(await s.session.print(s.own, s.job.id, 0)).toBeNull();
  expect(await s.session.capture(s.other, s.job.id, 0)).toBeNull();
  expect(await s.session.capture(s.own, 'different-job', 0)).toBeNull();
  // The captured pixels (made up: one blue, green, red and alpha repeated), and a copy to compare them with.
  const bitmap = Buffer.alloc(1920 * 1080 * 4).fill(Buffer.from([10, 20, 30, 255]));
  const image = { ...capturedImage(1920, 1080), toBitmap: () => bitmap };
  const expected = Buffer.from(bitmap);
  s.win.webContents.capturePage.mockImplementationOnce(() => Promise.resolve(image));
  // The hidden page is told nothing back: the pixels go to the phone.
  expect(await s.session.capture(s.own, s.job.id, 0)).toBeNull();
  // C6's review, MEDIUM 1: no PNG made on Main's thread; the network's process makes it.
  expect(image.toPNG).not.toHaveBeenCalled();
  const picture = await s.result;
  if (!picture || picture instanceof Uint8Array) throw new Error('No phone picture came back.');
  const { pixels, ...size } = picture;
  expect(size).toEqual({ width: 1920, height: 1080, order: 'bgra' });
  // Every byte as captured, compared as bytes: toEqual walks 8 MB of pixels one by one (over 20 s on CI's Ubuntu).
  expect(pixels).toBeInstanceOf(Uint8Array);
  expect(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength).equals(expected)).toBe(true);
  expect(s.win.setContentSize).toHaveBeenCalledWith(1920, 1080);
  expect(s.win.isDestroyed()).toBe(true);
});

it('draws a smaller native slide up to 1920 pixels on its long side', async () => {
  const s = setup({ width: 1280, height: 720 }, true);
  expect(s.job.picture).toMatchObject({ scale: 1.5 });
  expect(await s.session.capture(s.own, s.job.id, 0)).toBeNull();
  expect(s.win.setContentSize).toHaveBeenCalledWith(1920, 1080);
  expect(await s.result).toMatchObject({ width: 1920, height: 1080 });
});

it.each([
  { width: 1280, height: 720, cssHeight: 540, pictureHeight: 1080 },
  { width: 960, height: 720, cssHeight: 720, pictureHeight: 1440 },
])(
  'captures a $width by $height slide at 1920 device pixels on a 2× display',
  async ({ width, height, cssHeight, pictureHeight }) => {
    const s = setup({ width, height }, true, 2);
    expect(await s.session.capture(s.own, s.job.id, 0)).toBeNull();
    expect(s.win.setContentSize).toHaveBeenCalledWith(960, cssHeight);
    expect(s.win.webContents.capturePage).toHaveBeenCalledWith(
      { x: 0, y: 0, width: 960, height: cssHeight },
      { stayHidden: true },
    );
    expect(await s.result).toMatchObject({ width: 1920, height: pictureHeight });
  },
);

it.each([
  { width: 1920, height: 1080, factor: 1.75, css: [1097, 617], bitmap: [1920, 1080] },
  { width: 1920, height: 1200, factor: 1.75, css: [1097, 685], bitmap: [1920, 1199] },
  { width: 960, height: 720, factor: 1.75, css: [1097, 822], bitmap: [1920, 1439] },
  { width: 1920, height: 1080, factor: 2.25, css: [853, 480], bitmap: [1920, 1080] },
  { width: 1920, height: 1200, factor: 2.25, css: [853, 533], bitmap: [1920, 1200] },
  { width: 960, height: 720, factor: 2.25, css: [853, 640], bitmap: [1920, 1440] },
  { width: 720, height: 1280, factor: 1.75, css: [617, 1097], bitmap: [1080, 1920] },
])(
  'covers the whole capture of a $width by $height slide at $factor device scale',
  async ({ width, height, factor, css, bitmap }) => {
    const s = setup({ width, height }, true, factor);
    const drawScale = s.job.picture?.scale ?? 0;
    expect.soft(Math.max(width, height) * drawScale * factor).toBeCloseTo(1920, 8);
    expect(await s.session.capture(s.own, s.job.id, 0)).toBeNull();
    expect.soft(s.win.setContentSize).toHaveBeenCalledWith(...css);
    expect
      .soft(s.win.webContents.capturePage)
      .toHaveBeenCalledWith({ x: 0, y: 0, width: css[0], height: css[1] }, { stayHidden: true });
    const picture = await s.result;
    expect(picture).toMatchObject({ width: bitmap[0], height: bitmap[1] });
    expect(picture?.width).toBeLessThanOrEqual(Math.ceil(width * drawScale * factor));
    expect(picture?.height).toBeLessThanOrEqual(Math.ceil(height * drawScale * factor));
  },
);

it('checks the actual capture dimensions before copying a bitmap if its display changes', async () => {
  const s = setup({ width: 960, height: 720 }, true, 2);
  const toBitmap = vi.fn(() => Buffer.alloc(0));
  s.win.webContents.capturePage.mockResolvedValueOnce({ ...capturedImage(3840, 2880), toBitmap });
  expect(await s.session.capture(s.own, s.job.id, 0)).toBeNull();
  expect(toBitmap).not.toHaveBeenCalled();
  expect(await s.result).toBeNull();
});

it('ends a phone picture whose pixels are not its size, at once', async () => {
  const s = setup({ width: 1280, height: 720 }, true);
  s.win.webContents.capturePage.mockImplementationOnce(() =>
    Promise.resolve({ ...capturedImage(1280, 720), toBitmap: () => Buffer.alloc(16) }),
  );
  expect(await s.session.capture(s.own, s.job.id, 0)).toBeNull();
  expect(s.win.isDestroyed()).toBe(true);
  expect(await s.result).toBeNull();
});

describe('a phone’s picture, the lowest of the hidden window’s jobs (C6’s review, LOW 1 and LOW 4)', () => {
  it('gives way to the operator’s Save a PDF copy…, which goes ahead at once', async () => {
    const phoneWindow = new Window();
    const copyWindow = new Window();
    copyWindow.webContents.id = 102;
    const windows = [phoneWindow, copyWindow];
    const session = new PdfCopySession({
      open: () => windows.shift() as unknown as BrowserWindow,
      assetDirs: () => [],
      normalize: (data) => Promise.resolve(new Uint8Array(data)),
    });
    sessions.add(session);
    const slide = { id: 'placeholder-page', width: 1280, height: 720, background: '#ffffff', elements: [] };
    const picture = session.picture(slide, {}, () => true, new AbortController().signal);
    const copy = session.run(
      { pages: [{ kind: 'native', slide }], sources: [] },
      () => true,
      new AbortController().signal,
    );
    const job = session.job(copyWindow.webContents as unknown as WebContents);
    expect(job).not.toBeNull();
    expect(job?.picture).toBeUndefined();
    expect(phoneWindow.isDestroyed()).toBe(true);
    expect(await picture).toBeNull();
    // A phone's picture waits for nothing: while the operator's copy runs, it is refused at once.
    expect(await session.picture(slide, {}, () => true, new AbortController().signal)).toBeNull();
    session.stop();
    expect(await copy).toBeNull();
  });

  it('ends at once when its capture cannot be made, so the phone gets the slide as it starts without waiting', async () => {
    const s = setup({ width: 1280, height: 720 }, true);
    s.win.webContents.capturePage.mockImplementationOnce(() =>
      Promise.resolve(capturedImage(1280, 720, true)),
    );
    expect(await s.session.capture(s.own, s.job.id, 0)).toBeNull();
    expect(s.win.isDestroyed()).toBe(true);
    expect(await s.result).toBeNull();
  });
});

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
    finish({ ...capturedImage(640, 427), toPNG: vi.fn(() => Buffer.from('Generated late pixels')) });
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

// Admit a normal desktop canvas at print resolution; keep oversized captures bounded.
it('captures a default 1920 by 1080 native canvas at print resolution while staying hidden', async () => {
  const s = setup({ width: 1920, height: 1080 });
  try {
    expect(await s.session.capture(s.own, s.job.id, 0)).toEqual(
      new Uint8Array(Buffer.from('Generated effect pixels')),
    );
    expect(s.win.setContentSize).toHaveBeenCalledWith(2560, 1440);
    expect(s.win.webContents.capturePage).toHaveBeenCalledWith(
      { x: 0, y: 0, width: 2560, height: 1440 },
      { stayHidden: true },
    );
  } finally {
    s.session.stop();
    await s.result;
  }
});
it('still refuses an oversized 3840 by 2160 effect canvas before capture allocation', async () => {
  const s = setup({ width: 3840, height: 2160 });
  try {
    expect(await s.session.capture(s.own, s.job.id, 0)).toBeNull();
    expect(s.win.setContentSize).not.toHaveBeenCalled();
    expect(s.win.webContents.capturePage).not.toHaveBeenCalled();
  } finally {
    s.session.stop();
    await s.result;
  }
});
