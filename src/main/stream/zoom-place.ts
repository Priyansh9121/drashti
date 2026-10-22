import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

/*
 * Where the window for Zoom was last (Session 48): its size and place, kept on this computer only (a file in
 * Drashti's own folder, never in the library, which travels with backups). It opens there again only while
 * that place is on a display now, at least partly; otherwise at 1280 × 720 in the middle of the controls'
 * display.
 */

export interface Place {
  x: number;
  y: number;
  width: number;
  height: number;
}

const placeSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(160).max(16_384),
  height: z.number().int().min(90).max(16_384),
});

/** The window's first size: what Zoom shares as 720p. */
export const ZOOM_SIZE = { width: 1280, height: 720 };
/** How much of the window must be on a display for it to open where it was. */
const ON_SCREEN = 100;

export function readPlace(file: string): Place | null {
  try {
    const parsed = placeSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writePlace(file: string, place: Place): void {
  try {
    writeFileSync(`${file}.tmp`, JSON.stringify(place));
    renameSync(`${file}.tmp`, file);
  } catch {
    // Not kept: it opens in the middle of the controls' display next time.
  }
}

/** Where to open it: where it was, when that is still on a display; else in the middle of the controls'. */
export function placeFor(saved: Place | null, workAreas: readonly Place[], controls: Place): Place {
  const shows = (p: Place, area: Place) =>
    Math.min(p.x + p.width, area.x + area.width) - Math.max(p.x, area.x) >= ON_SCREEN &&
    Math.min(p.y + p.height, area.y + area.height) - Math.max(p.y, area.y) >= ON_SCREEN;
  if (saved && workAreas.some((area) => shows(saved, area))) return saved;
  const width = Math.min(ZOOM_SIZE.width, controls.width);
  const height = Math.round((width * 9) / 16);
  return {
    x: Math.round(controls.x + (controls.width - width) / 2),
    y: Math.round(controls.y + Math.max(0, (controls.height - height) / 2)),
    width,
    height,
  };
}
