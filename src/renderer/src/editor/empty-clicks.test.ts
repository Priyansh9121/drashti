import { expect, it } from 'vitest';
import type { DeckEffect, DeckSlide } from '../../../shared/deck';
import { deckBackgroundTarget } from '../../../shared/deck-motion';
import type { MediaElement, ShapeElement, TextElement } from '../../../shared/model';
import { emptyClicks } from './empty-clicks';

const frame = { x: 0, y: 0, width: 100, height: 50 };
const shape: ShapeElement = {
  id: 'placeholder-shape',
  kind: 'shape',
  frame,
  fill: '#ffffff',
  cornerRadius: 0,
  opacity: 1,
  sourceShapeId: 'placeholder-source',
  sourceGroupIds: ['placeholder-group'],
};
const effect = (step: number, shapeId: string, paragraphs?: [number, number]): DeckEffect => ({
  step,
  shapeId,
  paragraphs,
  phase: 'in',
  kind: 'fade',
  delayMs: 0,
  durationMs: 300,
});
const deck = (effects: DeckEffect[], clicks: number): DeckSlide => ({
  steps: [],
  media: [],
  motion: { effects, stepsMs: Array.from({ length: clicks + 1 }, () => 300), approximate: false },
});

it('finds remaining group, shape and background targets, and skips a hidden object', () => {
  const motion = deck(
    [
      effect(1, 'placeholder-group'),
      effect(2, 'placeholder-source'),
      effect(3, deckBackgroundTarget('placeholder-source')),
      effect(4, 'placeholder-hidden'),
      effect(5, 'placeholder-gone'),
    ],
    5,
  );
  expect(
    emptyClicks(motion, [shape, { ...shape, sourceShapeId: 'placeholder-hidden', hidden: true }]),
  ).toEqual([4, 5]);
});

it('uses the preceding build for added words and leaves a deleted paragraph’s click empty', () => {
  const text: TextElement = {
    id: 'placeholder-text',
    kind: 'text',
    frame,
    text: 'Placeholder first\nPlaceholder continuation\nPlaceholder added',
    runs: [
      { text: 'Placeholder first' },
      { text: '\n', softBreak: true },
      { text: 'Placeholder continuation\nPlaceholder added' },
    ],
    lang: null,
    sourceShapeId: 'placeholder-paragraphs',
    style: {
      fontFamily: null,
      fontSize: 32,
      fontWeight: 400,
      color: '#ffffff',
      align: 'left',
      verticalAlign: 'top',
      lineHeight: 1.2,
      shadow: false,
    },
  };
  const motion = deck(
    [effect(1, 'placeholder-paragraphs', [0, 0]), effect(2, 'placeholder-paragraphs', [2, 2])],
    2,
  );
  expect(emptyClicks(motion, [text])).toEqual([2]);
});

it('keeps a media start active and leaves baked video clicks alone', () => {
  const motion = deck([], 2);
  motion.media.push({
    kind: 'audio',
    mediaId: 'placeholder-audio',
    box: { x: 0, y: 0, w: 1, h: 1 },
    loop: false,
    volume: 1,
    start: { step: 1, offsetMs: 0 },
  });
  expect(emptyClicks(motion, [])).toEqual([2]);
  motion.steps.push({ clipId: 'placeholder-clip', lastId: 'placeholder-still', clipMs: 300 });
  expect(emptyClicks(motion, [])).toEqual([]);
});

it('counts a video start only while its visible video object survives', () => {
  const motion = deck([], 1);
  motion.media.push({
    kind: 'video',
    mediaId: 'placeholder-video',
    box: { x: 0, y: 0, w: 1, h: 1 },
    loop: false,
    volume: 1,
    start: { step: 1, offsetMs: 0 },
  });
  const video: MediaElement = {
    id: 'placeholder-object',
    kind: 'video',
    frame,
    mediaId: 'placeholder-video',
    fit: 'fit',
  };
  expect(emptyClicks(motion, [video])).toEqual([]);
  expect.soft(emptyClicks(motion, [])).toEqual([1]);
  expect(emptyClicks(motion, [{ ...video, hidden: true }])).toEqual([1]);
});

it('keeps timed transitions active and treats a Cut on an empty click as empty', () => {
  const motion = deck([], 2);
  motion.stepTransitions = {
    1: { mode: 'instead', transition: { kind: 'cut', durationMs: 0 } },
    2: { mode: 'over', transition: { kind: 'dissolve', durationMs: 300 } },
  };
  expect(emptyClicks(motion, [])).toEqual([1]);
});
