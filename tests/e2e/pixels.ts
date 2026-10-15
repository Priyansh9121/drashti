import type { Page } from '@playwright/test';
import { type FrameLight, frameLight } from '../../src/shared/flash';

/** The colour of each point (CSS pixels) in a page screenshot, decoded in the page itself. */
export async function pixels(page: Page, points: { x: number; y: number }[]): Promise<number[][]> {
  const png = (await page.screenshot({ scale: 'css' })).toString('base64');
  return page.evaluate(
    async ({ png, points }) => {
      // Decoded by hand: the page's security policy refuses fetch() of a data URL.
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return [];
      ctx.drawImage(bitmap, 0, 0);
      return points.map(({ x, y }) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data]);
    },
    { png, points },
  );
}

export const near = (rgba: number[] | undefined, rgb: [number, number, number], within = 40): boolean =>
  rgba !== undefined && rgb.every((c, i) => Math.abs((rgba[i] ?? -999) - c) <= within);

/** Where points on a screen's canvas (canvas pixels) are in its page (CSS pixels), from its scene's box. */
export async function onCanvas(
  page: Page,
  points: { x: number; y: number }[],
  testId = 'scene',
): Promise<{ x: number; y: number }[]> {
  return page
    .getByTestId(testId)
    .first()
    .evaluate((scene, points) => {
      const r = scene.getBoundingClientRect();
      const [w, h] = (scene.getAttribute('data-canvas') ?? '1920x1080').split('x').map(Number);
      return points.map((p) => ({
        x: r.left + (p.x / (w ?? 1920)) * r.width,
        y: r.top + (p.y / (h ?? 1080)) * r.height,
      }));
    }, points);
}

/** The colours at points on a screen's canvas. */
export async function canvasPixels(page: Page, points: { x: number; y: number }[]): Promise<number[][]> {
  return pixels(page, await onCanvas(page, points));
}

/**
 * A page's whole frame as the design lab's flash check measures it (src/shared/flash.ts, Session 27): every
 * second pixel each way, taken from a screenshot decoded in the page, measured here.
 */
export async function lightOf(page: Page): Promise<FrameLight> {
  const png = (await page.screenshot({ scale: 'css' })).toString('base64');
  const grid = await page.evaluate(async (png) => {
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const w = Math.ceil(bitmap.width / 2);
    const h = Math.ceil(bitmap.height / 2);
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const from = (2 * y * bitmap.width + 2 * x) * 4;
        const to = (y * w + x) * 4;
        out[to] = data[from] ?? 0;
        out[to + 1] = data[from + 1] ?? 0;
        out[to + 2] = data[from + 2] ?? 0;
        out[to + 3] = 255;
      }
    let text = '';
    for (let i = 0; i < out.length; i += 0x8000) text += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return { w, h, base64: btoa(text) };
  }, png);
  return frameLight(Buffer.from(grid.base64, 'base64'), grid.w, grid.h, 1);
}
