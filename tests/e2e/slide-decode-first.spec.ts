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
  setUpScreen,
  windowShowing,
} from './helpers';
import { goLive, makeSlides } from './placeholder-slides';
import { mediaUrl } from '../../src/shared/media';

/*
 * X19, L7: loaded is not decoded. Hold Next's preload just before its native decode starts, then press Next once
 * its complete flag is true. No pixels or native decode result are faked. For an image with no decoding hint, ask
 * Chromium to take its permitted asynchronous path; an explicit sync hint is respected. Read actual compositor
 * frames, rather than img.complete (hall-pictures cannot see a complete image painted without its pixels).
 * Generated noise only, no capture of a real display and no encoder or network stream.
 */

const OLD = [32, 64, 128] as const;
const PICTURE = [32, 192, 48] as const;
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
  drashtiDecodeProbe?: Probe;
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
      pixels.data[i] = 32 + noise;
      pixels.data[i + 1] = 192 + noise;
      pixels.data[i + 2] = 48 + noise;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  }, SIZE);
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

/** The hall's actual painted frames, sampled in Main without asking the renderer to decode a screenshot. */
async function captureHall(app: ElectronApplication, hall: Page): Promise<void> {
  const w = await app.browserWindow(hall);
  await w.evaluate((window: BrowserWindow) => {
    const frames: Frame[] = [];
    (globalThis as DecodeGlobals).drashtiDecodeFrames = frames;
    window.webContents.beginFrameSubscription(false, (image) => {
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
}

/** The stream's own captured frames, the same source its encoder uses; no recording or internet destination. */
async function captureStream(program: Page): Promise<void> {
  await program.evaluate(async () => {
    const frames: Frame[] = [];
    (globalThis as DecodeGlobals).drashtiDecodeFrames = frames;
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
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

for (const place of ['hall', 'stream'] as const) {
  test(`${place}: a loaded but undecoded slide picture never cuts in without its pixels (X19 L7)`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-decode-first-'));
    const [picture = ''] = await importAndGetIds(win, [
      await bigPicture(win, join(dir, 'Placeholder large noise.png')),
    ]);
    const id = await makeSlides(
      win,
      'Placeholder decode first',
      [{ background: '#204080' }, { picture, background: '#c020c0' }],
      { kind: 'cut', durationMs: 0 },
    );
    let page: Page;
    if (place === 'hall') {
      await setUpScreen(win);
      page = await outputPage(app);
      await expect(page.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
      await captureHall(app, page);
    } else {
      await win.getByTestId('open-stream').click();
      page = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
      await expect(page.getByTestId('program-root')).toHaveAttribute('data-fonts', 'ready');
      await captureStream(page);
    }
    const frames = () =>
      place === 'hall'
        ? app.evaluate(() => (globalThis as DecodeGlobals).drashtiDecodeFrames ?? [])
        : page.evaluate(() => (globalThis as DecodeGlobals).drashtiDecodeFrames ?? []);
    await holdPreload(page, picture);
    await goLive(win, id, 0);
    await expect.poll(async () => matches((await frames()).at(-1), OLD)).toBe(true);
    const preload = page.locator(`img[data-preload="${picture}"]`);
    await expect(preload).toHaveAttribute('data-state', 'loading');
    await expect
      .poll(() =>
        preload.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === SIZE.width),
      )
      .toBe(true);
    const from = Date.now();
    await goLive(win, id, 1);
    await expect.poll(async () => matches((await frames()).at(-1), PICTURE)).toBe(true);
    const probe = await page.evaluate(() => {
      const probe = (globalThis as DecodeGlobals).drashtiDecodeProbe;
      probe?.release();
      return { loadedAtCut: probe?.loadedAtCut, widthAtCut: probe?.widthAtCut };
    });
    expect(probe, 'the cut exercised a genuinely loaded picture, before its preload decoded it').toEqual({
      loadedAtCut: true,
      widthAtCut: SIZE.width,
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
    expect(bad, `${place}: frames showing neither the old slide nor the new picture whole; ${line}`).toEqual(
      [],
    );
    await app.close();
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
    if (place === 'hall') {
      await setUpScreen(win);
      page = await outputPage(app);
      await expect(page.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
      await captureHall(app, page);
    } else {
      await win.getByTestId('open-stream').click();
      page = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
      await expect(page.getByTestId('program-root')).toHaveAttribute('data-fonts', 'ready');
      await captureStream(page);
    }
    const frames = () =>
      place === 'hall'
        ? app.evaluate(() => (globalThis as DecodeGlobals).drashtiDecodeFrames ?? [])
        : page.evaluate(() => (globalThis as DecodeGlobals).drashtiDecodeFrames ?? []);
    const rows: { option: string; fullMs: number; longestFrameMs: number; decodeMs: number }[] = [];
    // Alternate order to avoid one option always inheriting the other's first-use work.
    for (const round of [0, 1, 2]) {
      for (const option of round % 2 === 0 ? ['sync', 'decode'] : ['decode', 'sync']) {
        const url = mediaUrl(picture, 100 + round * 2 + (option === 'sync' ? 0 : 1));
        await page.evaluate(async (url) => {
          const g = globalThis as CostGlobals;
          g.drashtiDecodeCost?.surface.remove();
          const surface = document.createElement('div');
          Object.assign(surface.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '2147483647',
            background: '#204080',
          });
          const img = new Image();
          img.decoding = 'async';
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
        }, url);
        await expect.poll(async () => matches((await frames()).at(-1), OLD)).toBe(true);
        const from = await page.evaluate((option) => {
          const probe = (globalThis as CostGlobals).drashtiDecodeCost;
          if (!probe) throw new Error('no cost probe');
          if (!probe.img.complete || probe.img.naturalWidth !== SIZE.width) throw new Error('not loaded');
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
        }, option);
        await expect.poll(async () => matches((await frames()).at(-1), PICTURE)).toBe(true);
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
