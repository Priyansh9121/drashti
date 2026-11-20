import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { displayUrl } from '../../src/shared/media';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
  type PageGlobals,
} from './helpers';
import { goLive, makeSlides } from './placeholder-slides';

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let b = 0; b < 8; b++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(name: string, bytes: Buffer): Buffer {
  const type = Buffer.from(name);
  let crc = 0xffffffff;
  for (const b of Buffer.concat([type, bytes])) crc = (CRC[(crc ^ b) & 255] ?? 0) ^ (crc >>> 8);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  const end = Buffer.alloc(4);
  end.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, type, bytes, end]);
}
/** Generated colour and alpha only, with a distinct hash per trial; no fixture is downsized to pass. */
function picture(
  file: string,
  width = 6144,
  height = 3456,
  seed = 0,
  noise = false,
): { file: string; hash: string } {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let random = seed + 1;
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 4;
      for (let c = 0; c < 3; c++) {
        random = (Math.imul(1664525, random) + 1013904223) >>> 0;
        raw[p + c] = noise ? random >>> 24 : c === 0 ? (192 + seed) % 256 : c === 1 ? 48 : 64;
      }
      raw[p + 3] = noise || x < width / 2 ? 255 : 96;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(file, bytes);
  return { file, hash: createHash('sha256').update(bytes).digest('hex') };
}

test('an oversized imported still is ready with its display source, while the original and alpha remain intact', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-display-pictures-'));
    const large = picture(join(dir, 'Placeholder large alpha.png'));
    const small = picture(join(dir, 'Placeholder small alpha.png'), 640, 360);
    const [id = '', smallId = ''] = await importAndGetIds(win, [large.file, small.file]);
    expect(id).not.toBe('');
    expect(smallId).not.toBe('');
    const looks = await win.evaluate(() => (globalThis as PageGlobals).drashti.media.looks());
    const copy = looks[id]?.display;
    expect(copy).toMatchObject({ width: 1920, height: 1080 });
    if (!copy) throw new Error('The imported picture was announced ready without its display rendition.');
    expect(looks[smallId]?.display).toBeUndefined();
    const source = displayUrl(id, copy.key);
    const drawn = await win.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('No CPU canvas.');
      ctx.drawImage(image, 0, 0);
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        opaque: ctx.getImageData(
          Math.floor(image.naturalWidth / 4),
          Math.floor(image.naturalHeight / 2),
          1,
          1,
        ).data[3],
        alpha: ctx.getImageData(
          Math.floor((image.naturalWidth * 3) / 4),
          Math.floor(image.naturalHeight / 2),
          1,
          1,
        ).data[3],
      };
    }, source);
    expect(drawn).toMatchObject({ width: 1920, height: 1080, opaque: 255 });
    expect(Math.abs((drawn.alpha ?? 0) - 96)).toBeLessThanOrEqual(1);
    const original = join(
      userData,
      'Media',
      /^[a-f0-9]{2}/u.exec(large.hash)?.[0] ?? '',
      `${large.hash}.png`,
    );
    expect(createHash('sha256').update(readFileSync(original)).digest('hex')).toBe(large.hash);
    expect(await importAndGetIds(win, [large.file])).toEqual([id]);
    await setUpScreen(win);
    const out = await outputPage(app);
    await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
    const presentation = await makeSlides(win, 'Placeholder display source', [{ picture: id }], {
      kind: 'cut',
      durationMs: 0,
    });
    await goLive(win, presentation, 0);
    await expect(out.locator(`[data-layer="slide"] img[src^="${source}"]`)).toHaveCount(1);
    const workers = [
      ...readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8').matchAll(
        /Display copy worker priority: (-?\d+) \((darwin|win32)\)/gu,
      ),
    ].map((match) => ({ priority: Number(match[1]), platform: match[2] }));
    expect(workers.length).toBeGreaterThan(0);
    for (const worker of workers) expect(worker.priority).toBeGreaterThan(0);
    console.log('DISPLAY COPY READY ' + JSON.stringify({ copy, drawn, originalUnchanged: true, workers }));
  } finally {
    await app.close();
  }
});

interface DisplayJobMark {
  kind: 'decode-start' | 'decode-end' | 'blob-start' | 'blob-end';
  t: number;
  received: number;
  pid: number;
  priority: number | null;
}
interface DisplayCostMain {
  active: boolean;
  frames: number[];
  jobs: DisplayJobMark[];
  hallPid: number;
  mainPid: number;
}
type DisplayCostMainGlobals = typeof globalThis & { drashtiDisplayCostMain?: DisplayCostMain };
interface DisplayCostPage {
  frames: number[];
  start: number | null;
  end: number | null;
}
type DisplayCostPageGlobals = typeof globalThis & { drashtiDisplayCostPage?: DisplayCostPage };

/** Observation only: return the original native promises, with no gate, delayed work or changed pixels. */
function logDisplayWork(): void {
  if (new URLSearchParams(location.search).get('purpose') !== 'display') return;
  const mark = (kind: DisplayJobMark['kind']) =>
    console.log(
      'DISPLAY_COST_JOB ' + JSON.stringify({ kind, t: performance.timeOrigin + performance.now() }),
    );
  const decode = globalThis.createImageBitmap;
  globalThis.createImageBitmap = ((...args: Parameters<typeof decode>) => {
    mark('decode-start');
    const native = Reflect.apply(decode, globalThis, args) as ReturnType<typeof decode>;
    void native.then(
      () => mark('decode-end'),
      () => undefined,
    );
    return native;
  }) as typeof decode;
  const blob = OffscreenCanvas.prototype.convertToBlob;
  OffscreenCanvas.prototype.convertToBlob = function (this: OffscreenCanvas, options) {
    mark('blob-start');
    const native = blob.call(this, options);
    void native.then(
      () => mark('blob-end'),
      () => undefined,
    );
    return native;
  };
}

/** Attach at dom-ready, before the hall exists (the Windows capture lifecycle verified by L7). */
async function recordDisplayCost(app: ElectronApplication): Promise<void> {
  await app.context().addInitScript(logDisplayWork);
  await app.evaluate(({ app }) => {
    const cost: DisplayCostMain = { active: false, frames: [], jobs: [], hallPid: 0, mainPid: process.pid };
    (globalThis as DisplayCostMainGlobals).drashtiDisplayCostMain = cost;
    app.on('browser-window-created', (_event, win) => {
      win.webContents.on('console-message', (event) => {
        if (!event.message.startsWith('DISPLAY_COST_JOB ')) return;
        const mark = JSON.parse(event.message.slice('DISPLAY_COST_JOB '.length)) as Pick<
          DisplayJobMark,
          'kind' | 't'
        >;
        const pid = win.webContents.getOSProcessId();
        let priority: number | null = null;
        try {
          priority = (process.getBuiltinModule('node:os') as typeof import('node:os')).getPriority(pid);
        } catch {
          // A missing actual OS answer fails the test; a log message alone is not priority evidence.
        }
        cost.jobs.push({ ...mark, received: Date.now(), pid, priority });
      });
      win.webContents.once('dom-ready', () => {
        const url = win.webContents.getURL();
        if (!url.includes('/output.html') || url.includes('identify=')) return;
        cost.hallPid = win.webContents.getOSProcessId();
        win.webContents.beginFrameSubscription(false, () => {
          if (cost.active) cost.frames.push(Date.now());
        });
      });
    });
  });
}

function periods(frames: readonly number[], reference?: number) {
  const gaps = frames.slice(1).map((t, i) => t - (frames[i] ?? t));
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const period = reference ?? median;
  return {
    frames: frames.length,
    period,
    longest: sorted.at(-1) ?? 0,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    over15: gaps.filter((ms) => ms > period * 1.5).length,
    gaps,
  };
}

async function startDisplayCostPage(out: Page): Promise<void> {
  await out.evaluate(() => {
    const g = globalThis as DisplayCostPageGlobals;
    const cost: DisplayCostPage = { frames: [], start: null, end: null };
    g.drashtiDisplayCostPage = cost;
    const sample = () => {
      if (g.drashtiDisplayCostPage !== cost) return;
      const t = performance.timeOrigin + performance.now();
      const fading = document.querySelector(
        '[data-layer="slide"][data-transition="dissolve"][data-fading="true"]',
      );
      if (fading) {
        cost.start ??= t;
        cost.frames.push(t);
      } else if (cost.start !== null) {
        cost.frames.push(t);
        cost.end = t;
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

/** Main callbacks and renderer rAF are separate observations; neither claims a hardware presentation timestamp. */
test('a large picture imported during a hall dissolve does not add sustained frame gaps', async ({}, info) => {
  test.setTimeout(240_000);
  const { app } = await launchApp();
  const trials: {
    pair: number;
    importing: boolean;
    page: DisplayCostPage;
    main: DisplayCostMain;
    imported: { start: number; ready: number; durationMs: number; id: string; hash: string } | null;
  }[] = [];
  const paired: unknown[] = [];
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await recordDisplayCost(app);
    await setUpScreen(win);
    const out = await outputPage(app);
    await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
    const operatorPid = await (await app.browserWindow(win)).evaluate((w) => w.webContents.getOSProcessId());
    const dir = mkdtempSync(join(tmpdir(), 'drashti-display-dissolve-'));
    // All original fixture generation precedes capture. Fresh 21 MP noise PNGs also exercise the byte handoff;
    // a different hash every time prevents a cached display job from masquerading as an overlapping import.
    const sources = Array.from({ length: 3 }, (_, n) =>
      picture(join(dir, `Placeholder cost ${String(n)}.png`), 6144, 3456, 100 + n, true),
    );
    expect(new Set(sources.map((source) => source.hash)).size).toBe(3);
    const slides = await makeSlides(
      win,
      'Placeholder import cost',
      [{ background: '#000000' }, { background: '#ffffff' }],
      {
        kind: 'dissolve',
        durationMs: 5000,
      },
    );
    const layer = out.locator('[data-layer="slide"]');
    const allWorse = { native: [] as boolean[], raf: [] as boolean[] };
    for (let pair = 0; pair < 3; pair++) {
      // Alternate pair order so a first-use pipeline or a warm machine cannot always favour either side.
      for (const importing of pair % 2 === 0 ? [false, true] : [true, false]) {
        await goLive(win, slides, 0);
        const blackSlide = await win.evaluate(
          async () =>
            (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide?.slide.id,
        );
        if (!blackSlide) throw new Error('The control slide did not reach the engine.');
        await expect(out.locator(`[data-layer="slide"] [data-slide="${blackSlide}"]`)).toHaveCount(1);
        await expect(layer).not.toHaveAttribute('data-fading', 'true', { timeout: 15_000 });
        await startDisplayCostPage(out);
        await app.evaluate(() => {
          const cost = (globalThis as DisplayCostMainGlobals).drashtiDisplayCostMain;
          if (!cost) throw new Error('The native frame subscription was not installed.');
          cost.frames = [];
          cost.jobs = [];
          cost.active = true;
        });
        await goLive(win, slides, 1);
        await expect(layer).toHaveAttribute('data-transition', 'dissolve');
        const source = sources[pair];
        if (!source) throw new Error('The fresh import fixture is missing.');
        const importReady = importing
          ? (async () => {
              const start = Date.now();
              const [id = ''] = await importAndGetIds(win, [source.file]);
              const ready = Date.now();
              expect(id).not.toBe('');
              const looks = await win.evaluate(() => (globalThis as PageGlobals).drashti.media.looks());
              expect(looks[id]?.display?.width).toBeGreaterThan(0);
              expect(looks[id]?.display?.width).toBeLessThan(6144);
              return { start, ready, durationMs: ready - start, id, hash: source.hash };
            })()
          : Promise.resolve(null);
        const [imported] = await Promise.all([
          importReady,
          out.waitForFunction(
            () => (globalThis as DisplayCostPageGlobals).drashtiDisplayCostPage?.end !== null,
            undefined,
            { timeout: 15_000 },
          ),
        ]);
        const page = await out.evaluate(() => (globalThis as DisplayCostPageGlobals).drashtiDisplayCostPage);
        const main = await app.evaluate(() => {
          const cost = (globalThis as DisplayCostMainGlobals).drashtiDisplayCostMain;
          if (cost) cost.active = false;
          return cost;
        });
        if (!page || page.start === null || page.end === null || !main)
          throw new Error('The actual dissolve interval was not recorded.');
        main.frames = main.frames.filter((t) => t >= (page.start ?? 0) && t <= (page.end ?? 0));
        const trial = { pair, importing, page, main, imported };
        trials.push(trial);
        console.log('DISPLAY DISSOLVE TRIAL ' + JSON.stringify(trial));
        expect(page.frames.length).toBeGreaterThan(2);
        expect(main.frames.length).toBeGreaterThan(2);
        if (imported) {
          const begin = main.jobs.find((job) => job.kind === 'decode-start');
          const end = main.jobs.find((job) => job.kind === 'blob-end');
          expect(begin, 'The actual native display decode began during the dissolve.').toBeDefined();
          expect(end, 'The native display job completed; import readiness was real.').toBeDefined();
          expect(begin?.t ?? Infinity).toBeLessThan(page.end);
          expect(end?.t ?? -Infinity).toBeGreaterThan(page.start);
          expect(main.jobs.filter((job) => job.kind === 'decode-start')).toHaveLength(1);
          for (const job of main.jobs) {
            expect(job.pid).toBeGreaterThan(0);
            expect([main.mainPid, main.hallPid, operatorPid]).not.toContain(job.pid);
            expect(job.priority, 'The actual running worker was below normal priority.').toBeGreaterThan(0);
          }
        } else expect(main.jobs).toHaveLength(0);
      }
      const control = trials.find((trial) => trial.pair === pair && !trial.importing);
      const importing = trials.find((trial) => trial.pair === pair && trial.importing);
      if (!control || !importing) throw new Error('A paired round was not completed.');
      const nativeControl = periods(control.main.frames);
      const nativeImport = periods(importing.main.frames, nativeControl.period);
      const rafControl = periods(control.page.frames);
      const rafImport = periods(importing.page.frames, rafControl.period);
      expect(nativeControl.period).toBeGreaterThan(0);
      expect(rafControl.period).toBeGreaterThan(0);
      allWorse.native.push(nativeImport.over15 > nativeControl.over15);
      allWorse.raf.push(rafImport.over15 > rafControl.over15);
      const verdict = {
        pair,
        nativeControl,
        nativeImport,
        rafControl,
        rafImport,
        importReadyMs: importing.imported?.durationMs,
      };
      paired.push(verdict);
      console.log('DISPLAY DISSOLVE PAIR ' + JSON.stringify(verdict));
    }
    // Q59-1: each observation fails for a cost in every one of its three ordered paired rounds.
    expect(allWorse.native.every(Boolean), 'Import added native callback gaps in all three pairs.').toBe(
      false,
    );
    expect(allWorse.raf.every(Boolean), 'Import added renderer frame gaps in all three pairs.').toBe(false);
  } finally {
    const unfinished = await app
      .evaluate(() => (globalThis as DisplayCostMainGlobals).drashtiDisplayCostMain)
      .catch(() => null);
    await info.attach('display-dissolve-all-trials', {
      body: Buffer.from(JSON.stringify({ platform: process.platform, trials, paired, unfinished })),
      contentType: 'application/json',
    });
    await app.close();
  }
});
