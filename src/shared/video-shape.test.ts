import { describe, expect, it } from 'vitest';
import {
  isPlainPlayback,
  NO_PLAYBACK_SETTINGS,
  playbackSettingsSchema,
  readPlaybackSettings,
} from './playback-settings';
import { SHAPE_WORDS, shapeAspect, shapedFrame, shapeOverride, VIDEO_SHAPES } from './video-shape';

/*
 * Sound and picture…'s Shape (alpha.20, x55, slice 6b; the owner's "Yes, all A" to Q60-39 P6 (c) A): kept with a
 * video's own settings, as the file says unless chosen; each shape's width over its height; and the box a video is
 * drawn in, fitted inside its place or filling it, the picture stretched to that box.
 */

const SCREEN = { width: 1920, height: 1080 };

/** A number to a thousandth of a pixel (a box's edge a hair off 0 reads 0, never −0). */
const r = (v: number) => Math.round(v * 1000) / 1000 + 0;

/** A box's numbers, each to a thousandth of a pixel. */
const rounded = (b: { x: number; y: number; width: number; height: number }) => ({
  x: r(b.x),
  y: r(b.y),
  width: r(b.width),
  height: r(b.height),
});

describe('a video’s Shape (Sound and picture…)', () => {
  it('is kept with the file’s own settings: as the file says unless one is chosen, anything else refused', () => {
    expect(NO_PLAYBACK_SETTINGS.shape).toBe('file');
    for (const shape of ['16:9', '4:3', '1:1', '21:9'] as const) {
      const kept = { ...NO_PLAYBACK_SETTINGS, shape };
      expect(readPlaybackSettings(JSON.stringify(kept))).toEqual(kept);
      expect(isPlainPlayback(kept)).toBe(false);
    }
    expect(playbackSettingsSchema.safeParse({ ...NO_PLAYBACK_SETTINGS, shape: '2:1' }).success).toBe(false);
    expect(readPlaybackSettings(JSON.stringify({ ...NO_PLAYBACK_SETTINGS, shape: 'wide' }))).toEqual(
      NO_PLAYBACK_SETTINGS,
    );
  });

  it('says each shape’s width over its height, none for the file’s own, in the window’s words', () => {
    expect(shapeAspect('16:9')).toBeCloseTo(16 / 9, 12);
    expect(shapeAspect('4:3')).toBeCloseTo(4 / 3, 12);
    expect(shapeAspect('1:1')).toBe(1);
    expect(shapeAspect('21:9')).toBeCloseTo(21 / 9, 12);
    expect(shapeAspect('file')).toBeNull();
    expect(shapeAspect(undefined)).toBeNull();
    expect(shapeOverride('file')).toBeNull();
    expect(shapeOverride('21:9')).toBe('21:9');
    expect(VIDEO_SHAPES.map((s) => SHAPE_WORDS[s])).toEqual([
      'As the file says',
      '16:9 (wide)',
      '4:3',
      '1:1 (square)',
      '21:9 (cinema)',
    ]);
  });

  it('draws a video in a box of its shape: fitted, the largest inside its place; filling, the smallest over it; centred', () => {
    // A 4:3 video set to 16:9 on a 16:9 screen: the whole screen, fitted or filling.
    expect(rounded(shapedFrame(16 / 9, SCREEN, 'fit'))).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(rounded(shapedFrame(16 / 9, SCREEN, 'fill'))).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    // 4:3 fitted on a 16:9 screen: bars at the sides.
    expect(rounded(shapedFrame(4 / 3, SCREEN, 'fit'))).toEqual({ x: 240, y: 0, width: 1440, height: 1080 });
    // 21:9 fitted: bars above and below; filling: as tall as the screen, its sides past the screen's.
    expect(rounded(shapedFrame(21 / 9, SCREEN, 'fit'))).toEqual({
      x: 0,
      y: 128.571,
      width: 1920,
      height: 822.857,
    });
    expect(rounded(shapedFrame(21 / 9, SCREEN, 'fill'))).toEqual({
      x: -300,
      y: 0,
      width: 2520,
      height: 1080,
    });
    // 1:1 filling a 16:9 screen: as wide, its top and bottom past the screen's.
    expect(rounded(shapedFrame(1, SCREEN, 'fill'))).toEqual({ x: 0, y: -420, width: 1920, height: 1920 });
    // 16:9 fitted in a 4:3 box (a 4:3 stage screen, a slide's box): bars above and below.
    expect(rounded(shapedFrame(16 / 9, { width: 1440, height: 1080 }, 'fit'))).toEqual({
      x: 0,
      y: 135,
      width: 1440,
      height: 810,
    });
    // A box with no size draws nothing new.
    expect(shapedFrame(16 / 9, { width: 0, height: 0 }, 'fit')).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
