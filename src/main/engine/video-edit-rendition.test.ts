import { describe, expect, it } from 'vitest';
import { initialEngineState, type EngineState } from '../../shared/engine/state';
import { PLAIN_VIDEO_EDIT, type VideoEditSnapshot } from '../../shared/video-edit';
import { prepareVideoEdits } from './video-edit-ready';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';

const recipe = { ...PLAIN_VIDEO_EDIT, trim: { startMs: 2000, endMs: 8000 }, speed: 2 };
const ready: VideoEditSnapshot = {
  mediaId: 'source',
  revision: 1,
  recipe,
  state: 'ready',
  readyMediaId: 'copy-1',
  message: null,
};
const resolution = {
  renditionOf: (id: string) => (id === 'copy-1' ? { sourceId: 'source', recipe } : null),
  lengthOf: () => 10000,
  available: () => true,
};
function showing(id = 'source'): EngineState {
  const state = initialEngineState();
  return {
    ...state,
    layers: {
      ...state.layers,
      background: {
        kind: 'media',
        mediaId: id,
        media: 'video',
        fit: 'fit',
        loop: false,
        startedAt: 1000,
        clip: { startMs: 4000, endMs: 7000 },
        seek: { at: 1000, toMs: 6000, paused: true },
        marks: [{ id: 'marker', name: 'Placeholder', atMs: 5000 }],
      },
    },
  };
}
describe('immutable edited files at new showings', () => {
  it('substitutes the ready file and maps source row points exactly once', () => {
    const source = showing();
    const before = structuredClone(source);
    const result = prepareVideoEdits(initialEngineState(), source, () => ready, false, resolution);
    expect(result.state?.layers.background).toMatchObject({
      mediaId: 'copy-1',
      durationMs: 3000,
      clip: { startMs: 1000, endMs: 2500 },
      seek: { toMs: 2000, paused: true },
      marks: [{ atMs: 1500 }],
    });
    expect(source).toEqual(before);
  });
  it('keeps an explicitly pinned file even when the source has newer edits preparing', () => {
    const pinned = showing('copy-1');
    const pending: VideoEditSnapshot = { ...ready, revision: 2, state: 'preparing', readyMediaId: null };
    expect(prepareVideoEdits(initialEngineState(), pinned, () => pending, false, resolution)).toEqual({
      state: pinned,
    });
  });
  it('refuses a missing rendition instead of playing the source', () => {
    const result = prepareVideoEdits(initialEngineState(), showing(), () => ready, false, {
      ...resolution,
      available: () => false,
    });
    expect(result.message).toContain('missing');
    expect(result.state).toBeUndefined();
  });
});

it('carries an already-playing rendition across a repeated library choice while new edits prepare', () => {
  let desired = ready;
  let clock = 1000;
  const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => ++clock, undefined, {
    sourceMediaId: (id) => resolution.renditionOf(id)?.sourceId ?? id,
    mediaLength: (id) => (id === 'source' ? 10000 : 3000),
    prepareVideoEdits: (before, next, historic) =>
      prepareVideoEdits(before, next, () => desired, historic, resolution),
  });
  const command = {
    type: 'setBackground' as const,
    background: {
      kind: 'media' as const,
      mediaId: 'source',
      media: 'video' as const,
      fit: 'fit' as const,
      loop: true,
    },
  };
  expect(engine.dispatch(command).ok).toBe(true);
  const pinned = engine.current.layers.background;
  expect(pinned).toMatchObject({ mediaId: 'copy-1' });
  desired = { ...ready, revision: 2, state: 'preparing', readyMediaId: null };
  clock = 2000;
  expect(engine.dispatch(command).ok).toBe(true);
  expect(engine.current.layers.background).toEqual(pinned);
});

it('keeps a deck video’s trigger, loop and volume with its prepared ID and source-time trim', () => {
  const source = initialEngineState();
  const slide = textSlide('slide', 'Placeholder');
  slide.elements = [
    {
      id: 'video',
      kind: 'video',
      mediaId: 'source',
      fit: 'fit',
      loop: true,
      volume: 0.2,
      frame: { x: 0, y: 0, width: 100, height: 100 },
    },
  ];
  slide.deck = {
    steps: [],
    media: [
      {
        kind: 'video',
        mediaId: 'source',
        box: { x: 0, y: 0, w: 1, h: 1 },
        clip: { startMs: 4000, endMs: 7000 },
        loop: true,
        volume: 0.2,
        start: { clicked: true },
      },
    ],
  };
  source.layers.slide = {
    presentationId: 'p',
    slideIndex: 0,
    slide,
    shownAt: 1000,
    clips: { source: { startMs: 4000, endMs: 7000 } },
    seeks: { source: { at: 1000, toMs: 4000, paused: true, waiting: true } },
  };
  const before = structuredClone(source);
  const result = prepareVideoEdits(initialEngineState(), source, () => ready, false, resolution);
  expect(result.state?.layers.slide?.slide.deck?.media[0]).toMatchObject({
    mediaId: 'copy-1',
    clip: { startMs: 1000, endMs: 2500 },
    loop: true,
    volume: 0.2,
    start: { clicked: true },
  });
  expect(result.state?.layers.slide?.seeks?.['copy-1']).toMatchObject({
    toMs: 1000,
    paused: true,
    waiting: true,
  });
  expect(source).toEqual(before);
});
