import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { DeckEffect } from '../../../shared/deck';
import type { ShapeElement } from '../../../shared/model';
import { ImportedMotion } from './MotionTools';

const fade: DeckEffect = {
  shapeId: '2',
  step: 1,
  phase: 'in',
  kind: 'fade',
  delayMs: 0,
  durationMs: 300,
};

const shape: ShapeElement = {
  id: 'placeholder-shape',
  kind: 'shape',
  frame: { x: 0, y: 0, width: 40, height: 40 },
  sourceShapeId: '2',
  fill: '#ffffff',
  cornerRadius: 0,
  opacity: 1,
};

const render = (effects: DeckEffect[]) => {
  const props = {
    deck: {
      steps: [],
      media: [],
      motion: { effects, stepsMs: [0, ...effects.map(() => 300)], approximate: false },
    },
    elements: [shape],
  };
  return renderToStaticMarkup(createElement(ImportedMotion, props));
};

it('explains added paragraphs only on a slide with paragraph builds', () => {
  const words = 'Added paragraphs appear with the built paragraph before them.';
  expect(render([{ ...fade, paragraphs: [0, 0] }])).toContain(words);
  expect(render([fade])).not.toContain(words);
});

it('shows no deletion warning while a click still has a target', () => {
  expect(render([fade])).not.toContain(
    'Deleting an animated shape or paragraph can leave a click with no visible change.',
  );
  expect(render([fade])).not.toContain('nothing left to move');
});

it('names only the click whose target is gone', () => {
  const words = render([fade, { ...fade, shapeId: 'gone', step: 2 }]);
  expect(words).toContain('Click 2 has nothing left to move');
  expect(words).not.toContain('Click 1 has nothing left to move');
});
