import { expect, it } from 'vitest';
import type { DeckEffect } from '../../../shared/deck';
import { deckMotionFrame } from '../../../shared/deck-motion';
import { paintDeckTarget } from './deck-target-paint';

const bounds = { x: 100, y: 100, width: 600, height: 400 };
const slide = { width: 1920, height: 1080 };

function effect(kind: DeckEffect['kind'], more: Partial<DeckEffect> = {}): DeckEffect {
  return { shapeId: '2', step: 1, phase: 'in', kind, delayMs: 0, durationMs: 400, ...more };
}

function drawing() {
  const writes: string[] = [];
  const style = new Proxy(
    { transform: '', opacity: '', clipPath: '', maskImage: '' },
    {
      set(target, key, value: string) {
        writes.push(String(key));
        return Reflect.set(target, key, value);
      },
    },
  );
  return { writes, style };
}

it('draws a Split’s soft edges as a mask on the moving shape, never a clip, and takes it off when the Split ends', () => {
  const { style, writes } = drawing();
  const split = effect('split', { splitAxis: 'x' });
  const paint = (ms: number, part = bounds) =>
    paintDeckTarget(style, deckMotionFrame([split], 1, ms, bounds, slide), bounds, part);
  // Half-way: the middle shows, each soft edge 13.5 % of the half box wide (40.5 px), beyond it nothing.
  paint(200);
  expect(style).toMatchObject({
    clipPath: '',
    maskImage:
      'linear-gradient(to right, rgb(0 0 0 / 0) 0%, rgb(0 0 0 / 0) 21.625%, rgb(0 0 0 / 1) 28.375%, rgb(0 0 0 / 1) 71.625%, rgb(0 0 0 / 0) 78.375%, rgb(0 0 0 / 0) 100%)',
  });
  expect(writes).toEqual(['maskImage']);
  writes.length = 0;
  paint(200);
  expect(writes).toEqual([]);
  // One part of a group, its left half: the same edges, where they fall across the whole group.
  paint(200, { ...bounds, width: 300 });
  expect(style.maskImage).toBe(
    'linear-gradient(to right, rgb(0 0 0 / 0) 0%, rgb(0 0 0 / 0) 43.25%, rgb(0 0 0 / 1) 56.75%, rgb(0 0 0 / 1) 143.25%, rgb(0 0 0 / 0) 156.75%, rgb(0 0 0 / 0) 200%)',
  );
  paint(400);
  expect(style).toMatchObject({ clipPath: '', maskImage: '', opacity: '', transform: '' });
});

it('leaves a Wipe and the other reveals to their clip, with no mask', () => {
  const { style } = drawing();
  const wipe = effect('wipe', { direction: 'left' });
  paintDeckTarget(style, deckMotionFrame([wipe], 1, 200, bounds, slide), bounds, bounds);
  expect(style).toMatchObject({ clipPath: 'inset(0% 0% 0% 50%)', maskImage: '' });
});
