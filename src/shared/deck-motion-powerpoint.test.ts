import { describe, expect, it } from 'vitest';
import type { DeckEffect } from './deck';
import { deckMotionFrame } from './deck-motion';

/*
 * PowerPoint's own movie of the comparison deck, measured frame by frame (Session 57, 13 Nov 2026: the lead's run 1,
 * measured by h-c3probe; assister/s57-notes/posts/lead-pptx-compare.md, "Run 1, measured"). Each effect runs 700 ms
 * from its click on a 64 × 38 box at (94, 51) of a 320 × 180 slide. A sample is one frame of the movie: its time after
 * the click, and the box's centre, size and turn, and how much of it shows (its opacity times its area, as a share of
 * the box's own; the movie's whole box reads 0.995 of its colour, so each is divided by that), all measured from the
 * frame's pixels. Drashti's pose at the same moment, as it reads the effect from PowerPoint's own XML, must be within
 * half a pixel (its centre), a pixel (its size), a degree and 3 % of the box.
 */

const box = { x: 94, y: 51, width: 64, height: 38 };
const screen = { width: 320, height: 180 };

/** One effect on the box, the only one of its click. */
function effect(kind: DeckEffect['kind'], phase: DeckEffect['phase'], more: Partial<DeckEffect> = {}): DeckEffect {
  return { shapeId: '2', step: 1, phase, kind, delayMs: 0, durationMs: 700, ...more };
}

/** One measured frame: ms after the click, the centre, the size, how much shows, and the turn (degrees). */
type Sample = [ms: number, cx: number, cy: number, w: number, h: number, shows: number, turn?: number];

/** Drashti's pose of the box at `ms`, measured the same way. */
function pose(one: DeckEffect, ms: number) {
  const frame = deckMotionFrame([one], 1, ms, box, screen);
  return {
    cx: box.x + box.width / 2 + frame.x,
    cy: box.y + box.height / 2 + frame.y,
    w: box.width * frame.scale,
    h: box.height * frame.scale,
    shows: frame.opacity * frame.scale ** 2,
    turn: frame.rotation,
  };
}

function expectLikePowerPoint(one: DeckEffect, samples: readonly Sample[]): void {
  for (const [ms, cx, cy, w, h, shows, turn = 0] of samples) {
    const drawn = pose(one, ms);
    const at = `${String(ms)} ms after the click`;
    expect(Math.hypot(drawn.cx - cx, drawn.cy - cy), `${at}: centre`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(drawn.w - w), `${at}: width`).toBeLessThanOrEqual(1);
    expect(Math.abs(drawn.h - h), `${at}: height`).toBeLessThanOrEqual(1);
    expect(Math.abs(drawn.shows - shows), `${at}: how much shows`).toBeLessThanOrEqual(0.03);
    expect(Math.abs(drawn.turn - turn), `${at}: turn`).toBeLessThanOrEqual(1);
  }
}

describe('effects Drashti draws as PowerPoint’s own movie shows them', () => {
  it('floats in and out: a straight move of 8 % of the slide with an even fade', () => {
    expectLikePowerPoint(effect('float', 'in', { direction: 'up', distance: 0.08 }), [
      [193.3, 126, 80.3, 64.06, 37.97, 0.2653],
      [358.3, 125.98, 77.03, 63.95, 38.09, 0.4985],
      [523.3, 126.01, 73.7, 63.96, 38.04, 0.7397],
    ]);
    expectLikePowerPoint(effect('float', 'out', { direction: 'down', distance: 0.08 }), [
      [195, 125.99, 74.01, 63.96, 37.94, 0.7236],
      [360, 126.01, 77.28, 63.97, 38.06, 0.4884],
      [525, 125.98, 80.98, 63.96, 37.98, 0.2462],
    ]);
  });

  it('grows and shrinks evenly about the shape’s centre', () => {
    expectLikePowerPoint(effect('grow-shrink', 'emphasis', { scale: 1.5 }), [
      [193.3, 126.16, 70, 72.99, 43.34, 1.3005],
      [358.3, 126.16, 70.16, 80.28, 47.67, 1.5739],
      [523.3, 126, 70.16, 87.98, 52.31, 1.8925],
    ]);
    expectLikePowerPoint(effect('grow-shrink', 'emphasis', { scale: 0.5 }), [
      [193.3, 126.16, 70, 55.01, 32.68, 0.7387],
      [358.3, 126.15, 70.17, 47.64, 28.35, 0.5548],
      [523.3, 126, 70.15, 39.98, 23.67, 0.3889],
    ]);
  });

  it('turns Grow & Turn and Shrink & Turn a quarter turn as they scale and fade', () => {
    expectLikePowerPoint(effect('zoom', 'in', { fade: true, scale: 0, degrees: 90 }), [
      [193.3, 126.07, 70.11, 17.68, 10.56, 0.0211, 64.9],
      [358.3, 126.1, 70.11, 32.84, 19.49, 0.1357, 43.9],
      [523.3, 126.1, 70.08, 47.9, 28.46, 0.4171, 22.7],
    ]);
    expectLikePowerPoint(effect('zoom', 'out', { fade: true, scale: 0, degrees: 90 }), [
      [195, 126.09, 70.09, 46.25, 27.47, 0.3779, 24.9],
      [360, 126.08, 70.06, 31.19, 18.56, 0.1146, 46],
      [525, 126.08, 70.11, 16.06, 9.59, 0.0151, 67.2],
    ]);
  });

  it('grows Basic Zoom in from nothing where the shape stands', () => {
    expectLikePowerPoint(effect('zoom', 'in'), [
      [193.3, 126.16, 70, 17.68, 10.75, 0.0774],
      [358.3, 126.01, 70, 32.7, 19.37, 0.2593],
      [523.3, 126, 70.16, 47.98, 28.33, 0.5588],
    ]);
  });
});
