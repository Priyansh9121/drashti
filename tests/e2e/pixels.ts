import type { Page } from '@playwright/test';
import { type FrameLight, frameLight } from '../../src/shared/flash';
import { decodePng } from './png-decode';

/** The colour of each point (CSS pixels) in a page screenshot, decoded here, never in the page (png-decode.ts). */
export async function pixels(page: Page, points: { x: number; y: number }[]): Promise<number[][]> {
  const { width, height, rgba } = decodePng(await page.screenshot({ scale: 'css' }));
  return points.map(({ x, y }) => {
    const px = Math.min(width - 1, Math.max(0, Math.round(x)));
    const py = Math.min(height - 1, Math.max(0, Math.round(y)));
    const at = (py * width + px) * 4;
    return [rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0, rgba[at + 3] ?? 0];
  });
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
  const { width, height, rgba } = decodePng(await page.screenshot({ scale: 'css' }));
  const w = Math.ceil(width / 2);
  const h = Math.ceil(height / 2);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const from = (2 * y * width + 2 * x) * 4;
      const to = (y * w + x) * 4;
      out[to] = rgba[from] ?? 0;
      out[to + 1] = rgba[from + 1] ?? 0;
      out[to + 2] = rgba[from + 2] ?? 0;
      out[to + 3] = 255;
    }
  return frameLight(out, w, h, 1);
}
