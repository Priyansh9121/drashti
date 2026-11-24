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

it("holds LIVE's scene past Go, through Main's Go-time patch, until its cued picture has started (QA23-CUELIVE-1)", () => {
  // a22-review-cuelive MUST-1: Main clears videoStart at exactly Go (show-engine.ts scheduleVideoCue); on a busy operator
  // window that patch could swap LIVE's scene before its picture's own check for Go set its rate.
  const before = initialEngineState();
  before.layers.background = { kind: 'color', color: '#205020' };
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
    layers: { ...before.layers, background: { ...background, seek: { at: 500, toMs: 1000 } } },
  };
  // Main's patch at Go: videoStart cleared, everything else as it was.
  const goPatch = { ...after, videoStart: null };
  let started = false;
  const keeper = new CuedStartKeeper((id, at, now) => id === 'cue' && !started && now < at + 250);
  keeper.at(before, 100);
  expect(keeper.at(after, 400)?.layers.background).toEqual(before.layers.background);
  // Past Go, its picture not started yet: still the old scene, with or without Main's patch.
  expect(keeper.at(after, 505)?.layers.background).toEqual(before.layers.background);
  expect(keeper.at(goPatch, 510)?.layers.background).toEqual(before.layers.background);
  // Once it has started: the cue's own scene.
  started = true;
  expect(keeper.at(goPatch, 520)?.layers.background).toEqual(after.layers.background);
});

it("lets LIVE's held scene go at once on any other change after Go, and 250 ms past Go at the latest", () => {
  const before = initialEngineState();
  before.layers.background = { kind: 'color', color: '#205020' };
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
    layers: { ...before.layers, background: { ...background, seek: { at: 500, toMs: 1000 } } },
  };
  const never = (id: string, at: number, now: number) => id === 'cue' && now < at + 250;
  const cleared = new CuedStartKeeper(never);
  cleared.at(before, 100);
  cleared.at(after, 400);
  // Clear after Go: no background at all, at once.
  const clear = { ...after, videoStart: null, layers: { ...after.layers, background: null } };
  expect(cleared.at(clear, 510)?.layers.background).toBeNull();
  const late = new CuedStartKeeper(never);
  late.at(before, 100);
  late.at(after, 400);
  expect(late.at({ ...after, videoStart: null }, 749)?.layers.background).toEqual(before.layers.background);
  expect(late.at({ ...after, videoStart: null }, 750)?.layers.background).toEqual(after.layers.background);
});

it("holds LIVE's scene through Main's Go-time patch when the drawn state is prepared anew on every patch (translated slides)", () => {
  // a22-review-cuelive SHOULD-5: Scene's preparedOutputState gives new `next` and `slideOff` objects on every call with
  // translated slides around the cue, so the drawn states always differ; the raw engine states are what is compared.
  const before = initialEngineState();
  before.layers.background = { kind: 'color', color: '#205020' };
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
    layers: { ...before.layers, background: { ...background, seek: { at: 500, toMs: 1000 } } },
  };
  const goPatch = { ...after, videoStart: null };
  // A prepared copy, as Scene draws: a new top-level object for what it translates, on every call.
  const prepared = (s: typeof before) => ({
    ...s,
    slideOff: s.slideOff ? { ...s.slideOff } : null,
    upcoming: [...s.upcoming],
  });
  const keeper = new CuedStartKeeper((id, at, now) => id === 'cue' && now < at + 250);
  keeper.at(prepared(before), 100, before);
  keeper.at(prepared(after), 400, after);
  expect(keeper.at(prepared(goPatch), 510, goPatch)?.layers.background).toEqual(before.layers.background);
});
