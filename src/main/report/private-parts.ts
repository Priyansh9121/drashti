import type { CapturedPicture } from '../../shared/pdf-copy';
import { REPORT_PRIVATE_ATTR } from '../../shared/report-private';

/*
 * Help › Report a Problem…'s picture of a window never shows what its page marks private (alpha.23, the chat's
 * Safety: its words and names, shared/report-private.ts). The marked boxes are read from the page just before the
 * picture is taken and again just after (a section that moved meanwhile is blanked where it was and where it is), and
 * blanked in the pixels, with a margin, before the report holds them; the small copy beside the tick is made from the
 * blanked pixels. If the page cannot say where they are, there is no picture at all: never one that might show them.
 */

/** The page's viewport (CSS pixels) and each marked element's box in it: [left, top, width, height]. */
export interface PrivateParts {
  width: number;
  height: number;
  rects: [number, number, number, number][];
}

/** More boxes than any window has: past this, what the page answered is not trusted. */
const MAX_RECTS = 5000;
/** Device pixels around each box, so a box's anti-aliased edge (or half a pixel of rounding) is covered too. */
const MARGIN = 2;
/** The flat grey drawn over a private part: the same in BGRA and RGBA, and opaque. */
const BLANK = [128, 128, 128, 255] as const;

/** What the page answers (run in the window's page by webContents.executeJavaScript). */
export const PRIVATE_PARTS_SCRIPT = `(() => ({
  width: window.innerWidth,
  height: window.innerHeight,
  rects: Array.from(document.querySelectorAll('[${REPORT_PRIVATE_ATTR}]'), (e) => {
    const r = e.getBoundingClientRect();
    return [r.left, r.top, r.width, r.height];
  }),
}))()`;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The page's answer, or null when it is not in the script's own form. */
export function readPrivateParts(raw: unknown): PrivateParts | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { width, height, rects } = raw as Record<string, unknown>;
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return null;
  if (!Array.isArray(rects) || rects.length > MAX_RECTS) return null;
  const read: PrivateParts['rects'] = [];
  for (const r of rects as unknown[]) {
    if (!Array.isArray(r) || r.length !== 4 || !r.every(finite)) return null;
    read.push([r[0], r[1], r[2], r[3]] as [number, number, number, number]);
  }
  return { width, height, rects: read };
}

/** A copy of the picture with every private box blanked (the picture given is left as it is). */
export function blankPrivateParts(picture: CapturedPicture, parts: readonly PrivateParts[]): CapturedPicture {
  const pixels = new Uint8Array(picture.pixels);
  const { width, height } = picture;
  for (const part of parts) {
    const sx = width / part.width;
    const sy = height / part.height;
    for (const [left, top, w, h] of part.rects) {
      if (w <= 0 || h <= 0) continue;
      const x0 = Math.max(0, Math.floor(left * sx) - MARGIN);
      const y0 = Math.max(0, Math.floor(top * sy) - MARGIN);
      const x1 = Math.min(width, Math.ceil((left + w) * sx) + MARGIN);
      const y1 = Math.min(height, Math.ceil((top + h) * sy) + MARGIN);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pixels.set(BLANK, (y * width + x) * 4);
    }
  }
  return { ...picture, pixels };
}

/**
 * The picture taken between two reads of the private parts: both reads and the picture, or null when any of them
 * failed (no picture is better than one that might show the chat).
 */
export async function takePrivately<T>(
  read: () => Promise<unknown>,
  take: () => Promise<T | null>,
): Promise<{ taken: T; parts: PrivateParts[] } | null> {
  try {
    const before = readPrivateParts(await read());
    if (!before) return null;
    const taken = await take();
    if (taken === null) return null;
    const after = readPrivateParts(await read());
    if (!after) return null;
    return { taken, parts: [before, after] };
  } catch {
    return null;
  }
}
