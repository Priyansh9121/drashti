import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { DeckEffect } from '../../../shared/deck';
import { ImportedMotion } from './MotionTools';

const fade: DeckEffect = {
  shapeId: '2',
  step: 1,
  phase: 'in',
  kind: 'fade',
  delayMs: 0,
  durationMs: 300,
};

const render = (effect: DeckEffect) =>
  renderToStaticMarkup(
    createElement(ImportedMotion, {
      deck: { steps: [], media: [], motion: { effects: [effect], stepsMs: [0, 300], approximate: false } },
    }),
  );

it('explains how edits affect the saved clicks in the Motion panel', () => {
  const words = 'Added paragraphs appear with the built paragraph before them.';
  expect(render({ ...fade, paragraphs: [0, 0] })).toContain(words);
  const shapes = render(fade);
  expect(shapes).not.toContain(words);
  expect(shapes).toContain('Deleting an animated shape or paragraph can leave a click with no visible change.');
});
