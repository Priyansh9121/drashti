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
 * X19 L8: exercise the real output with Next's preload decode held forever, with a rejected current decode, and
 * with the first scene's own native decode held across reveal. These are test-owned decode promises; no product
 * switch, capture pump, screenshot or canvas preparation before the verdict. Main records every native frame.
 * Its per-document mark, picture grid and 3 s bound are the same contract as slide-current-first.spec.ts.
 * There is one fresh app for every case, including an empty screen's first show and a screen opened mid-show.
 */
type Place = 'hall' | 'stream';
type Hazard = 'next-never' | 'current-rejects' | 'own-held';
const LIVE = { grey: 208, size: { width: 6144, height: 3456 } };
const NEXT_SIZE = { width: 4096, height: 2304 };
const LIVE_BACKGROUND = [160, 32, 128] as const;
const PLAIN = [32, 32, 32] as const;
const COLS = 32;
const ROWS = 18;
const NEAR = 20;
const SHOWN_BY_MS = 3000;
const BUDGET_MS = 20_000;
const SPOTS = 1;
const hex = (rgb: readonly number[]) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

interface Decode {
  mediaId: string;
  role: 'live' | 'next' | 'other';
  start: number;
  end: number | null;
  outcome: 'pending' | 'decoded' | 'failed';
}
interface CurrentFirstProbe {
  spot: number;
  readyAt: number | null;
  decodes: Decode[];
}
type ProbeGlobals = typeof globalThis & { drashtiCurrentFirstProbe?: CurrentFirstProbe };
interface Grab {
  t: number;
  spot: number;
  grid: string;
}
type GrabGlobals = typeof globalThis & {
  drashtiCurrentFirstFrames?: Partial<Record<Place, Grab[]>>;
  drashtiCurrentFirstSubscribed?: Partial<Record<Place, number>>;
};

interface BoundCall {
  role: 'live' | 'next' | 'other';
  where: 'own' | 'current-preload' | 'next-preload' | 'elsewhere';
  asked: number;
  nativeDone: number | null;
  returned: number | null;
  outcome: 'pending' | 'held' | 'decoded' | 'rejected';
}
interface BoundProbe {
  calls: BoundCall[];
  releasedAt: number | null;
  release(): void;
}
type BoundGlobals = typeof globalThis & { drashtiStartupBound?: BoundProbe };
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

/** Install before the output document exists; operator/preview decoding is untouched. */
function boundDecodes({ live, next, hazard }: { live: string; next: string; hazard: Hazard }): void {
  if (!/\/(?:output|stream)\.html$/u.test(location.pathname)) return;
  if (new URLSearchParams(location.search).has('identify')) return;
  const resumes: (() => void)[] = [];
  const wall = () => performance.timeOrigin + performance.now();
  const probe: BoundProbe = {
    calls: [],
    releasedAt: null,
    release() {
      probe.releasedAt = wall();
      for (const resume of resumes.splice(0)) resume();
    },
  };
  (globalThis as BoundGlobals).drashtiStartupBound = probe;
  const native = Reflect.get(HTMLImageElement.prototype, 'decode');
  HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
    const mediaId =
      /^drashti-media:\/\/(?:media|display|sharp)\/([^?#/]+)/iu.exec(this.src || this.currentSrc)?.[1] ?? '';
    const role = mediaId === live ? 'live' : mediaId === next ? 'next' : 'other';
    const where = this.closest('[data-slide-in]')
      ? 'own'
      : this.hasAttribute('data-current-preload')
        ? 'current-preload'
        : this.hasAttribute('data-preload')
          ? 'next-preload'
          : 'elsewhere';
    const call: BoundCall = {
      role,
      where,
      asked: wall(),
      nativeDone: null,
      returned: null,
      outcome: 'pending',
    };
    probe.calls.push(call);
    if (role === 'next' && where === 'next-preload') {
      // Its bytes may load, but this decode NEVER settles, including after release() of the live gate.
      call.outcome = 'held';
      return new Promise<void>(() => {
        /* Intentionally pending until this fresh app is closed. */
      });
    }
    if (role === 'live' && hazard === 'current-rejects') {
      call.outcome = 'rejected';
      call.returned = wall();
      return Promise.reject(
        new DOMException('Placeholder current decode rejected by the test', 'EncodingError'),
      );
    }
    const decoding = native.call(this);
    const recorded = decoding.then(
      () => {
        call.nativeDone = wall();
      },
      (error: unknown) => {
        call.outcome = 'rejected';
        call.returned = wall();
        throw error;
      },
    );
    if (role === 'live' && where === 'own' && hazard === 'own-held' && probe.releasedAt === null) {
      // Finish native decoding normally, but withhold its result from the scene across several real frames.
      call.outcome = 'held';
      return recorded.then(
        () =>
          new Promise<void>((resolve) => {
            const finish = () => {
              call.returned = wall();
              call.outcome = 'decoded';
              resolve();
            };
            if (probe.releasedAt !== null) finish();
            else resumes.push(finish);
          }),
      );
    }
    return recorded.then(() => {
      call.returned = wall();
      call.outcome = 'decoded';
    });
  };
}

const rootOf = (place: Place) => (place === 'hall' ? 'output-root' : 'program-root');

/** Only reads layout; it neither decodes nor draws a picture. */
async function incomingBox(page: Page, place: Place, live: string | null): Promise<Box | null> {
  return page.evaluate(
    ({ root, live }) => {
      const layer = document.querySelector(`[data-testid="${root}"] [data-layer="slide"]`);
      const incoming = layer?.querySelector('[data-slide-in]');
      const el = live ? incoming?.querySelector(`img[data-media-id="${live}"]`) : incoming;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.x / innerWidth,
        y: r.y / innerHeight,
        w: r.width / innerWidth,
        h: r.height / innerHeight,
      };
    },
    { root: rootOf(place), live },
  );
}

for (const place of ['hall', 'stream'] as const) {
  for (const opened of ['empty then first show', 'mid-show'] as const) {
    for (const hazard of ['next-never', 'current-rejects', 'own-held'] as const) {
      test(`${place}: ${opened}, ${hazard}, the first reveal stays bounded and whole (X19 L8)`, async () => {
        test.setTimeout(180_000);
        const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
        let page: Page | undefined;
        try {
          const win = await operatorPage(app);
          await operatorReady(win);
          const dir = mkdtempSync(join(tmpdir(), 'drashti-startup-bound-'));
          const [live = '', next = ''] = await importAndGetIds(win, [
            noisePicture(join(dir, 'Placeholder startup live.png'), LIVE.size, LIVE.grey, 0x2468ace1),
            noisePicture(join(dir, 'Placeholder startup next.png'), NEXT_SIZE, 56, 0x13579bd),
          ]);
          expect(
            [live, next].filter((id) => id === ''),
            'both generated pictures imported',
          ).toEqual([]);
          const pictured = hazard !== 'next-never';
          const id = await makeSlides(
            win,
            'Placeholder startup bound',
            [
              pictured ? { picture: live, background: hex(LIVE_BACKGROUND) } : { background: hex(PLAIN) },
              { picture: next, background: '#204060' },
            ],
            { kind: 'cut', durationMs: 0 },
          );
          await app.context().addInitScript(pageProbe, 0);
          await app.context().addInitScript(boundDecodes, { live, next, hazard });
          await recordFrames(app);
          const frames = frameReader(app, place);
          if (opened === 'mid-show') await goLive(win, id, 0);
          let since = Date.now();
          if (place === 'hall') {
            await setUpScreen(win);
            page = await outputPage(app);
          } else {
            await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('slides'));
            await win.getByTestId('open-stream').click();
            page = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
          }
          const output = page;
          await expect(output.getByTestId(rootOf(place))).toHaveAttribute('data-fonts', 'ready', {
            timeout: 60_000,
          });
          const readyAt = await output.evaluate(
            () => (globalThis as ProbeGlobals).drashtiCurrentFirstProbe?.readyAt ?? null,
          );
          expect(readyAt, 'the test observed the actual page readiness').not.toBeNull();
          const subscribed = await app.evaluate(
            (_electron, place) => (globalThis as GrabGlobals).drashtiCurrentFirstSubscribed?.[place] ?? null,
            place,
          );
          expect(
            subscribed !== null && readyAt !== null && subscribed <= readyAt,
            'Main subscribed before this page became ready',
          ).toBe(true);
          if (opened === 'empty then first show') {
            await expect
              .poll(async () => (await frames(0)).some((f) => f.spot === 0), { timeout: BUDGET_MS })
              .toBe(true);
            since = Date.now();
            await goLive(win, id, 0);
          }
          const start = opened === 'mid-show' ? readyAt : since;
          const box = await found(() => incomingBox(output, place, pictured ? live : null), BUDGET_MS);
          expect(box, 'the live scene mounted in the actual output').not.toBeNull();
          const cells = box ? cellsIn(box) : [];
          expect(cells.length, 'the entire picture has native sample cells').toBeGreaterThan(0);
          const expected = pictured ? grey(LIVE.grey) : PLAIN;
          const examine = async () =>
            (await frames(since))
              .filter((f) => f.spot === 0)
              .map((f) => ({ t: f.t, ...lookAt(f, cells, expected, LIVE_BACKGROUND) }));
          if (hazard === 'own-held') {
            await expect
              .poll(
                () =>
                  output.evaluate(
                    () =>
                      (globalThis as BoundGlobals).drashtiStartupBound?.calls.some(
                        (c) =>
                          c.role === 'live' &&
                          c.where === 'own' &&
                          c.outcome === 'held' &&
                          c.nativeDone !== null,
                      ) ?? false,
                  ),
                { timeout: BUDGET_MS },
              )
              .toBe(true);
            // A deterministic adversarial reveal: the current OWN promise remains pending over several actual frames.
            await letTimePass(output, 500, 'the live DOM image decode is held across the initial reveal');
            const held = await examine();
            expect
              .soft(
                held.filter((f) => f.shown !== 'none' || f.bare),
                'no live slide, bare colour or partial picture while its OWN decode is held',
              )
              .toEqual([]);
            console.log(`STARTUP BOUND held ${place} ${opened}: ${JSON.stringify(held)}`);
            await output.evaluate(() => (globalThis as BoundGlobals).drashtiStartupBound?.release());
          }
          await expect
            .poll(async () => (await examine()).some((f) => f.shown === 'whole'), { timeout: BUDGET_MS })
            .toBe(true);
          await letTimePass(output, 300, 'the first revealed picture stays whole');
          // Check the stalled Next after revealing; no wait on this test instrumentation can move the reveal's timestamp.
          await expect
            .poll(
              () =>
                output.evaluate(
                  () =>
                    (globalThis as BoundGlobals).drashtiStartupBound?.calls.some(
                      (c) => c.role === 'next' && c.where === 'next-preload' && c.outcome === 'held',
                    ) ?? false,
                ),
              { timeout: BUDGET_MS },
            )
            .toBe(true);
          const calls = await output.evaluate(
            () => (globalThis as BoundGlobals).drashtiStartupBound?.calls ?? [],
          );
          const seen = await examine();
          const first = seen.find((f) => f.shown === 'whole')?.t ?? null;
          const latency = start === null || first === null ? Infinity : first - start;
          const result = { place, opened, hazard, since, readyAt, start, first, latency, calls, seen };
          console.log(`STARTUP BOUND ${JSON.stringify(result)}`);
          await test.info().attach('startup-bound.json', {
            body: JSON.stringify(result, null, 2),
            contentType: 'application/json',
          });
          expect
            .soft(
              calls
                .filter((c) => c.role === 'next')
                .every((c) => c.returned === null && c.nativeDone === null),
              'Next remains pending; it was never released or decoded by the test',
            )
            .toBe(true);
          if (hazard === 'current-rejects')
            expect
              .soft(
                calls.some((c) => c.role === 'live' && c.where === 'own' && c.outcome === 'rejected'),
                'the actual live scene exercised decode rejection',
              )
              .toBe(true);
          expect
            .soft(latency, 'the first native reveal is within the unchanged 3 s')
            .toBeLessThanOrEqual(SHOWN_BY_MS);
          expect
            .soft(
              seen.filter((f) => f.shown === 'part' || f.bare),
              'no partial picture or bare slide on first reveal',
            )
            .toEqual([]);
          const after = first === null ? [] : seen.filter((f) => f.t >= first);
          expect
            .soft(
              after.filter((f) => f.shown !== 'whole'),
              'the first picture is never lost after revealing',
            )
            .toEqual([]);
          if (test.info().errors.length > 0)
            await sayStartupFailure(app, output, `${place} ${opened} ${hazard}`);
        } catch (error) {
          if (page) await sayStartupFailure(app, page, `${place} ${opened} ${hazard}`);
          throw error;
        } finally {
          await app.close();
        }
      });
    }
  }
}
