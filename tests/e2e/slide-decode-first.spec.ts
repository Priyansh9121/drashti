import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { BrowserWindow } from 'electron';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  type PageGlobals,
  setUpScreen,
  windowShowing,
} from './helpers';
import { goLive, makeSlides } from './placeholder-slides';
import { mediaUrl } from '../../src/shared/media';

/*
 * X19, L7: loaded is not decoded. Hold Next's preload just before its native decode starts, then press Next once
 * its complete flag is true. The probe starts no decode until the first actual cut frame has been captured, so it
 * cannot prepare the picture early and hide the fault. Neutral greys avoid video colour-matrix differences. For an
 * image with no decoding hint, ask
 * Chromium to take its permitted asynchronous path; an explicit sync hint is respected. Read actual compositor
 * frames, rather than img.complete (hall-pictures cannot see a complete image painted without its pixels).
 * Generated noise only, no capture of a real display and no encoder or network stream.
 */

const OLD = [32, 32, 32] as const;
const PICTURE = [192, 192, 192] as const;
const SIZE = { width: 6144, height: 3456 };

interface Frame {
  t: number;
  rgb: number[];
}

interface Probe {
  loadedAtCut: boolean;
  widthAtCut: number;
  release(): void;
}

type DecodeGlobals = typeof globalThis & {
  drashtiDecodeFrames?: Frame[];
  drashtiDecodeWindowId?: number;
  drashtiDecodeProbe?: Probe;
  drashtiDecodeCaptureStop?: () => void;
};

/** A large PNG whose noise prevents the decoder treating it as a tiny flat-colour picture. */
async function bigPicture(page: Page, file: string): Promise<string> {
  const base64 = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const pixels = ctx.createImageData(width, height);
    let seed = 0x12345678;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const noise = ((seed >>> 0) % 33) - 16;
      pixels.data[i] = 192 + noise;
      pixels.data[i + 1] = 192 + noise;
      pixels.data[i + 2] = 192 + noise;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  }, SIZE);
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

/** A still page paints only on damage: keep one corner painting until this capturer has its first real frame. */
async function paintUntilCapture(page: Page): Promise<() => Promise<void>> {
  await page.evaluate(() => {
    const g = globalThis as DecodeGlobals;
    g.drashtiDecodeCaptureStop?.();
    const spot = document.createElement('div');
    spot.id = 'decode-test-capture-nudge';
    spot.setAttribute('aria-hidden', 'true');
    spot.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;z-index:2147483647;background:rgba(0,0,0,0)';
    document.body.appendChild(spot);
    let on = false;
    const paint = () => {
      on = !on;
      spot.style.background = on ? 'rgba(0,0,0,0.004)' : 'rgba(0,0,0,0)';
    };
    // The same start-up painting as program/capture.ts's wantFrame. No image is prepared by this corner pixel.
    paint();
    const timer = setInterval(paint, 250);
    g.drashtiDecodeCaptureStop = () => {
      clearInterval(timer);
      spot.remove();
      delete g.drashtiDecodeCaptureStop;
    };
  });
  return async () => {
    await page.evaluate(() => (globalThis as DecodeGlobals).drashtiDecodeCaptureStop?.());
  };
}

/**
 * Subscribe from the hall window's first document, before its fonts/readiness can finish. A late subscription on
 * chipless Windows can acknowledge two old black frames and then stop delivering, even though capturePage of the
 * same window is grey (91346, both attempts). This is the lifecycle already used by slide-current-first.spec.ts.
 */
async function recordHall(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app }) => {
    app.on('browser-window-created', (_event, w) => {
      w.webContents.once('dom-ready', () => {
        const url = w.webContents.getURL();
        if (!url.includes('/output.html') || url.includes('identify=')) return;
        const frames: Frame[] = [];
        (globalThis as DecodeGlobals).drashtiDecodeFrames = frames;
        (globalThis as DecodeGlobals).drashtiDecodeWindowId = w.id;
        w.webContents.beginFrameSubscription(false, (image) => {
          const bytes = image.resize({ width: 32, height: 18 }).toBitmap();
          const sum = [0, 0, 0];
          let count = 0;
          for (let y = 4; y < 14; y++)
            for (let x = 8; x < 24; x++) {
              const i = (y * 32 + x) * 4;
              sum[0] = (sum[0] ?? 0) + (bytes[i + 2] ?? 0);
              sum[1] = (sum[1] ?? 0) + (bytes[i + 1] ?? 0);
              sum[2] = (sum[2] ?? 0) + (bytes[i] ?? 0);
              count++;
            }
          frames.push({ t: Date.now(), rgb: sum.map((n) => n / count) });
        });
      });
    });
  });
}

/** The hall's actual painted frames, sampled in Main without asking the renderer to decode a screenshot. */
async function captureHall(app: ElectronApplication, hall: Page): Promise<number> {
  const by = Date.now() + 20_000;
  const w = await app.browserWindow(hall);
  // The native surface must exist before the capturer is attached; its first frame is the capture-start ack.
  await expect
    .poll(() => w.evaluate((window: BrowserWindow) => window.isVisible()), {
      timeout: Math.max(1, by - Date.now()),
    })
    .toBe(true);
  const stopPainting = await paintUntilCapture(hall);
  try {
    // beginFrameSubscription starts asynchronously. Changing the only still scene before the first delivered frame
    // races its initial snapshot; a captured black frame cannot acknowledge a later scene that was missed.
    await expect
      .poll(() => app.evaluate(() => (globalThis as DecodeGlobals).drashtiDecodeFrames?.length ?? 0), {
        timeout: Math.max(1, by - Date.now()),
      })
      .toBeGreaterThan(0);
  } finally {
    await stopPainting();
  }
  return by;
}

/** The stream's own captured frames, the same source its encoder uses; no recording or internet destination. */
async function captureStream(program: Page): Promise<number> {
  const by = Date.now() + 20_000;
  const stopPainting = await paintUntilCapture(program);
  try {
    await program.evaluate(async () => {
      const frames: Frame[] = [];
      (globalThis as DecodeGlobals).drashtiDecodeFrames = frames;
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1920, height: 1080, frameRate: 30 },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('no own-page video track');
      const Processor = (
        globalThis as unknown as {
          MediaStreamTrackProcessor: new (o: { track: MediaStreamTrack }) => {
            readable: ReadableStream<VideoFrame>;
          };
        }
      ).MediaStreamTrackProcessor;
      const reader = new Processor({ track }).readable.getReader();
      const canvas = new OffscreenCanvas(32, 18);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d context');
      void (async () => {
        for (;;) {
          const { value: frame, done } = await reader.read();
          if (done) break;
          ctx.drawImage(frame, 0, 0, 32, 18);
          frame.close();
          const bytes = ctx.getImageData(8, 4, 16, 10).data;
          const sum = [0, 0, 0];
          for (let i = 0; i < bytes.length; i += 4) {
            sum[0] = (sum[0] ?? 0) + (bytes[i] ?? 0);
            sum[1] = (sum[1] ?? 0) + (bytes[i + 1] ?? 0);
            sum[2] = (sum[2] ?? 0) + (bytes[i + 2] ?? 0);
          }
          frames.push({ t: Date.now(), rgb: sum.map((n) => n / (16 * 10)) });
        }
      })();
    });
    await expect
      .poll(() => program.evaluate(() => (globalThis as DecodeGlobals).drashtiDecodeFrames?.length ?? 0), {
        timeout: Math.max(1, by - Date.now()),
      })
      .toBeGreaterThan(0);
  } finally {
    await stopPainting();
  }
  return by;
}

/** Delay only the preload's request for native decoding. Its file loads normally and its complete flag is real. */
async function holdPreload(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked below only with the image as its receiver
    const nativeDecode = HTMLImageElement.prototype.decode;
    const pending: (() => void)[] = [];
    let released = false;
    const probe: Probe = {
      loadedAtCut: false,
      widthAtCut: 0,
      release() {
        if (released) return;
        released = true;
        for (const decode of pending) decode();
        HTMLImageElement.prototype.decode = nativeDecode;
      },
    };
    (globalThis as DecodeGlobals).drashtiDecodeProbe = probe;
    HTMLImageElement.prototype.decode = function () {
      if (this.getAttribute('data-preload') !== id || released) return nativeDecode.call(this);
      return new Promise<void>((resolve, reject) => {
        pending.push(() => {
          void nativeDecode.call(this).then(resolve, reject);
        });
      });
    };
    const seen = new WeakSet<HTMLImageElement>();
    new MutationObserver(() => {
      for (const img of document.querySelectorAll<HTMLImageElement>('[data-slide-in] img')) {
        if (img.getAttribute('data-media-id') !== id || seen.has(img)) continue;
        seen.add(img);
        // auto permits asynchronous decoding. Exercise that choice, without overriding the fix's sync hint.
        if (img.decoding === 'auto') img.decoding = 'async';
        probe.loadedAtCut = img.complete;
        probe.widthAtCut = img.naturalWidth;
      }
    }).observe(document.body, { childList: true, subtree: true });
  }, id);
}

const matches = (frame: Frame | undefined, rgb: readonly number[]) =>
  frame?.rgb.every((channel, i) => Math.abs(channel - (rgb[i] ?? 0)) < 12) === true;

/** Retain the last actual pixels in a readiness failure, rather than only a false predicate. */
async function waitCaptured(
  frames: () => Promise<Frame[]>,
  rgb: readonly number[],
  by = Date.now() + 20_000,
): Promise<void> {
  try {
    await expect
      .poll(async () => matches((await frames()).at(-1), rgb), { timeout: Math.max(1, by - Date.now()) })
      .toBe(true);
  } catch (error) {
    const all = await frames();
    console.log(`PIXEL READINESS ${JSON.stringify({ expected: rgb, last: all.at(-1), count: all.length })}`);
    throw error;
  }
}

/** Failure-only evidence from the actual page and window; never prepares a passing test's picture. */
async function sayFirstRevealState(app: ElectronApplication, page: Page): Promise<void> {
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
    'page state after failed first-reveal wait',
    page.evaluate(() => {
      const describe = (el: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          tag: el.tagName,
          data: Object.fromEntries(Object.entries(el.dataset)),
          box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          opacity: style.opacity,
          display: style.display,
          visibility: style.visibility,
          background: style.backgroundColor,
          transform: style.transform,
        };
      };
      const root = document.querySelector<HTMLElement>(
        '[data-testid="output-root"], [data-testid="program-root"]',
      );
      const paint = (globalThis as typeof globalThis & { drashtiPaintLog?: unknown[] }).drashtiPaintLog;
      return {
        at: Date.now(),
        ready: document.readyState,
        visibility: document.visibilityState,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        root: root ? describe(root) : null,
        boxes: [
          ...document.querySelectorAll<HTMLElement>(
            '[data-box], [data-layer], [data-slide-in], [data-slide]',
          ),
        ]
          .slice(0, 20)
          .map(describe),
        images: [...document.images].slice(0, 20).map((img) => ({
          ...describe(img),
          src: img.src,
          currentSrc: img.currentSrc,
          complete: img.complete,
          width: img.naturalWidth,
          height: img.naturalHeight,
          decoding: img.decoding,
          inIncoming: img.closest('[data-slide-in]') !== null,
        })),
        painted: paint?.slice(-5) ?? [],
      };
    }),
  );
  const windows = await bounded(
    'Main windows after failed first-reveal wait',
    app.evaluate(({ BrowserWindow }) => ({
      sourceWindow: (globalThis as DecodeGlobals).drashtiDecodeWindowId ?? null,
      windows: BrowserWindow.getAllWindows().map((w) => ({
        id: w.id,
        url: w.webContents.getURL(),
        visible: w.isVisible(),
        minimized: w.isMinimized(),
        focused: w.isFocused(),
        bounds: w.getBounds(),
      })),
    })),
  );
  console.log(`FIRST REVEAL STATE ${JSON.stringify({ dom, windows })}`);
  // This readback is an intervention AFTER the original wait has failed. Its result cannot turn the failure green.
  const readback = await bounded(
    'post-failure native readback',
    app.evaluate(async ({ BrowserWindow }, url) => {
      const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url);
      if (!w) return { missingWindow: true };
      const image = await w.webContents.capturePage();
      const size = image.getSize();
      const bytes = image.resize({ width: 32, height: 18 }).toBitmap();
      const sum = [0, 0, 0];
      let count = 0;
      for (let y = 4; y < 14; y++)
        for (let x = 8; x < 24; x++) {
          const i = (y * 32 + x) * 4;
          sum[0] = (sum[0] ?? 0) + (bytes[i + 2] ?? 0);
          sum[1] = (sum[1] ?? 0) + (bytes[i + 1] ?? 0);
          sum[2] = (sum[2] ?? 0) + (bytes[i] ?? 0);
          count++;
        }
      return {
        id: w.id,
        size,
        rgb: sum.map((n) => n / count),
        subscriptionFramesAfterReadback: (globalThis as DecodeGlobals).drashtiDecodeFrames?.length ?? 0,
      };
    }, page.url()),
  );
  console.log(`FIRST REVEAL READBACK ${JSON.stringify(readback)}`);
}

for (const place of ['hall', 'stream'] as const) {
  test(`${place}: a loaded but undecoded slide picture never cuts in without its pixels (X19 L7)`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const dir = mkdtempSync(join(tmpdir(), 'drashti-decode-first-'));
      const [picture = ''] = await importAndGetIds(win, [
        await bigPicture(win, join(dir, 'Placeholder large noise.png')),
      ]);
      const id = await makeSlides(
        win,
        'Placeholder decode first',
        [{ background: '#202020' }, { picture, background: '#606060' }],
        { kind: 'cut', durationMs: 0 },
      );
      let page: Page;
      let pixelsBy: number;
      if (place === 'hall') {
        await recordHall(app);
        await setUpScreen(win);
        page = await outputPage(app);
        await expect(page.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
        pixelsBy = await captureHall(app, page);
      } else {
        await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('slides'));
        await win.getByTestId('open-stream').click();
        page = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
        await expect(page.getByTestId('program-root')).toHaveAttribute('data-fonts', 'ready');
        pixelsBy = await captureStream(page);
      }
      const frames = () =>
        place === 'hall'
          ? app.evaluate(() => (globalThis as DecodeGlobals).drashtiDecodeFrames ?? [])
          : page.evaluate(() => (globalThis as DecodeGlobals).drashtiDecodeFrames ?? []);
      await holdPreload(page, picture);
      await goLive(win, id, 0);
      try {
        await waitCaptured(frames, OLD, pixelsBy);
      } catch (error) {
        await sayFirstRevealState(app, page);
        throw error;
      }
      // The original fixture remains 6144 wide. Check the exact source the app selected, including its ready
      // display rendition; on the old implementation (no descriptor) this is still the original width.
      const selectedWidth = await win.evaluate(
        async ({ picture, originalWidth }) => {
          const look = (await (globalThis as PageGlobals).drashti.media.looks())[picture];
          const display: unknown = Reflect.get(look ?? {}, 'display');
          return display &&
            typeof display === 'object' &&
            'width' in display &&
            typeof display.width === 'number'
            ? display.width
            : originalWidth;
        },
        { picture, originalWidth: SIZE.width },
      );
      const preload = page.locator(`img[data-preload="${picture}"]`);
      await expect(preload).toHaveAttribute('data-state', 'loading');
      await expect
        .poll(() =>
          preload.evaluate(
            (img: HTMLImageElement, width) => img.complete && img.naturalWidth === width,
            selectedWidth,
          ),
        )
        .toBe(true);
      const from = Date.now();
      await goLive(win, id, 1);
      // Observe the first actual cut frame before the probe can start a native decode and hide the fault. A correct
      // output's first changed frame is already the full picture; the old fast path first paints the slide background.
      await expect
        .poll(async () => (await frames()).some((frame) => frame.t >= from && !matches(frame, OLD)))
        .toBe(true);
      const probe = await page.evaluate(() => {
        const probe = (globalThis as DecodeGlobals).drashtiDecodeProbe;
        probe?.release();
        const img = document.querySelector<HTMLImageElement>('[data-slide-in] img');
        if (img) void img.decode().catch(() => undefined);
        return { loadedAtCut: probe?.loadedAtCut, widthAtCut: probe?.widthAtCut };
      });
      await waitCaptured(frames, PICTURE, from + 20_000);
      expect(probe, 'the cut exercised a genuinely loaded picture, before its preload decoded it').toEqual({
        loadedAtCut: true,
        widthAtCut: selectedWidth,
      });
      const cut = (await frames()).filter((frame) => frame.t >= from);
      const bad = cut.filter((frame) => !matches(frame, OLD) && !matches(frame, PICTURE));
      const line = cut
        .slice(0, 40)
        .map((frame) => `${String(frame.t - from)}ms:${frame.rgb.map(Math.round).join(',')}`)
        .join(' ');
      console.log(`${place} loaded-before-decode cut: ${String(cut.length)} frames; ${line}`);
      expect(
        cut.some((frame) => matches(frame, PICTURE)),
        'the new picture was actually captured',
      ).toBe(true);
      expect(
        bad,
        `${place}: frames showing neither the old slide nor the new picture whole; ${line}`,
      ).toEqual([]);
    } finally {
      await app.close();
    }
  });
}

interface CostProbe {
  surface: HTMLDivElement;
  img: HTMLImageElement;
  ticks: { t: number; gap: number }[];
  raf: number;
  began: number;
  decodedAfter: number;
}

type CostGlobals = typeof globalThis & { drashtiDecodeCost?: CostProbe };

/**
 * Compare the browser work of the two proposed fixes with fresh encoded-only URLs, on each real drawing page.
 * A sync paint displays the loaded image immediately; a decoded-address miss calls native decode() before revealing
 * it. The address-set lookup itself is negligible, so this measures their expensive part, not a synthetic Set loop.
 * Every first frame is captured, and the page's own frame gaps are kept too. No production test switch is needed.
 */
for (const place of ['hall', 'stream'] as const) {
  test(`${place}: measure sync presentation against an explicit decode wait for a loaded picture (X19 choice)`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-decode-cost-'));
    const [picture = ''] = await importAndGetIds(win, [
      await bigPicture(win, join(dir, 'Placeholder decode cost.png')),
    ]);
    let page: Page;
    let pixelsBy: number;
    if (place === 'hall') {
      await recordHall(app);
      await setUpScreen(win);
      page = await outputPage(app);
      await expect(page.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
      pixelsBy = await captureHall(app, page);
    } else {
      await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('slides'));
      await win.getByTestId('open-stream').click();
      page = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
      await expect(page.getByTestId('program-root')).toHaveAttribute('data-fonts', 'ready');
      pixelsBy = await captureStream(page);
    }
    const frames = () =>
      place === 'hall'
        ? app.evaluate(() => (globalThis as DecodeGlobals).drashtiDecodeFrames ?? [])
        : page.evaluate(() => (globalThis as DecodeGlobals).drashtiDecodeFrames ?? []);
    const id = await makeSlides(win, 'Placeholder decode cost scene', [{ background: '#202020' }], {
      kind: 'cut',
      durationMs: 0,
    });
    await goLive(win, id, 0);
    await waitCaptured(frames, OLD, pixelsBy);
    const rows: { option: string; fullMs: number; longestFrameMs: number; decodeMs: number }[] = [];
    // Alternate order to avoid one option always inheriting the other's first-use work.
    for (const round of [0, 1, 2]) {
      for (const option of round % 2 === 0 ? ['sync', 'decode'] : ['decode', 'sync']) {
        const url = mediaUrl(picture, 100 + round * 2 + (option === 'sync' ? 0 : 1));
        await page.evaluate(
          async ({ url, option }) => {
            const g = globalThis as CostGlobals;
            g.drashtiDecodeCost?.surface.remove();
            const surface = document.createElement('div');
            Object.assign(surface.style, {
              position: 'fixed',
              inset: '0',
              zIndex: '2147483647',
              background: '#202020',
            });
            const img = new Image();
            img.decoding = option === 'sync' ? 'sync' : 'async';
            Object.assign(img.style, {
              width: '100%',
              height: '100%',
              objectFit: 'fill',
              visibility: 'hidden',
            });
            surface.appendChild(img);
            document.body.appendChild(surface);
            g.drashtiDecodeCost = { surface, img, ticks: [], raf: 0, began: 0, decodedAfter: 0 };
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('generated picture failed to load'));
              img.src = url;
            });
          },
          { url, option },
        );
        await waitCaptured(frames, OLD);
        const from = await page.evaluate(
          ({ option, width }) => {
            const probe = (globalThis as CostGlobals).drashtiDecodeCost;
            if (!probe) throw new Error('no cost probe');
            if (!probe.img.complete || probe.img.naturalWidth !== width) throw new Error('not loaded');
            probe.began = Date.now();
            let last = probe.began;
            const tick = () => {
              const now = Date.now();
              probe.ticks.push({ t: now, gap: now - last });
              last = now;
              probe.raf = requestAnimationFrame(tick);
            };
            probe.raf = requestAnimationFrame(tick);
            if (option === 'sync') {
              probe.img.decoding = 'sync';
              probe.img.style.visibility = 'visible';
            } else {
              void probe.img.decode().then(() => {
                probe.decodedAfter = Date.now() - probe.began;
                probe.img.style.visibility = 'visible';
              });
            }
            return probe.began;
          },
          { option, width: SIZE.width },
        );
        await waitCaptured(frames, PICTURE);
        const captured = (await frames()).filter((frame) => frame.t >= from);
        const first = captured.find((frame) => matches(frame, PICTURE));
        expect(first, 'captured the full picture').toBeDefined();
        expect(captured.filter((frame) => !matches(frame, OLD) && !matches(frame, PICTURE))).toEqual([]);
        const measured = await page.evaluate((first) => {
          const probe = (globalThis as CostGlobals).drashtiDecodeCost;
          if (!probe) throw new Error('no cost probe');
          cancelAnimationFrame(probe.raf);
          return {
            longestFrameMs: Math.max(
              0,
              ...probe.ticks.filter((tick) => tick.t <= first).map((tick) => tick.gap),
            ),
            decodeMs: probe.decodedAfter,
          };
        }, first?.t ?? from);
        rows.push({ option, fullMs: (first?.t ?? from) - from, ...measured });
      }
    }
    console.log(`DECODE CHOICE ${place}: ${JSON.stringify(rows)}`);
    test.info().annotations.push({ type: `decode choice ${place}`, description: JSON.stringify(rows) });
    await app.close();
  });
}
