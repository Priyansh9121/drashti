import { expect, it } from 'vitest';
import { initialEngineState } from '../../../shared/engine/state';
import { CuedStartKeeper } from './cued-start';

it('keeps the previous slide until Go while arming the same decoded cue, and Clear invalidates the hold', () => {
  const before = initialEngineState();
  before.layers.background = { kind: 'color', color: '#205020' };
  before.layers.slide = {
    presentationId: 'p',
    slideIndex: 0,
    notes: '',
    shownAt: 0,
    slide: { id: 'old', width: 1920, height: 1080, background: '#000000', elements: [] },
  };
  const background = {
    kind: 'media' as const,
    media: 'video' as const,
    mediaId: 'new',
    cueId: 'cue',
    fit: 'fit' as const,
    loop: false,
    startedAt: 1,
    seek: { at: 0, toMs: 1000, paused: true },
  };
  before.videoCue = { id: 'cue', label: 'Placeholder', background, playlist: null, required: [], ready: [] };
  const after = {
    ...before,
    videoCue: null,
    videoStart: { id: 'cue', at: 500, mediaIds: ['new'], soundIds: ['new'] },
    layers: { ...before.layers, background: { ...background, seek: { at: 500, toMs: 1000 } }, slide: null },
  };
  const keeper = new CuedStartKeeper();
  keeper.at(before, 100);
  const held = keeper.at(after, 400);
  expect(held?.layers.slide).toBe(before.layers.slide);
  expect(held?.layers.background).toEqual(before.layers.background);
  expect(held?.videoCue?.background.seek).toEqual({ at: 500, toMs: 1000 });
  expect(keeper.at(after, 500)?.layers.background).toEqual(after.layers.background);
  expect(
    keeper.at({ ...after, videoStart: null, layers: { ...after.layers, background: null } }, 450)?.layers
      .background,
  ).toBeNull();
});

it('gives the armed decoder its crossfade clock before Go while holding the old scene', () => {
  const before = initialEngineState();
  const old = {
    kind: 'media' as const,
    media: 'video' as const,
    mediaId: 'old',
    fit: 'fit' as const,
    loop: false,
    startedAt: 1,
  };
  before.layers.background = old;
  const incoming = {
    ...old,
    mediaId: 'new',
    startedAt: 2,
    cueId: 'cue',
    seek: { at: 100, toMs: 0, paused: true },
  };
  before.videoCue = {
    id: 'cue',
    label: 'Placeholder',
    background: incoming,
    playlist: null,
    required: [],
    ready: [],
  };
  const playing = { ...incoming, seek: { at: 500, toMs: 0 } };
  const pair = { id: 'cue', from: old, at: 500, durationMs: 2000 };
  const after = {
    ...before,
    videoCue: null,
    videoCrossfade: pair,
    videoStart: { id: 'cue', at: 500, mediaIds: ['old', 'new'], soundIds: ['old', 'new'] },
    layers: { ...before.layers, background: playing },
  };
  const keeper = new CuedStartKeeper();
  keeper.at(before, 100);
  const armed = keeper.at(after, 400);
  expect(armed?.layers.background).toBe(old);
  expect(armed?.videoCue?.background.seek).toEqual({ at: 500, toMs: 0 });
  expect(
    armed?.videoCrossfade,
    'the child can activate on the shared clock before its parent refreshes',
  ).toBe(pair);
  expect(keeper.at(after, 500)?.layers.background).toBe(playing);
});
