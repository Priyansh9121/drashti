import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { DeckEffect } from '../../../shared/deck';
import { ImportedMotion } from './MotionTools';

/*
 * The Motion panel's list of an imported slide's PowerPoint animations (W6 review L-new-2): it shows four lines and
 * scrolls past them, and a line can wrap at the panel's width, so even a short list can scroll. The keys reach it
 * whenever it has effects, or axe finds a scrollable region the keys cannot reach. Placeholder effects only.
 */

const effect = (step: number, more: Partial<DeckEffect> = {}): DeckEffect => ({
  shapeId: '2',
  step,
  phase: 'in',
  kind: 'fade',
  delayMs: 0,
  durationMs: 300,
  ...more,
});

function list(effects: DeckEffect[]): string {
  const stepsMs = Array.from({ length: Math.max(0, ...effects.map((e) => e.step)) + 1 }, () => 300);
  const motion = { effects, stepsMs, approximate: false };
  return renderToStaticMarkup(createElement(ImportedMotion, { deck: { steps: [], media: [], motion } }));
}

const reachable = /<ol aria-label="PowerPoint animation order"[^>]*tabindex="0"/u;

it('lets the keys reach the list of PowerPoint animations whenever it has effects, not only past four', () => {
  // Two lines that wrap at the panel's width can overflow its four lines.
  const wrapping = list([
    effect(12, { kind: 'zoom', fade: true, degrees: 90, paragraphs: [2, 3] }),
    effect(12, { kind: 'zoom', fade: true, degrees: 90, paragraphs: [4, 5], delayMs: 500 }),
  ]);
  expect(wrapping).toContain('Click 12 · Grow &amp; Turn · paragraphs 3–4');
  expect(wrapping).toMatch(reachable);
  expect(list([effect(1)])).toMatch(reachable);
  expect(list(Array.from({ length: 6 }, (_, i) => effect(i + 1)))).toMatch(reachable);
  // No effects: no list, so nothing for the keys to reach.
  expect(list([])).not.toContain('<ol');
});
