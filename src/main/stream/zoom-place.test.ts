import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { placeFor, readPlace, writePlace, ZOOM_SIZE } from './zoom-place';

/* Where the window for Zoom opens (Session 48). */

const laptop = { x: 0, y: 25, width: 1440, height: 875 };
const tv = { x: 1440, y: 0, width: 1920, height: 1080 };

describe('where the window for Zoom opens', () => {
  it('first, at 1280 × 720 in the middle of the controls’ display (smaller to fit a small one)', () => {
    expect(ZOOM_SIZE).toEqual({ width: 1280, height: 720 });
    expect(placeFor(null, [laptop, tv], laptop)).toEqual({ x: 80, y: 103, width: 1280, height: 720 });
    const small = { x: 0, y: 0, width: 1024, height: 768 };
    expect(placeFor(null, [small], small)).toEqual({ x: 0, y: 96, width: 1024, height: 576 });
  });

  it('where it was, while that is still on a display; else in the middle of the controls’ display again', () => {
    const kept = { x: 1500, y: 100, width: 960, height: 540 };
    expect(placeFor(kept, [laptop, tv], laptop)).toEqual(kept);
    // The TV unplugged: back on the controls' display.
    expect(placeFor(kept, [laptop], laptop)).toEqual({ x: 80, y: 103, width: 1280, height: 720 });
  });

  it('keeps its size and place in a file of this computer’s, and reads nothing it cannot trust', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-zoom-place-'));
    try {
      const file = join(dir, 'zoom-window.json');
      expect(readPlace(file)).toBeNull();
      writePlace(file, { x: 10, y: 20, width: 960, height: 540 });
      expect(readPlace(file)).toEqual({ x: 10, y: 20, width: 960, height: 540 });
      writeFileSync(file, '{"x":1,"y":2,"width":5,"height":5}');
      expect(readPlace(file)).toBeNull();
      writeFileSync(file, 'not json');
      expect(readPlace(file)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
