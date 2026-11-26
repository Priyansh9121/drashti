import {
  droppedFrames,
  importProcessOrder,
  macDropVerdict,
  nativeCostPair,
  periods,
} from './display-cost-meter';
import { beginNativeFeedback, type NativeFeedback } from './display-presentation-feedback';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { displayUrl, mediaUrl } from '../../src/shared/media';
import { logText } from './log-lines';
import { launchMain, launchNode, pairNode } from './nodes';
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
import { readPictureRole } from './picture-role-read';

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
    const encoded = await readPictureRole(app, source);
    // Main reads the same registered role URL. The operator's deliberate connect-src rule stays in force.
    const pixels = await win.evaluate(async (encoded) => {
      const bytes = Uint8Array.from(atob(encoded), (byte) => byte.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes]));
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('No CPU canvas.');
      try {
        ctx.drawImage(image, 0, 0);
        return {
          width: image.width,
          height: image.height,
          opaque: ctx.getImageData(Math.floor(image.width / 4), Math.floor(image.height / 2), 1, 1).data[3],
          alpha: ctx.getImageData(Math.floor((image.width * 3) / 4), Math.floor(image.height / 2), 1, 1)
            .data[3],
        };
      } finally {
        image.close();
      }
    }, encoded.toString('base64'));
    const drawn = { ...pixels, hash: createHash('sha256').update(encoded).digest('hex') };
    expect(drawn).toMatchObject({ width: 1920, height: 1080, opaque: 255 });
    expect(Math.abs((drawn.alpha ?? 0) - 96)).toBeLessThanOrEqual(1);
    const original = join(
      userData,
      'Media',
      /^[a-f0-9]{2}/u.exec(large.hash)?.[0] ?? '',
      `${large.hash}.png`,
    );
    expect(createHash('sha256').update(readFileSync(original)).digest('hex')).toBe(large.hash);
    const originalRoleHash = createHash('sha256')
      .update(await readPictureRole(app, mediaUrl(id)))
      .digest('hex');
    expect(originalRoleHash).toBe(large.hash);
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
      ...logText(userData).matchAll(/Display copy worker priority: (-?\d+) \((darwin|win32)\)/gu),
    ].map((match) => ({ priority: Number(match[1]), platform: match[2] }));
    expect(workers.length).toBeGreaterThan(0);
    for (const worker of workers) expect(worker.priority).toBeGreaterThan(0);
    console.log('DISPLAY COPY READY ' + JSON.stringify({ copy, drawn, originalUnchanged: true, workers }));
  } finally {
    await app.close();
  }
});

interface DisplayJobMark {
  kind: 'source-start' | 'decode-start' | 'decode-end' | 'blob-start' | 'blob-end';
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
interface ImportProcessSeen {
  pid: number;
  creationTime: number;
  sampledAt: number;
}
/** QA23-L8-4 A: Main's watch of the import's worker processes, run only from a dissolve's end to the import's ready. */
interface ImportWatch {
  start(): void;
  stop(): ImportProcessSeen[];
}
type ImportWatchGlobals = typeof globalThis & { drashtiImportWatch?: ImportWatch };
interface DisplayCostPage {
  frames: number[];
  start: number | null;
  end: number | null;
}
type DisplayCostPageGlobals = typeof globalThis & { drashtiDisplayCostPage?: DisplayCostPage };

/** Observation only: return the original native promises, with no gate, delayed work or changed pixels. */
function logDisplayWork(): void {
  if (new URLSearchParams(location.search).get('purpose') !== 'display') return;
  const observed = globalThis as typeof globalThis & { drashtiDisplayWorkObserved?: boolean };
  if (observed.drashtiDisplayWorkObserved) return;
  observed.drashtiDisplayWorkObserved = true;
  const mark = (kind: DisplayJobMark['kind']) => {
    performance.mark('x19-native-display-job-' + kind);
    console.log(
      'DISPLAY_COST_JOB ' + JSON.stringify({ kind, t: performance.timeOrigin + performance.now() }),
    );
  };
  const fetchSource = globalThis.fetch;
  globalThis.fetch = (...args: Parameters<typeof fetchSource>) => {
    mark('source-start');
    return Reflect.apply(fetchSource, globalThis, args);
  };
  const decode = globalThis.createImageBitmap;
  globalThis.createImageBitmap = ((...args: Parameters<typeof decode>) => {
    mark('decode-start');
    const native = Reflect.apply(decode, globalThis, args);
    void native.then(
      () => mark('decode-end'),
      () => undefined,
    );
    return native;
  }) as typeof decode;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the original canvas as this below
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
  await app.evaluate(({ app, BrowserWindow }) => {
    const cost: DisplayCostMain = { active: false, frames: [], jobs: [], hallPid: 0, mainPid: process.pid };
    (globalThis as DisplayCostMainGlobals).drashtiDisplayCostMain = cost;
    const watchJobs = (win: ReturnType<typeof BrowserWindow.getAllWindows>[number]) => {
      win.webContents.on('console-message', (event) => {
        if (!event.message.startsWith('DISPLAY_COST_JOB ')) return;
        const mark = JSON.parse(event.message.slice('DISPLAY_COST_JOB '.length)) as Pick<
          DisplayJobMark,
          'kind' | 't'
        >;
        const pid = win.webContents.getOSProcessId();
        let priority: number | null = null;
        try {
          priority = process.getBuiltinModule('node:os').getPriority(pid);
        } catch {
          // Missing actual priority still fails the test.
        }
        cost.jobs.push({ ...mark, received: Date.now(), pid, priority });
      });
    };
    // QA23-L8-4 A: the import's worker processes ("Drashti import"), each with the time it was made and the moment it
    // was listed. Sampled every 20 ms only from a dissolve's end until its import is ready, never while the hall's
    // frames are measured.
    const seen = new Map<string, ImportProcessSeen>();
    let timer: ReturnType<typeof setInterval> | null = null;
    const sample = () => {
      const sampledAt = Date.now();
      for (const m of app.getAppMetrics()) {
        if (m.type !== 'Utility' || m.name !== 'Drashti import') continue;
        const key = `${String(m.pid)}@${String(m.creationTime)}`;
        if (!seen.has(key)) seen.set(key, { pid: m.pid, creationTime: m.creationTime, sampledAt });
      }
    };
    (globalThis as ImportWatchGlobals).drashtiImportWatch = {
      start: () => {
        seen.clear();
        sample();
        timer ??= setInterval(sample, 20);
      },
      stop: () => {
        if (timer) clearInterval(timer);
        timer = null;
        sample();
        return [...seen.values()];
      },
    };
    for (const win of BrowserWindow.getAllWindows()) watchJobs(win);
    app.on('browser-window-created', (_event, win) => {
      watchJobs(win);
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
  // A quiet startup may already have made the idle worker. Observe it too, exactly once, before the trials.
  for (const page of app.windows()) {
    if (new URLSearchParams(new URL(page.url()).search).get('purpose') === 'display')
      await page.evaluate(logDisplayWork);
  }
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

/**
 * On both systems the import's fixed order decides (QA23-L8-4 A on the Mac, QA23-L8-5 on Windows); the hall's presented
 * frames and the renderer's frames are recorded and attached, deciding nothing.
 */
test('a large picture imported during a hall dissolve keeps its order: no import worker and no display copy work until the dissolve ends, its frames recorded (Q60-59)', async () => {
  const info = test.info();
  const subscribe = true;
  const lane = 0;
  test.setTimeout(240_000);
  const { app } = await launchApp();
  const trials: {
    pair: number;
    importing: boolean;
    page: DisplayCostPage;
    main: DisplayCostMain;
    imported: { start: number; ready: number; durationMs: number; id: string; hash: string } | null;
    importProcesses: ImportProcessSeen[];
    nativeTimesUs: number[];
  }[] = [];
  const paired: unknown[] = [];
  let endFeedback: Awaited<ReturnType<typeof beginNativeFeedback>> | undefined;
  let feedback: NativeFeedback | undefined;
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await recordDisplayCost(app);
    await setUpScreen(win);
    const out = await outputPage(app);
    await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', {
      timeout: 20_000,
    });
    const operatorPid = await app.evaluate(
      ({ BrowserWindow }, url) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL() === url)
          ?.webContents.getOSProcessId() ?? 0,
      win.url(),
    );
    expect(operatorPid).toBeGreaterThan(0);
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
    endFeedback = await beginNativeFeedback(app, out, 'native-observer');
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
        const ended = out.waitForFunction(
          () => (globalThis as DisplayCostPageGlobals).drashtiDisplayCostPage?.end !== null,
          undefined,
          { timeout: 15_000 },
        );
        // QA23-L8-4 A: Main watches the import's worker processes from the dissolve's end until the import is ready.
        const watching = importing
          ? ended.then(() =>
              app.evaluate(() => {
                const watch = (globalThis as ImportWatchGlobals).drashtiImportWatch;
                if (!watch) throw new Error('The import process watch was not installed.');
                watch.start();
              }),
            )
          : Promise.resolve();
        const [imported] = await Promise.all([importReady, ended, watching]);
        const importProcesses = importing
          ? await app.evaluate(() => {
              const watch = (globalThis as ImportWatchGlobals).drashtiImportWatch;
              if (!watch) throw new Error('The import process watch was not installed.');
              return watch.stop();
            })
          : [];
        const page = await out.evaluate(() => (globalThis as DisplayCostPageGlobals).drashtiDisplayCostPage);
        const main = await app.evaluate(() => {
          const cost = (globalThis as DisplayCostMainGlobals).drashtiDisplayCostMain;
          if (cost) cost.active = false;
          return cost;
        });
        if (page?.start == null || page.end === null || !main)
          throw new Error('The actual dissolve interval was not recorded.');
        main.frames = main.frames.filter((t) => t >= (page.start ?? 0) && t <= (page.end ?? 0));
        const trial = {
          pair,
          importing,
          page,
          main,
          imported,
          importProcesses,
          nativeTimesUs: [] as number[],
        };
        trials.push(trial);
        expect(page.frames.length).toBeGreaterThan(2);
        expect(main.frames.length).toBeGreaterThan(2);
        if (imported) {
          const begin = main.jobs.find((job) => job.kind === 'decode-start');
          const end = main.jobs.find((job) => job.kind === 'blob-end');
          // Q60-59 A (alpha.21): a new picture's copy is never made during a transition on the screens: its decode
          // begins only once the dissolve is over, and the import is ready soon after.
          expect(begin, 'The actual native display decode ran, after the dissolve.').toBeDefined();
          expect(end, 'The native display job completed; import readiness was real.').toBeDefined();
          expect(
            begin?.t ?? -Infinity,
            'The display decode waited for the dissolve to end.',
          ).toBeGreaterThanOrEqual(page.end);
          expect(imported.durationMs, 'Ready soon after the dissolve: its 5 s and the copy.').toBeLessThan(
            15_000,
          );
          expect(main.jobs.filter((job) => job.kind === 'decode-start')).toHaveLength(1);
          // QA23-L8-4 A (the owner, 24 Nov 2026: "A: check the import order"): the import's worker process is made only
          // once the dissolve has ended (L8 before its worker waited, 5e86c44f, made it 171-330 ms after the import
          // call, during the dissolve: its one cost on record), and the test saw it before the import was ready.
          const order = importProcessOrder({ end: page.end, ready: imported.ready }, importProcesses);
          expect(
            order.startedDuring,
            'The import’s worker process started only after the dissolve ended.',
          ).toBe(false);
          expect(
            order.inOrder,
            'The import’s worker was seen, made after the dissolve and before ready.',
          ).toBe(true);
          for (const job of main.jobs) {
            expect(job.pid).toBeGreaterThan(0);
            expect([main.mainPid, main.hallPid, operatorPid]).not.toContain(job.pid);
            expect(job.priority, 'The actual running worker was below normal priority.').toBeGreaterThan(0);
          }
        } else expect(main.jobs).toHaveLength(0);
      }
    }
    const stop = endFeedback;
    endFeedback = undefined;
    const nativeFeedback = await stop();
    feedback = nativeFeedback;
    for (const trial of trials) {
      const start = trial.page.start;
      const end = trial.page.end;
      if (start === null || end === null) throw new Error('Missing original phase bounds.');
      trial.nativeTimesUs = nativeFeedback.nativeTimesUs.filter((t) => {
        const at = t / 1000 + nativeFeedback.anchorOffsetMs;
        return at >= start && at <= end;
      });
      expect(trial.nativeTimesUs.length).toBeGreaterThan(2);
      const missing = nativeFeedback.reporters.filter((r) => {
        const at = r.nativeUs / 1000 + nativeFeedback.anchorOffsetMs;
        return r.missingContent && at >= start && at <= end;
      });
      expect(missing, 'Native presentation must not contain missing content.').toHaveLength(0);
      const jobs = nativeFeedback.jobs.filter((job) => job.wallAt >= start && job.wallAt <= end);
      // No display copy work at all during the dissolve, importing or not (Q60-59 A).
      expect(jobs, 'No display copy work during the dissolve.').toHaveLength(0);
      console.log(
        'DISPLAY DISSOLVE TRIAL ' + JSON.stringify({ subscribe, lane, ...trial, nativeJobs: jobs }),
      );
    }
    for (let pair = 0; pair < 3; pair++) {
      const control = trials.find((trial) => trial.pair === pair && !trial.importing);
      const importing = trials.find((trial) => trial.pair === pair && trial.importing);
      if (!control || !importing) throw new Error('An original paired round is missing.');
      const nativePair = nativeCostPair(control, importing);
      const nativeControl = nativePair.control;
      const nativeImport = nativePair.imported;
      const rafControl = periods(control.page.frames);
      const rafImport = periods(importing.page.frames, rafControl.period);
      expect(nativeControl.period).toBeGreaterThan(0);
      expect(rafControl.period).toBeGreaterThan(0);
      // EXACT original rule. Native integers use microseconds: +1ms is +1000us, with no clock rounding.
      const worse = (measured: ReturnType<typeof periods>, control: ReturnType<typeof periods>, oneMs = 1) =>
        measured.p95 - control.p95 > oneMs ||
        measured.longest - control.longest > oneMs ||
        measured.over15 > control.over15;
      // QA21-L8-1's pairs, the hall's presented frames (native presentation) and the renderer's frames (rAF), are
      // recorded and reported on both systems, deciding nothing (QA23-L8-4 A, QA23-L8-5). Main's capture-callback times
      // stay in the evidence too: with no import at all they called a control worse than itself in 10 of 15 pairs on
      // CI's Windows (a21-l8a's A/A).
      allWorse.native.push(nativePair.presentationWorse);
      allWorse.raf.push(worse(rafImport, rafControl));
      const verdict = {
        subscribe,
        lane,
        pair,
        nativeControl,
        nativeImport,
        rafControl,
        rafImport,
        callbackWorse: nativePair.callbackWorse,
        presentationWorse: nativePair.presentationWorse,
        eitherWorse: nativePair.worse,
        presentationControlUs: nativePair.presentationControlUs,
        presentationImportUs: nativePair.presentationImportUs,
        importReadyMs: importing.imported?.durationMs,
      };
      paired.push(verdict);
      console.log('DISPLAY DISSOLVE PAIR ' + JSON.stringify(verdict));
    }
    // The hall's dropped presented frames, import trials against control trials: recorded and reported on both systems,
    // deciding nothing (QA23-L8-4 A, below).
    const drops = macDropVerdict(
      trials.map((trial) => ({
        importing: trial.importing,
        dropped: droppedFrames(
          trial.nativeTimesUs.map((t) => t / 1000 + nativeFeedback.anchorOffsetMs),
          trial.page.start ?? 0,
        ),
      })),
    );
    paired.push({ drops, nativeAllWorse: allWorse.native, rafAllWorse: allWorse.raf });
    console.log('DISPLAY DISSOLVE DROPS ' + JSON.stringify(drops));
    // The verdict on both systems is the import's fixed order, checked in each import trial above: no display copy work
    // and no import worker process during the dissolve. The owner's choices of 24 Nov 2026: QA23-L8-4 A for the Mac
    // ("A: check the import order") and QA23-L8-5 for Windows ("Import order on both"). The frame meters failed builds
    // with no import cost: on CI's Mac the rule's pairs failed a build that changed nothing measurable 4 times in 5
    // (a22-l8-1123-232027-49482) and QA22-L8-3 B's drops margin about 1 attempt in 10 (a22-l8-1124-091901-78648, whose
    // import worker started 275-304 ms after each dissolve); on CI's Windows the rule's pairs about 1 attempt in 10
    // (a22-l8-1124-105442-15305: by the longest presented frame alone, 1.8-2.3 ms). The drops and the rule's pairs stay
    // in the evidence, deciding nothing.
  } finally {
    const unfinished = await app
      .evaluate(() => (globalThis as DisplayCostMainGlobals).drashtiDisplayCostMain)
      .catch(() => null);
    try {
      const native = {
        frameClocks: ['original-main-capture-callback', 'native-presentation-feedback'],
        platform: process.platform,
        subscribe,
        lane,
        trials,
        paired,
        unfinished,
        feedback,
      };
      await info.attach('display-dissolve-all-trials', {
        body: Buffer.from(JSON.stringify(native)),
        contentType: 'application/json',
      });
      if (endFeedback) {
        try {
          await endFeedback();
        } catch (error) {
          await info.attach('native-observer-cleanup-error', {
            body: Buffer.from(error instanceof Error ? error.message : 'Native observer cleanup failed.'),
            contentType: 'text/plain',
          });
        }
      }
    } finally {
      await app.close();
    }
  }
});

test('a node receives and decodes the ready display file with its own hash', async () => {
  test.setTimeout(120_000);
  const main = await launchMain();
  const node = await launchNode();
  try {
    const nodeId = await pairNode(main, node);
    await setUpScreen(main.win, 'Placeholder display copies', 1);
    const group = await main.win.evaluate(
      async () =>
        (await (globalThis as PageGlobals).drashti.screens.get()).groups.find(
          (g) => g.name === 'Placeholder display copies',
        )?.id,
    );
    if (!group) throw new Error('The placeholder screen group is missing.');
    await expect
      .poll(async () =>
        main.win.evaluate(
          async (id) =>
            (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((n) => n.id === id)?.displays
              .length ?? 0,
          nodeId,
        ),
      )
      .toBeGreaterThanOrEqual(2);
    const assigned = await main.win.evaluate(
      async ({ group, nodeId }) => {
        const d = (globalThis as PageGlobals).drashti;
        const onNode = (await d.screens.get()).nodes.find((n) => n.id === nodeId);
        return d.screens.assignNodeDisplay(group, nodeId, onNode?.displays[1]?.id ?? -1);
      },
      { group, nodeId },
    );
    expect(assigned.ok).toBe(true);
    const out = await outputPage(node.app);
    await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
    const dir = mkdtempSync(join(tmpdir(), 'drashti-display-node-'));
    const original = picture(join(dir, 'Placeholder node alpha.png'));
    const [id = ''] = await importAndGetIds(main.win, [original.file]);
    expect(id).not.toBe('');
    const look = await main.win.evaluate(
      async (mediaId) => (await (globalThis as PageGlobals).drashti.media.looks())[mediaId],
      id,
    );
    const copy = look?.display;
    if (!copy) throw new Error('The new picture was ready without its display file.');
    const files = readdirSync(join(main.userData, 'Media', 'display')).filter((name) =>
      name.startsWith(`v1-${original.hash}-${String(copy.width)}x${String(copy.height)}.`),
    );
    expect(files).toHaveLength(1);
    const bytes = readFileSync(join(main.userData, 'Media', 'display', files[0] ?? ''));
    const displayHash = createHash('sha256').update(bytes).digest('hex');
    expect(displayHash).not.toBe(original.hash);
    const presentation = await makeSlides(main.win, 'Placeholder node source', [{ picture: id }], {
      kind: 'cut',
      durationMs: 0,
    });
    await goLive(main.win, presentation, 0);
    const image = out.locator(`[data-layer="slide"] img[data-media-id="${id}"]`);
    await expect
      .poll(async () => (await image.getAttribute('src'))?.startsWith(displayUrl(id, copy.key)) ?? false)
      .toBe(true);
    await expect
      .poll(() =>
        image.evaluate((element) => {
          const img = element as HTMLImageElement;
          return img.complete && img.naturalWidth > 0
            ? { width: img.naturalWidth, height: img.naturalHeight }
            : null;
        }),
      )
      .toEqual({ width: copy.width, height: copy.height });
    const received = join(node.userData, 'Media cache', `${displayHash}.png`);
    await expect.poll(() => existsSync(received)).toBe(true);
    expect(readFileSync(received)).toEqual(bytes);
    console.log(
      'DISPLAY NODE READY ' +
        JSON.stringify({ originalHash: original.hash, displayHash, copy, sameBytes: true }),
    );
  } finally {
    await node.app.close();
    await main.app.close();
  }
});
