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
