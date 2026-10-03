import type { Page } from '@playwright/test';

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
