import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
  outputPage,
  type PageGlobals,
  setUpScreen,
  windowShowing,
} from './helpers';
import { goLive, makeSlides } from './placeholder-slides';

/*
 * X19, L8 (Q59-5; the owner's Q60-26, "B, wait for L8"): a screen turned on or reloaded mid-show draws nothing of the
 * live slide until its pictures can be drawn (Q58-52's first draw: at most 3 s from the page being ready). The live
 * slide's own picture must come first: its native decode finishes before a decode is asked for any of Next's pictures,
 * and it first shows whole (never part of it, nor the slide without it), at most 3 s after the page is ready (its fonts
 * and its warm-up), as before. Next is still loaded ahead, and a cut to it is at once.
 *
 * The order is read from a log the test keeps in the page (drashtiCurrentFirstProbe): an init script wraps
 * HTMLImageElement.prototype.decode, notes when each decode is asked and when the browser's own promise settles, and
 * returns that same promise. The pixels are the window's own frames from Main's frame subscription (kept across a
 * reload), shrunk to a grid over the picture's actual place on the page. Each document draws a small white mark of its
 * own in the top-left corner, at its own spot: after a reload the old document's surface stays up until the new one
 * draws, and only frames with the new document's mark count. Plain reloads, with no decode wrapped, keep their raw
 * times (reload to first whole frame, ready to first whole frame), for the change's before and after. Generated noise
 * pictures only; nothing recorded, no real display captured, nothing sent anywhere.
 */

type Place = 'hall' | 'stream';

/** The live slide's picture: one large picture, noise around this grey. */
const LIVE = { grey: 208, size: { width: 6144, height: 3456 } };
/** Next's pictures: three large ones (its left half, right top, right bottom), each its own grey. */
const NEXT_GREYS = [56, 104, 152] as const;
const NEXT_SIZE = { width: 4096, height: 2304 };
/** Each slide's own colour, under its pictures: on screen only where a picture is not drawn. */
const LIVE_BACKGROUND = [160, 32, 128] as const;
const NEXT_BACKGROUND = [32, 64, 96] as const;
const hex = (rgb: readonly number[]) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
/** A frame shrunk to this grid (the whole page). */
const COLS = 32;
const ROWS = 18;
/** How far a grid cell may be from its colour (the noise averages out; colour management moves a grey a little). */
const NEAR = 20;
/** The existing longest wait of a screen's first slide for its pictures, from the page being ready (unchanged). */
const SHOWN_BY_MS = 3000;
/** The capture's budget for one document, as slide-decode-first.spec.ts's. */
const BUDGET_MS = 20_000;
/** Each document's mark: 8 x 8 px at (12 n, 0), n its number in the test. */
const SPOTS = 6;

/** One native decode asked in a page. */
interface Decode {
  mediaId: string;
  role: 'live' | 'next' | 'other';
  /** When it was asked, and when the browser's own promise settled (the page's wall clock, ms). */
  start: number;
  end: number | null;
  outcome: 'pending' | 'decoded' | 'failed';
}

/** What the test keeps in each output or stream page (its init scripts). */
interface CurrentFirstProbe {
  /** Its mark's spot: its number in the test. */
  spot: number;
  /** When its root said it was ready to draw the show (data-fonts="ready"; the page's wall clock, ms). */
  readyAt: number | null;
  /** Every native decode asked in it while the decode log was on. */
  decodes: Decode[];
}

type ProbeGlobals = typeof globalThis & { drashtiCurrentFirstProbe?: CurrentFirstProbe };

/** One frame of a window, as Main had it. */
interface Grab {
  /** When (Main's wall clock, ms). */
  t: number;
  /** The spot whose mark it shows (the document drawn), or -1 for none or more than one. */
  spot: number;
  /** The frame shrunk to COLS x ROWS: its BGRA bytes, base64. */
  grid: string;
}

type GrabGlobals = typeof globalThis & {
  drashtiCurrentFirstFrames?: Partial<Record<Place, Grab[]>>;
  /** When Main's frame subscription of each window began (Main's wall clock, ms). */
  drashtiCurrentFirstSubscribed?: Partial<Record<Place, number>>;
};

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** A PNG chunk: its length, type, data and CRC. */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  let c = 0xffffffff;
  for (const part of [head.subarray(4), data])
    for (const byte of part) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([head, data, tail]);
}

/** A large RGB PNG of noise around one grey (the noise keeps it from decoding as a flat colour), made here. */
function noisePicture(
  file: string,
  size: { width: number; height: number },
  grey: number,
  seed: number,
): string {
  const { width, height } = size;
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  let s = seed;
  for (let y = 0; y < height; y++) {
    // Each row's first byte, its filter, stays 0 (none).
    for (let o = y * stride + 1, end = (y + 1) * stride; o < end; o += 3) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      const v = grey + ((s >>> 0) % 33) - 16;
      raw[o] = v;
      raw[o + 1] = v;
      raw[o + 2] = v;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits a channel
  header[9] = 2; // RGB; compression, filter and interlace 0
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw, { level: 1 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
  return file;
}

/** In each output or stream page from its first moment: its own mark at its spot, and when its root is ready. */
function pageProbe(spot: number): void {
  const page = location.pathname.split('/').pop() ?? '';
  if (
    (page !== 'output.html' && page !== 'stream.html') ||
    new URLSearchParams(location.search).has('identify')
  )
    return;
  const g = globalThis as ProbeGlobals;
  const probe = g.drashtiCurrentFirstProbe ?? { spot, readyAt: null, decodes: [] };
  g.drashtiCurrentFirstProbe = probe;
  probe.spot = spot;
  const mark = document.createElement('div');
  mark.setAttribute('aria-hidden', 'true');
  mark.setAttribute('data-current-first-mark', String(spot));
  mark.style.cssText = `position:fixed;left:${String(12 * spot)}px;top:0;width:8px;height:8px;background:#fff;z-index:2147483647;pointer-events:none`;
  // Before the page's own markup is parsed there is no <html> yet: the mark goes in as soon as there is.
  const place = () => {
    const html = document.documentElement as HTMLElement | null;
    if (!html) return false;
    html.appendChild(mark);
    return true;
  };
  if (!place())
    new MutationObserver((_, watch) => {
      if (place()) watch.disconnect();
    }).observe(document, { childList: true });
  const ready = () => {
    if (
      probe.readyAt === null &&
      document.querySelector(
        '[data-testid="output-root"][data-fonts="ready"], [data-testid="program-root"][data-fonts="ready"]',
      )
    )
      probe.readyAt = performance.timeOrigin + performance.now();
  };
  new MutationObserver(ready).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-fonts'],
  });
}

/**
 * In each output or stream page from its first moment: every native decode asked, its picture and role, when asked and
 * when settled. The browser's own promise is returned unchanged.
 */
function decodeLog({ live, next }: { live: string; next: string[] }): void {
  const page = location.pathname.split('/').pop() ?? '';
  if (
    (page !== 'output.html' && page !== 'stream.html') ||
    new URLSearchParams(location.search).has('identify')
  )
    return;
  const g = globalThis as ProbeGlobals;
  const probe = g.drashtiCurrentFirstProbe ?? { spot: -1, readyAt: null, decodes: [] };
  g.drashtiCurrentFirstProbe = probe;
  const wall = () => performance.timeOrigin + performance.now();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with the image as its receiver
  const native = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
    const mediaId =
      /^drashti-media:\/\/(?:media|display|sharp)\/([^?#/]+)/iu.exec(this.src || this.currentSrc)?.[1] ?? '';
    const entry: Decode = {
      mediaId,
      role: mediaId === live ? 'live' : next.includes(mediaId) ? 'next' : 'other',
      start: wall(),
      end: null,
      outcome: 'pending',
    };
    probe.decodes.push(entry);
    const decoding = native.call(this);
    void decoding.then(
      () => {
        entry.end = wall();
        entry.outcome = 'decoded';
      },
      () => {
        entry.end = wall();
        entry.outcome = 'failed';
      },
    );
    return decoding;
  };
}

/** Every frame each new output or stream window draws, from its page's first moments, kept across its reloads. */
async function recordFrames(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ app }, { cols, rows, spots }) => {
      const kept: Partial<Record<'hall' | 'stream', Grab[]>> = {};
      const subscribed: Partial<Record<'hall' | 'stream', number>> = {};
      (globalThis as GrabGlobals).drashtiCurrentFirstFrames = kept;
      (globalThis as GrabGlobals).drashtiCurrentFirstSubscribed = subscribed;
      app.on('browser-window-created', (_event, w) => {
        // From its page's first moments: a frame subscription before then gets nothing (warm-up.spec.ts).
        w.webContents.once('dom-ready', () => {
          const url = w.webContents.getURL();
          const place = url.includes('/stream.html')
            ? 'stream'
            : url.includes('/output.html') && !url.includes('identify=')
              ? 'hall'
              : null;
          if (place === null || kept[place]) return;
          const frames: Grab[] = [];
          kept[place] = frames;
          subscribed[place] = Date.now();
          w.webContents.beginFrameSubscription(false, (image) => {
            const t = Date.now();
            const { width, height } = image.getSize();
            const dips = w.getContentBounds().width;
            if (width < 16 || height < 16 || dips <= 0) return;
            const scale = width / dips;
            const lit: number[] = [];
            for (let n = 0; n < spots; n++) {
              const bytes = image
                .crop({
                  x: Math.round((12 * n + 2) * scale),
                  y: Math.round(2 * scale),
                  width: Math.max(1, Math.round(4 * scale)),
                  height: Math.max(1, Math.round(4 * scale)),
                })
                .toBitmap();
              let white = bytes.length > 0;
              for (let i = 0; i + 2 < bytes.length; i += 4)
                if ((bytes[i] ?? 0) < 235 || (bytes[i + 1] ?? 0) < 235 || (bytes[i + 2] ?? 0) < 235)
                  white = false;
              if (white) lit.push(n);
            }
            frames.push({
              t,
              spot: lit.length === 1 ? (lit[0] ?? -1) : -1,
              grid: image
                .resize({ width: cols, height: rows, quality: 'good' })
                .toBitmap()
                .toString('base64'),
            });
          });
        });
      });
    },
    { cols: COLS, rows: ROWS, spots: SPOTS },
  );
}

/** Main's frames of `place`'s window from `since` on, fetched a part at a time. */
function frameReader(app: ElectronApplication, place: Place): (since: number) => Promise<Grab[]> {
  const all: Grab[] = [];
  return async (since) => {
    const more = await app.evaluate(
      (_electron, { place, count }) =>
        ((globalThis as GrabGlobals).drashtiCurrentFirstFrames?.[place] ?? []).slice(count),
      { place, count: all.length },
    );
    all.push(...more);
    return all.filter((f) => f.t >= since);
  };
}

/** Whether `ok` comes true within `ms` (asked again and again, as expect.poll asks), without failing the test. */
async function until(ok: () => Promise<boolean>, ms: number): Promise<boolean> {
  try {
    await expect.poll(ok, { timeout: ms }).toBe(true);
    return true;
  } catch {
    return false;
  }
}

/** What `get` finds within `ms` (asked again and again), or null. */
async function found<T>(get: () => Promise<T | null>, ms: number): Promise<T | null> {
  const seen: { value: T | null } = { value: null };
  await until(async () => {
    seen.value = await get();
    return seen.value !== null;
  }, ms);
  return seen.value;
}

/** A rectangle in fractions of the page's width and height. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Rgb = readonly [number, number, number];

const inside = (a: Box, b: Box) =>
  a.x >= b.x - 1e-9 && a.y >= b.y - 1e-9 && a.x + a.w <= b.x + b.w + 1e-9 && a.y + a.h <= b.y + b.h + 1e-9;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The grid's cells whose every pixel, a cell beyond each side too (the shrinking filter's reach), is in `box`. */
function cellsIn(box: Box, out: Box[] = []): number[] {
  const cells: number[] = [];
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const reach = { x: (x - 1) / COLS, y: (y - 1) / ROWS, w: 3 / COLS, h: 3 / ROWS };
      if (inside(reach, box) && !out.some((o) => overlaps(reach, o))) cells.push(y * COLS + x);
    }
  return cells;
}

const grey = (g: number): Rgb => [g, g, g];
const near = (p: Rgb, q: Rgb) => p.every((v, i) => Math.abs(v - (q[i] ?? 0)) <= NEAR);

/** A frame's cells as red, green and blue. */
function cellsOf(frame: Grab): (cell: number) => Rgb {
  const grid = Buffer.from(frame.grid, 'base64');
  return (cell) => [grid[cell * 4 + 2] ?? 0, grid[cell * 4 + 1] ?? 0, grid[cell * 4] ?? 0];
}

/** What of a picture a frame shows in its cells (all, none or part), and whether the slide's own colour shows there. */
function lookAt(
  frame: Grab,
  cells: number[],
  rgb: Rgb,
  bare: Rgb,
): { shown: 'whole' | 'none' | 'part'; bare: boolean } {
  const at = cellsOf(frame);
  let hit = 0;
  let without = false;
  for (const cell of cells) {
    const p = at(cell);
    if (near(p, rgb)) hit++;
    else if (near(p, bare)) without = true;
  }
  return {
    shown: cells.length > 0 && hit === cells.length ? 'whole' : hit === 0 ? 'none' : 'part',
    bare: without,
  };
}

/** One document of the screen (turned on, or reloaded) as the test saw it. */
interface Doc {
  what: string;
  spot: number;
  /** When it was asked for: the screen turned on or the reload (the test's wall clock, ms). */
  since: number;
  readyAt: number | null;
  /** Its decode log; null where none was kept (a plain reload). */
  decodes: Decode[] | null;
  /** Its frames (with its mark), from `since` on: when, and what of the live picture each shows. */
  seen: { t: number; shown: 'whole' | 'none' | 'part'; bare: boolean }[];
  /** Frames from `since` without its mark: the old document's surface, or no mark at all. */
  others: number;
  firstWhole: number | null;
  /** Next's pictures loaded ahead in this page (its Preloader's data-state="ready"). */
  nextReady: boolean;
  /** What could not be read (the instrument's own trouble, said apart from the verdicts). */
  problems: string[];
}

interface Ids {
  live: string;
  next: string[];
}

const rootOf = (place: Place) => (place === 'hall' ? 'output-root' : 'program-root');

/** The page's box of the slide's picture with this media id, while it is the slide shown (not waiting); else null. */
const shownBox = (page: Page, place: Place, mediaId: string) =>
  page.evaluate(
    ({ root, mediaId }) => {
      const layer = document.querySelector(`[data-testid="${root}"] [data-layer="slide"]`);
      if (!layer || layer.getAttribute('data-fading') === 'true') return null;
      const img = layer.querySelector(`[data-slide-in] img[src*="${mediaId}"]`);
      if (!img) return null;
      const r = img.getBoundingClientRect();
      return {
        x: r.left / innerWidth,
        y: r.top / innerHeight,
        w: r.width / innerWidth,
        h: r.height / innerHeight,
      };
    },
    { root: rootOf(place), mediaId },
  );

/** Evidence only after a bad native frame or an already failed readiness check; this never prepares a passing image. */
async function sayStartupFailure(app: ElectronApplication, page: Page, what: string): Promise<void> {
  const bounded = async <T>(label: string, promise: Promise<T>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<{ timedOut: string }>((resolve) => {
          timer = setTimeout(() => resolve({ timedOut: label }), 1000);
        }),
      ]);
    } catch (error) {
      return { failed: label, error: String(error) };
    } finally {
      clearTimeout(timer);
    }
  };
  const dom = await bounded(
    'failed output DOM',
    page.evaluate(() => {
      const describe = (el: Element) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          tag: el.tagName,
          attributes: Object.fromEntries(
            [...el.attributes].filter((a) => a.name !== 'src').map((a) => [a.name, a.value]),
          ),
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          opacity: s.opacity,
          display: s.display,
          visibility: s.visibility,
          background: s.backgroundColor,
          transform: s.transform,
          willChange: s.willChange,
          contentVisibility: s.contentVisibility,
          contain: s.contain,
          filter: s.filter,
          isolation: s.isolation,
          blend: s.mixBlendMode,
        };
      };
      const root = document.querySelector('[data-testid="output-root"], [data-testid="program-root"]');
      const globals = globalThis as typeof globalThis & {
        drashtiCurrentFirstProbe?: unknown;
        drashtiStartupBound?: { calls: unknown[]; releasedAt: number | null };
      };
      return {
        at: performance.timeOrigin + performance.now(),
        url: location.href,
        visibility: document.visibilityState,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        root: root ? describe(root) : null,
        layers: [...document.querySelectorAll('[data-layer], [data-slide-in], [data-slide]')]
          .slice(0, 20)
          .map(describe),
        images: [...document.images].slice(0, 16).map((img) => {
          const ancestors: ReturnType<typeof describe>[] = [];
          for (let el = img.parentElement, n = 0; el && n < 10; el = el.parentElement, n++)
            ancestors.push(describe(el));
          return {
            ...describe(img),
            src: img.src,
            currentSrc: img.currentSrc,
            complete: img.complete,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            decoding: img.decoding,
            ancestors,
          };
        }),
        readiness: globals.drashtiCurrentFirstProbe ?? null,
        bound: globals.drashtiStartupBound
          ? { calls: globals.drashtiStartupBound.calls, releasedAt: globals.drashtiStartupBound.releasedAt }
          : null,
      };
    }),
  );
  const windows = await bounded(
    'failed output windows',
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => ({
        id: w.id,
        url: w.webContents.getURL(),
        visible: w.isVisible(),
        minimized: w.isMinimized(),
        focused: w.isFocused(),
        bounds: w.getBounds(),
        contentBounds: w.getContentBounds(),
      })),
    ),
  );
  console.log(`STARTUP FAILURE STATE ${JSON.stringify({ what, dom, windows })}`);
  // A native readback can request painting. Do it ONLY after the original failure is recorded; it cannot erase it.
  const readback = await bounded(
    'post-failure native image',
    app.evaluate(async ({ BrowserWindow }, url) => {
      const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url);
      if (!w) return { missingWindow: true };
      const image = await w.webContents.capturePage();
      return {
        at: Date.now(),
        id: w.id,
        size: image.getSize(),
        grid: image.resize({ width: 32, height: 18, quality: 'good' }).toBitmap().toString('base64'),
      };
    }, page.url()),
  );
  console.log(`STARTUP FAILURE READBACK ${JSON.stringify({ what, readback })}`);
}

/** Watch one document come up and show the live slide, reading its decode log (if kept), readiness and frames. */
async function observe(
  app: ElectronApplication,
  page: Page,
  place: Place,
  frames: (since: number) => Promise<Grab[]>,
  ids: Ids,
  doc: { what: string; spot: number; since: number; logged: boolean },
): Promise<Doc> {
  const problems: string[] = [];
  // The page comes up by itself (fonts, then its warm-up or none): nothing else can be read before it.
  await expect(page.getByTestId(rootOf(place))).toHaveAttribute('data-fonts', 'ready', { timeout: 60_000 });
  const box = await found(() => shownBox(page, place, ids.live), BUDGET_MS);
  if (!box) problems.push('the page did not show the live slide within 20 s of being ready');
  const cells = box ? cellsIn(box) : [];
  const live = grey(LIVE.grey);
  const diagnostic = { done: false };
  const diagnoseBad = async (all: Grab[]) => {
    if (diagnostic.done) return;
    const bad = all.filter((f) => {
      if (f.spot !== doc.spot) return false;
      const seen = lookAt(f, cells, live, LIVE_BACKGROUND);
      return seen.shown === 'part' || seen.bare;
    });
    if (bad.length === 0) return;
    diagnostic.done = true;
    console.log(
      'STARTUP BAD FRAMES ' +
        JSON.stringify({
          place,
          what: doc.what,
          box,
          frames: bad.map((f) => ({ t: f.t, ...lookAt(f, cells, live, LIVE_BACKGROUND) })),
        }),
    );
    await sayStartupFailure(app, page, place + ' ' + doc.what + ' after first recorded bad frame');
  };
  const whole = async () => {
    const all = await frames(doc.since);
    await diagnoseBad(all);
    return all.some((f) => f.spot === doc.spot && lookAt(f, cells, live, LIVE_BACKGROUND).shown === 'whole');
  };
  if (!(await until(async () => (await frames(0)).length > 0, BUDGET_MS)))
    problems.push('Main’s frame subscription gave no frame of this window at all');
  else if (cells.length > 0 && !(await until(whole, BUDGET_MS)))
    problems.push(
      'no frame of this document with the live picture whole within 20 s (Main’s frame subscription)',
    );
  // Next's pictures, loaded ahead in this page as before.
  const nextReady = await until(async () => {
    for (const id of ids.next)
      if ((await page.locator(`[data-preload="${id}"][data-state="ready"]`).count()) !== 1) return false;
    return true;
  }, BUDGET_MS);
  await letTimePass(
    page,
    500,
    'frames after the live picture first shows whole: none may show part of it, or lose it',
  );
  const probe = await page.evaluate(() => (globalThis as ProbeGlobals).drashtiCurrentFirstProbe ?? null);
  if (!probe) problems.push('no probe in the page (its init script did not run)');
  else if (probe.spot !== doc.spot)
    problems.push(`the page's mark is spot ${String(probe.spot)}, not ${String(doc.spot)}`);
  const all = await frames(doc.since);
  await diagnoseBad(all);
  if (!diagnostic.done && problems.length > 0) {
    diagnostic.done = true;
    await sayStartupFailure(app, page, place + ' ' + doc.what + ' after failed readiness');
  }
  const mine = all.filter((f) => f.spot === doc.spot);
  if (mine.length === 0)
    problems.push(`no frame with this document's mark (${String(all.length)} frames without it)`);
  const seen = mine.map((f) => ({ t: f.t, ...lookAt(f, cells, live, LIVE_BACKGROUND) }));
  return {
    what: doc.what,
    spot: doc.spot,
    since: doc.since,
    readyAt: probe?.readyAt ?? null,
    decodes: doc.logged ? (probe?.decodes ?? []) : null,
    seen,
    others: all.length - mine.length,
    firstWhole: seen.find((f) => f.shown === 'whole')?.t ?? null,
    nextReady,
    problems,
  };
}

/** The decode log's order: the live picture's native decode finished before the first decode asked for Next's. */
function decodeOrder(doc: Doc): { ok: boolean; said: string } {
  const decodes = doc.decodes ?? [];
  const at = (t: number | null) => (t === null ? 'never' : `+${String(Math.round(t - doc.since))}`);
  const said = decodes
    .filter((d) => d.role !== 'other')
    .map((d) => `${d.role} ${d.mediaId.slice(0, 8)} asked ${at(d.start)} ${d.outcome} ${at(d.end)} ms`)
    .join('; ');
  const liveDone = Math.min(
    ...decodes.filter((d) => d.role === 'live' && d.outcome === 'decoded').map((d) => d.end ?? Infinity),
  );
  const nextAsked = Math.min(...decodes.filter((d) => d.role === 'next').map((d) => d.start));
  return {
    ok: Number.isFinite(liveDone) && liveDone <= nextAsked,
    said: said || 'no decode of the live or Next',
  };
}

/** Each document's raw times (ms): asked to ready, asked to the first whole frame, ready to it. */
function times(doc: Doc) {
  const ms = (from: number | null, to: number | null) =>
    from === null || to === null ? null : Math.round(to - from);
  return {
    what: doc.what,
    askedToReady: ms(doc.since, doc.readyAt),
    askedToFirstWhole: ms(doc.since, doc.firstWhole),
    readyToFirstWhole: ms(doc.readyAt, doc.firstWhole),
    frames: doc.seen.length,
    framesWithoutItsMark: doc.others,
  };
}

/** The frames of a document, said briefly: ms from `since`, and what each shows of the live picture. */
const framesSaid = (doc: Doc) =>
  doc.seen
    .slice(0, 40)
    .map((f) => `${String(f.t - doc.since)}ms:${f.shown}${f.bare ? '+bare' : ''}`)
    .join(' ');

for (const place of ['hall', 'stream'] as const) {
  test(`${place}: turned on or reloaded mid-show, the live slide's picture is decoded before Next's and shows whole within the 3 s (X19 L8)`, async () => {
    test.setTimeout(420_000);
    const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const dir = mkdtempSync(join(tmpdir(), 'drashti-current-first-'));
      const files = [
        noisePicture(join(dir, 'Placeholder current first live.png'), LIVE.size, LIVE.grey, 0x2468ace1),
        ...NEXT_GREYS.map((g, n) =>
          noisePicture(
            join(dir, `Placeholder current first next ${String(n + 1)}.png`),
            NEXT_SIZE,
            g,
            0x13579bd + n,
          ),
        ),
      ];
      const [live = '', n1 = '', n2 = '', n3 = ''] = await importAndGetIds(win, files);
      expect(
        [live, n1, n2, n3].filter((mediaId) => mediaId === ''),
        'the four pictures imported',
      ).toEqual([]);
      const ids: Ids = { live, next: [n1, n2, n3] };
      // The live slide: its one picture over its own colour. Next: three pictures, its left half, right top and bottom.
      const id = await makeSlides(
        win,
        'Placeholder current first',
        [
          { picture: live, background: hex(LIVE_BACKGROUND) },
          {
            picture: n1,
            background: hex(NEXT_BACKGROUND),
            elements: [
              {
                id: 'placeholder-next-right-top',
                kind: 'image',
                mediaId: n2,
                frame: { x: 960, y: 0, width: 960, height: 540 },
                fit: 'fill',
              },
              {
                id: 'placeholder-next-right-bottom',
                kind: 'image',
                mediaId: n3,
                frame: { x: 960, y: 540, width: 960, height: 540 },
                fit: 'fill',
              },
            ],
          },
        ],
        { kind: 'cut', durationMs: 0 },
      );
      // Mid-show: the live slide up, Next its following one, before the screen is there.
      await goLive(win, id, 0);
      await recordFrames(app);
      const frames = frameReader(app, place);
      const context = app.context();
      let markScript = await context.addInitScript(pageProbe, 0);
      const logScript = await context.addInitScript(decodeLog, ids);
      const docs: Doc[] = [];

      // (a) The screen turned on mid-show: a new window and page.
      let since = Date.now();
      let page: Page;
      if (place === 'hall') {
        await setUpScreen(win);
        page = await outputPage(app);
      } else {
        await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('slides'));
        await win.getByTestId('open-stream').click();
        page = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
      }
      docs.push(
        await observe(app, page, place, frames, ids, { what: 'turned on', spot: 0, since, logged: true }),
      );
      // Main's capture of the new window was on before its page was ready, so before it could draw the live slide.
      const subscribedAt = await app.evaluate(
        (_electron, place) => (globalThis as GrabGlobals).drashtiCurrentFirstSubscribed?.[place] ?? null,
        place,
      );
      const openedReady = docs[0]?.readyAt ?? null;
      expect
        .soft(
          subscribedAt !== null && openedReady !== null && subscribedAt <= openedReady,
          `${place}, turned on: Main's frame subscription began (${String(subscribedAt)}) before the page was ready (${String(openedReady)})`,
        )
        .toBe(true);

      // (b) Reloaded mid-show, with the decode log; then (c) plain reloads, nothing wrapped, for the raw times.
      // Main's capture has had this window's frames since (a), so it is going before each reload is asked.
      for (let spot = 1; spot <= 4; spot++) {
        expect
          .soft(
            (await frames(0)).length,
            `${place}: Main’s capture of the window is going before reload ${String(spot)}`,
          )
          .toBeGreaterThan(0);
        await markScript.dispose();
        markScript = await context.addInitScript(pageProbe, spot);
        if (spot === 2) await logScript.dispose();
        since = Date.now();
        await page.reload();
        docs.push(
          await observe(app, page, place, frames, ids, {
            what: spot === 1 ? 'reloaded (decode log)' : `plain reload ${String(spot - 1)}`,
            spot,
            since,
            logged: spot === 1,
          }),
        );
      }

      // (d) Next, loaded ahead in this page, cuts in at once: no frame waits for its pictures, none shows part of it.
      const root = rootOf(place);
      await page.evaluate((root) => {
        const g = globalThis as typeof globalThis & { drashtiCurrentFirstWaits?: number };
        g.drashtiCurrentFirstWaits = 0;
        const tick = () => {
          if (
            document.querySelector(
              `[data-testid="${root}"] [data-layer="slide"][data-fading="true"]:not([data-fade-start])`,
            )
          )
            g.drashtiCurrentFirstWaits = (g.drashtiCurrentFirstWaits ?? 0) + 1;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, root);
      const last = docs.at(-1);
      const pressed = Date.now();
      await goLive(win, id, 1);
      const boxes: (Box | null)[] = [null, null, null];
      const nextShown = await until(async () => {
        for (const [n, mediaId] of ids.next.entries()) boxes[n] = await shownBox(page, place, mediaId);
        return boxes.every((b) => b !== null);
      }, BUDGET_MS);
      const [b1, b2, b3] = boxes;
      const regions =
        b1 && b2 && b3
          ? [
              { cells: cellsIn(b1, [b2, b3]), rgb: grey(NEXT_GREYS[0]) },
              { cells: cellsIn(b2), rgb: grey(NEXT_GREYS[1]) },
              { cells: cellsIn(b3), rgb: grey(NEXT_GREYS[2]) },
            ]
          : [];
      const nextWhole = (f: Grab) =>
        regions.length > 0 &&
        regions.every((r) => lookAt(f, r.cells, r.rgb, NEXT_BACKGROUND).shown === 'whole');
      const liveCells = cellsIn(b1 ?? { x: 0, y: 0, w: 0, h: 0 });
      const liveWhole = (f: Grab) => lookAt(f, liveCells, grey(LIVE.grey), LIVE_BACKGROUND).shown === 'whole';
      const nextCaptured =
        nextShown &&
        (await until(
          async () => (await frames(pressed)).some((f) => f.spot === last?.spot && nextWhole(f)),
          BUDGET_MS,
        ));
      await letTimePass(page, 300, 'frames after Next first shows whole: none may show part of it');
      const waits = await page.evaluate(
        () =>
          (globalThis as typeof globalThis & { drashtiCurrentFirstWaits?: number })
            .drashtiCurrentFirstWaits ?? -1,
      );
      const afterPress = (await frames(pressed)).filter((f) => f.spot === last?.spot);
      const cut = afterPress.map((f) => ({
        t: f.t,
        shows: nextWhole(f) ? 'next' : liveWhole(f) ? 'live' : 'other',
      }));
      const cutSaid = cut
        .slice(0, 30)
        .map((f) => `${String(f.t - pressed)}ms:${f.shows}`)
        .join(' ');
      const firstNext = cut.find((f) => f.shows === 'next')?.t ?? null;

      // What was seen, said whole before the verdicts (the raw samples are the evidence either way).
      const rows = docs.map(times);
      const nextRow = { pressedToFirstNextWhole: firstNext === null ? null : firstNext - pressed, waits };
      console.log(`CURRENT FIRST ${place} times: ${JSON.stringify(rows)} next: ${JSON.stringify(nextRow)}`);
      for (const doc of docs) {
        if (doc.decodes) console.log(`CURRENT FIRST ${place} ${doc.what} decodes: ${decodeOrder(doc).said}`);
        console.log(`CURRENT FIRST ${place} ${doc.what} frames: ${framesSaid(doc)}`);
      }
      console.log(`CURRENT FIRST ${place} next: ${cutSaid}`);
      test
        .info()
        .annotations.push({ type: `current first ${place}`, description: JSON.stringify({ rows, nextRow }) });

      for (const doc of docs) {
        const about = `${place}, ${doc.what}`;
        expect.soft(doc.problems, `${about}: what the test could not read`).toEqual([]);
        if (doc.decodes) {
          const order = decodeOrder(doc);
          expect
            .soft(
              order.ok,
              `${about}: the live slide's picture finished its native decode before a decode was asked for any of Next's (${order.said})`,
            )
            .toBe(true);
        }
        const first = doc.seen.findIndex((f) => f.shown === 'whole');
        const said = framesSaid(doc);
        expect
          .soft(
            doc.seen.filter((f) => f.shown === 'part' || f.bare).map((f) => f.t - doc.since),
            `${about}: frames showing part of the live picture, or the slide without it (${said})`,
          )
          .toEqual([]);
        expect
          .soft(
            first === -1
              ? []
              : doc.seen
                  .slice(first)
                  .filter((f) => f.shown !== 'whole')
                  .map((f) => f.t - doc.since),
            `${about}: frames losing the live picture after it first showed whole (${said})`,
          )
          .toEqual([]);
        // Existence only: a live picture already decoded can rightly be whole in this document's very first frame
        // (x19b, 10:08); the capture was on before it could be drawn (below, and before each reload).
        expect
          .soft(first, `${about}: a frame of this document with the live picture whole (${said})`)
          .toBeGreaterThanOrEqual(0);
        expect
          .soft(
            doc.readyAt === null || doc.firstWhole === null ? Infinity : doc.firstWhole - doc.readyAt,
            `${about}: the live picture shown whole at most ${String(SHOWN_BY_MS)} ms after the page was ready (${JSON.stringify(times(doc))})`,
          )
          .toBeLessThanOrEqual(SHOWN_BY_MS);
        expect.soft(doc.nextReady, `${about}: Next's pictures loaded ahead in the page`).toBe(true);
      }
      expect.soft(nextShown && nextCaptured, `${place}: Next pressed shows whole (${cutSaid})`).toBe(true);
      expect.soft(waits, `${place}: frames where the cut to Next waited for its pictures`).toBe(0);
      expect
        .soft(
          cut.filter((f) => f.shows === 'other').map((f) => f.t - pressed),
          `${place}: frames after Next was pressed showing neither the live picture nor Next whole (${cutSaid})`,
        )
        .toEqual([]);
    } finally {
      await app.close();
    }
  });
}
