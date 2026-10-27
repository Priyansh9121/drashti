import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineState, LowerThirdLayer, PipLayer, VideoClips } from '../../shared/engine/state';
import { ENGINE_STATE_VERSION, initialEngineState, videoClip } from '../../shared/engine/state';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport, textSlide } from '../engine/testing';
import type { RecoveryFiles } from './live-state';
import { startingMode } from '../../shared/mode';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../shared/lower-thirds';
import type { MediaMarkers } from '../../shared/markers';
import { playbackPosition } from '../../shared/media';
import { DEFAULT_PIP_PLACE } from '../../shared/pip';
import { RECOVERY_MAX_AGE_MS } from '../../shared/recovery';
import { LiveStateWriter, savedFrom, startupRecovery, toRestore } from './live-state';

let dir: string;
let files: RecoveryFiles;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const background = {
  kind: 'media',
  mediaId: 'clouds',
  media: 'video',
  fit: 'fill',
  loop: true,
  startedAt: 1234,
} as const;

function live(
  patch: { slideIndex?: number | null; blackout?: boolean; withBackground?: boolean } = {},
): EngineState {
  const s = initialEngineState();
  const slideIndex = patch.slideIndex === undefined ? 2 : patch.slideIndex;
  return {
    ...s,
    live: { presentationId: 'p1', slideIndex: 2, slideCount: 5, arrangementId: null, playlist: null },
    blackout: patch.blackout ?? false,
    layers: {
      ...s.layers,
      slide:
        slideIndex === null
          ? null
          : { presentationId: 'p1', slideIndex, slide: textSlide('s', 'x'), shownAt: 5, notes: '' },
      background: patch.withBackground === false ? null : background,
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-recovery-'));
  files = { state: join(dir, 'live-state.json'), cleanMark: join(dir, 'live-state.clean') };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function saved(writer: LiveStateWriter, state: EngineState) {
  writer.update(state);
  await pause(30);
  await writer.settle();
}

describe('restart recovery', () => {
  it('keeps the slide on screen (not just the cursor), the background and black-out', () => {
    expect(savedFrom(live({ blackout: true }), 'run-1', new Date(0))).toEqual({
      // 2 since Session 20 (saved from the run's start); 1 is still read.
      version: 2,
      session: 'run-1',
      engineVersion: ENGINE_STATE_VERSION,
      savedAt: '1970-01-01T00:00:00.000Z',
      // With when it went up (Session 51), so its videos carry on.
      slide: { presentationId: 'p1', slideIndex: 2, arrangementId: null, shownAt: 5 },
      playlist: null,
      background,
      blackout: true,
      logo: null,
      audio: null,
      props: [],
      messages: [],
      ticker: null,
      stageMessage: null,
      timers: [],
      autoAdvance: null,
      repeat: null,
      lookId: null,
      masks: null,
      lowerThird: null,
      pip: null,
    });
    expect(savedFrom(live({ slideIndex: null }), 'run-1').slide).toBeNull();
  });

  it('keeps when the slide on the screens went up, so its videos and their sound carry on after a restart (Session 51)', async () => {
    // Since Session 3 a slide came back as if it had just gone up: its videos, and their sound, from the start.
    // (Under a timer shown alone the slide the show was at was not on the screens: none, timer-recovery.test.ts.)
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, live());
    expect(toRestore(files)?.slide).toEqual({
      presentationId: 'p1',
      slideIndex: 2,
      arrangementId: null,
      shownAt: 5,
    });
    // A file saved before has none: the slide comes back from the restart, as it did.
    const was = savedFrom(live(), 'crashed-run', new Date('2026-10-23T10:00:00.000Z'));
    writeFileSync(
      files.state,
      JSON.stringify({ ...was, slide: { presentationId: 'p1', slideIndex: 2, arrangementId: null } }),
    );
    expect(toRestore(files, null, new Date('2026-10-23T10:05:00.000Z'))?.slide).toEqual({
      presentationId: 'p1',
      slideIndex: 2,
      arrangementId: null,
    });
  });

  it('keeps the picture-in-picture box (Session 50) with when it went up, so it comes back still; alone, it is worth putting back', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    const place = { ...DEFAULT_PIP_PLACE, corner: null, x: 0.5, y: 0.25, size: 'large' } as const;
    const box: PipLayer = {
      source: { kind: 'media', mediaId: 'clouds', media: 'video' },
      place,
      swapped: true,
      shownAt: 4321,
    };
    const nothing = initialEngineState();
    // What it was animating then is not kept.
    const animating: PipLayer = { ...box, changed: { at: 4400, place: DEFAULT_PIP_PLACE, swapped: false } };
    await saved(writer, { ...nothing, layers: { ...nothing.layers, pip: animating } });
    expect(toRestore(files)?.pip).toEqual(box);
    // Every kind of picture is kept: the engine decides what comes back (never a window; an input in the list).
    for (const source of [
      { kind: 'slides' },
      { kind: 'input', inputId: 'in-1', name: 'Input 1', device: 'Placeholder capture device' },
      { kind: 'window', sourceId: 'window:4021:0', name: 'Placeholder meeting' },
    ] as const) {
      await saved(writer, { ...nothing, layers: { ...nothing.layers, pip: { ...box, source } } });
      expect(toRestore(files)?.pip?.source).toEqual(source);
    }
  });

  it('reads a damaged box as none, and files saved before the box as having none', () => {
    const file = (pip: unknown) => {
      // As a run saved it before the box (no `pip` at all), or with this in its place.
      const { pip: _box, ...before } = savedFrom(live(), 'crashed-run', new Date('2026-10-22T10:00:00.000Z'));
      writeFileSync(files.state, JSON.stringify({ ...before, ...(pip === undefined ? {} : { pip }) }));
      return toRestore(files, null, new Date('2026-10-22T10:05:00.000Z'));
    };
    expect(file(undefined)?.pip).toBeNull();
    for (const pip of [
      { source: { kind: 'camera' }, place: DEFAULT_PIP_PLACE, swapped: false, shownAt: 1 },
      {
        source: { kind: 'slides' },
        place: { ...DEFAULT_PIP_PLACE, size: 'huge' },
        swapped: false,
        shownAt: 1,
      },
      { source: { kind: 'slides' }, place: DEFAULT_PIP_PLACE, swapped: 'yes', shownAt: 1 },
      'box',
    ])
      expect(file(pip)?.pip, JSON.stringify(pip)).toBeNull();
    // The slide still comes back.
    expect(file('box')?.slide).toMatchObject({ slideIndex: 2 });
  });

  it('keeps another app’s window that was the background, so the notice can name it (Session 48)', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    const window = {
      kind: 'window',
      sourceId: 'window:4021:0',
      name: 'Placeholder meeting',
      startedAt: 77,
    } as const;
    const state = live({ slideIndex: null });
    await saved(writer, { ...state, layers: { ...state.layers, background: window } });
    expect(toRestore(files)).toMatchObject({ background: window });
  });

  it('keeps a video input that was the background, with its fade, so it can be put back (Session 50)', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    const input = {
      kind: 'input',
      inputId: 'in-1',
      name: 'Placeholder input',
      device: 'Placeholder camera',
      fit: 'fill',
      startedAt: 77,
      fade: { at: 77, durationMs: 1000 },
    } as const;
    const state = live({ slideIndex: null });
    await saved(writer, { ...state, layers: { ...state.layers, background: input } });
    expect(toRestore(files)).toMatchObject({ background: input });
    // One kept wrong (a fit no input has) is left out, as any background kept wrong is.
    await saved(writer, {
      ...state,
      layers: { ...state.layers, background: { ...input, fit: 'stretch' } as unknown as typeof input },
    });
    expect(toRestore(files)?.background ?? null).toBeNull();
  });

  it('keeps the live Look; a Look other than the first is worth putting back on its own', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    const nothing = initialEngineState();
    await saved(writer, { ...nothing, look: { id: 'look-first', name: 'Standard', groups: {} } });
    expect(toRestore(files, 'look-first')).toBeNull();
    await saved(writer, { ...nothing, look: { id: 'look-2', name: 'Placeholder', groups: {} } });
    expect(toRestore(files, 'look-first')).toMatchObject({ slide: null, lookId: 'look-2' });
    // With a slide up, the Look comes along whichever it is.
    await saved(writer, { ...live(), look: { id: 'look-first', name: 'Standard', groups: {} } });
    expect(toRestore(files, 'look-first')).toMatchObject({ lookId: 'look-first' });
  });

  it('keeps the time a slide moving on by itself had left, saved again every second while it counts', async () => {
    const counting: EngineState = { ...live(), autoAdvance: { startedAt: 10_000, durationMs: 8000 } };
    expect(savedFrom(counting, 'run-1', new Date(13_000)).autoAdvance).toEqual({
      leftMs: 5000,
      durationMs: 8000,
    });
    expect(savedFrom(counting, 'run-1', new Date(30_000)).autoAdvance).toEqual({
      leftMs: 0,
      durationMs: 8000,
    });
    // With no change at all, the file is written again and again while it counts.
    const running: EngineState = { ...live(), autoAdvance: { startedAt: Date.now(), durationMs: 60_000 } };
    const writer = new LiveStateWriter(files, { throttleMs: 5, heartbeatMs: 40 });
    await saved(writer, running);
    const first = (JSON.parse(readFileSync(files.state, 'utf8')) as { autoAdvance: { leftMs: number } })
      .autoAdvance;
    await pause(150);
    await writer.settle();
    const later = (JSON.parse(readFileSync(files.state, 'utf8')) as { autoAdvance: { leftMs: number } })
      .autoAdvance;
    expect(later.leftMs).toBeLessThan(first.leftMs);
    expect(toRestore(files)?.autoAdvance?.durationMs).toBe(60_000);
    writer.markClean();
    // A save may already be on its way: let it finish before the folder goes.
    await writer.settle();
  });

  it('keeps the playlist item being played, even with nothing else on screen', async () => {
    const playlist = { playlistId: 'sunday', itemId: 'item-3' };
    const state = live({ slideIndex: null, withBackground: false });
    const onItem = { ...state, live: { ...state.live, presentationId: null, slideIndex: null, playlist } };
    expect(savedFrom(onItem, 'run-1').playlist).toEqual(playlist);
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, onItem);
    expect(toRestore(files)).toMatchObject({ slide: null, playlist, background: null });
  });

  it('keeps the sound, props, messages, the stage message, timers that ran and the lower third', async () => {
    const state = live({ slideIndex: null, withBackground: false });
    const audio = { id: 'a', title: 'Placeholder', mediaId: 'tune', volume: 1, loop: false, startedAt: 99 };
    const lowerThird: LowerThirdLayer = {
      id: 'lt',
      lines: ['Placeholder name', 'Placeholder title'],
      look: DEFAULT_LOWER_THIRD_LOOK,
      where: 'hall',
      animation: 'fade-steady',
      shownAt: 77,
    };
    const show: EngineState = {
      ...state,
      layers: {
        ...state.layers,
        audio,
        props: [{ id: 'p', name: 'Placeholder logo', elements: [] }],
        messages: [{ id: 'm', text: 'Placeholder message', parts: [{ kind: 'timer', timerId: 't1' }] }],
        lowerThird,
      },
      stageMessage: 'Placeholder stage',
      timers: [
        {
          id: 't1',
          name: 'A',
          kind: 'countdown',
          durationMs: 1000,
          targetTime: null,
          allowsOverrun: false,
          startedAt: 5,
          elapsedMs: 0,
        },
        {
          id: 't2',
          name: 'B',
          kind: 'countup',
          durationMs: 0,
          targetTime: null,
          allowsOverrun: false,
          startedAt: null,
          elapsedMs: 0,
        },
      ],
    };
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, show);
    expect(toRestore(files)).toMatchObject({
      slide: null,
      audio,
      props: [{ id: 'p' }],
      messages: [{ id: 'm' }],
      stageMessage: 'Placeholder stage',
      // Only timers that ran: t2 was never started.
      timers: [{ id: 't1', startedAt: 5, elapsedMs: 0 }],
      // The lower third, from when it went up (Session 44).
      lowerThird,
    });
  });

  it('keeps where a video and a sound last jumped to (a marker, Back 15 s, Forward 15 s, Last 10 s), so they come back from there (Session 51)', async () => {
    const state = live({ slideIndex: null, withBackground: false });
    const video = {
      ...background,
      durationMs: 60_000,
      clip: { startMs: 10_000, endMs: 40_000 },
      seek: { at: 1_008_000, toMs: 33_000 },
      marks: [{ id: 'm1', name: 'Placeholder chorus', atMs: 30_000 }],
    };
    const sound = {
      id: 'a',
      title: 'Placeholder',
      mediaId: 'tune',
      volume: 1,
      loop: false,
      startedAt: 99,
      durationMs: 90_000,
      clip: { startMs: 5000, endMs: null },
      seek: { at: 1_008_000, toMs: 70_000 },
    };
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, { ...state, layers: { ...state.layers, background: video, audio: sound } });
    // The jump comes back; the start and end points and the markers are the library's as they are put back
    // (show-engine.ts restore), as every use of a file takes them.
    const { clip: _points, marks: _markers, ...jumped } = video;
    const { clip: _soundPoints, ...heard } = sound;
    const back = toRestore(files);
    expect(back?.background).toEqual(jumped);
    expect(back?.audio).toEqual(heard);
    // A jump kept wrong (before the file's start) leaves the layer out, as any layer kept wrong is.
    await saved(writer, {
      ...state,
      layers: { ...state.layers, background: { ...video, seek: { at: 1_008_000, toMs: -1 } } },
    });
    expect(toRestore(files)?.background ?? null).toBeNull();
  });

  it('after an unexpected stop, a video and a sound come back from their last jump, between their start and end points (Session 51)', async () => {
    // Since Session 14 the saved file lost both: they came back as if never jumped, over the whole file.
    const lengths: Record<string, number> = { clouds: 60_000, tune: 90_000 };
    const markers: Record<string, MediaMarkers> = {
      clouds: {
        startMs: 10_000,
        endMs: 40_000,
        markers: [{ id: 'm1', name: 'Placeholder chorus', atMs: 30_000 }],
      },
      tune: { startMs: 5000, endMs: 80_000, markers: [] },
    };
    const clock = { now: 1_000_000 };
    const engine = () =>
      new ShowEngine(makeSource(), new RecordingTransport(), () => clock.now, undefined, {
        mediaLength: (id) => lengths[id] ?? null,
        mediaMarkers: (id) => markers[id] ?? null,
      });
    const before = engine();
    before.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: 'clouds', media: 'video', fit: 'fill', loop: true },
    });
    before.dispatch({
      type: 'playAudio',
      audio: { id: 'a', title: 'Placeholder', mediaId: 'tune', volume: 1, loop: false },
    });
    // 8 s in: Forward 15 s on the video (0:18 to 0:33), Last 10 s on the sound (0:13 to 1:10).
    clock.now += 8000;
    before.dispatch({ type: 'skip', layer: 'background', jump: 'forward' });
    before.dispatch({ type: 'skip', layer: 'audio', jump: 'last' });
    const was = before.current.layers;
    expect(was.background).toMatchObject({ clip: { startMs: 10_000 }, seek: { toMs: 33_000 } });
    expect(was.audio).toMatchObject({ clip: { endMs: 80_000 }, seek: { toMs: 70_000 } });
    await saved(new LiveStateWriter(files, { throttleMs: 10 }), before.current);
    // Drashti stops dead, and starts again 2 s later.
    clock.now += 2000;
    const after = engine();
    const back = toRestore(files);
    if (!back) throw new Error('nothing to put back');
    expect(after.restore(back)).toMatchObject({ background: true, audio: true });
    expect(after.current.layers.background).toEqual(was.background);
    expect(after.current.layers.audio).toEqual(was.audio);
    // 12 s after the jumps, every screen and the audio player have them where they would be: the video round
    // its loop between 0:10 and 0:40 (at 0:15), the sound held at its end point (1:20).
    const bg = after.current.layers.background;
    const heard = after.current.layers.audio;
    if (bg?.kind !== 'media' || !heard) throw new Error('not put back');
    expect(playbackPosition(bg, 60, clock.now + 10_000)).toBe(15);
    expect(playbackPosition(heard, 90, clock.now + 10_000)).toBe(80);
  });

  it('after an unexpected stop, a slide’s, a prop’s and the logo’s videos come back between their start and end points, where they would be by now (Session 52)', async () => {
    // Since Session 27 (a prop, the logo) and Session 51 (the slide's) they came back where they would be, but over
    // the whole file: only a background video and the sound played between their points.
    const markers: Record<string, MediaMarkers> = { clouds: { startMs: 10_000, endMs: 40_000, markers: [] } };
    const looping = {
      id: 'placeholder-video',
      kind: 'video',
      mediaId: 'clouds',
      frame: { x: 0, y: 0, width: 640, height: 360 },
      fit: 'fit',
      loop: true,
    } as const;
    const source = makeSource();
    source.set('shown', [{ ...textSlide('sv', 'Placeholder words'), elements: [looping] }]);
    const clock = { now: 1_000_000 };
    const engine = () =>
      new ShowEngine(source, new RecordingTransport(), () => clock.now, undefined, {
        mediaMarkers: (id) => markers[id] ?? null,
      });
    const before = engine();
    before.dispatch({ type: 'goLive', presentationId: 'shown', slideIndex: 0 });
    before.dispatch({ type: 'showProp', prop: { id: 'p', name: 'Placeholder prop', elements: [looping] } });
    // The logo's plays once: it holds at its end point.
    before.dispatch({
      type: 'showLogo',
      prop: { id: 'l', name: 'Placeholder logo', elements: [{ ...looping, loop: false }] },
    });
    const points = { clouds: { startMs: 10_000, endMs: 40_000 } };
    const was = {
      slide: before.current.layers.slide,
      props: before.current.layers.props,
      logo: before.current.logo,
    };
    expect(was.slide?.clips).toEqual(points);
    expect(was.props[0]?.clips).toEqual(points);
    expect(was.logo?.clips).toEqual(points);
    await saved(new LiveStateWriter(files, { throttleMs: 10 }), before.current);
    // Drashti stops dead 8 s on, and starts again 2 s later.
    clock.now += 10_000;
    const after = engine();
    const back = toRestore(files);
    if (!back) throw new Error('nothing to put back');
    expect(after.restore(back)).toMatchObject({ slide: true, props: 1, logo: true });
    expect(after.current.layers.slide).toEqual(was.slide);
    expect(after.current.layers.props).toEqual(was.props);
    expect(after.current.logo).toEqual(was.logo);
    // 35 s after they went up, every screen has them where they would be: the slide's and the prop's round their
    // loop between 0:10 and 0:40 (at 0:15), the logo's held at its end point (0:40).
    const at = (startedAt: number | undefined, loop: boolean, clips: VideoClips | undefined) =>
      playbackPosition(
        { startedAt: startedAt ?? 0, loop, clip: videoClip(clips, 'clouds') },
        60,
        clock.now + 25_000,
      );
    const slide = after.current.layers.slide;
    const prop = after.current.layers.props[0];
    const logo = after.current.logo;
    expect(at(slide?.shownAt, true, slide?.clips)).toBe(15);
    expect(at(prop?.shownAt, true, prop?.clips)).toBe(15);
    expect(at(logo?.shownAt, false, logo?.clips)).toBe(40);
  });

  it('after an unexpected stop, a video from Media in the picture-in-picture box comes back between its start and end points, where it would be by now (Session 53)', async () => {
    // Since Session 50 it came back where it would be, but over the whole file.
    const markers: Record<string, MediaMarkers> = { clouds: { startMs: 10_000, endMs: 40_000, markers: [] } };
    const clock = { now: 1_000_000 };
    const engine = () =>
      new ShowEngine(makeSource(), new RecordingTransport(), () => clock.now, undefined, {
        mediaMarkers: (id) => markers[id] ?? null,
        mediaKind: (id) => (id === 'clouds' ? 'video' : null),
      });
    const before = engine();
    before.dispatch({ type: 'showPip', source: { kind: 'media', mediaId: 'clouds' } });
    const was = before.current.layers.pip;
    expect(was?.clips).toEqual({ clouds: { startMs: 10_000, endMs: 40_000 } });
    await saved(new LiveStateWriter(files, { throttleMs: 10 }), before.current);
    // Drashti stops dead 8 s on, and starts again 2 s later.
    clock.now += 10_000;
    const after = engine();
    const back = toRestore(files);
    if (!back) throw new Error('nothing to put back');
    expect(after.restore(back)).toMatchObject({ pip: true });
    expect(after.current.layers.pip).toEqual(was);
    // 35 s after it went up, every screen has it where it would be: round its loop between 0:10 and 0:40, at 0:15.
    const box = after.current.layers.pip;
    expect(
      playbackPosition(
        { startedAt: box?.shownAt ?? 0, loop: true, clip: videoClip(box?.clips, 'clouds') },
        60,
        clock.now + 25_000,
      ),
    ).toBe(15);
  });

  it('after an unexpected stop, what the time bar moved and paused comes back where it would be by now (Session 54)', async () => {
    const looping = {
      id: 'placeholder-video',
      kind: 'video',
      mediaId: 'clouds',
      frame: { x: 0, y: 0, width: 640, height: 360 },
      fit: 'fit',
      loop: true,
    } as const;
    const source = makeSource();
    source.set('shown', [{ ...textSlide('sv', 'Placeholder words'), elements: [looping] }]);
    const clock = { now: 1_000_000 };
    const engine = () =>
      new ShowEngine(source, new RecordingTransport(), () => clock.now, undefined, {
        mediaLength: () => 60_000,
        mediaKind: () => 'video',
      });
    const before = engine();
    before.dispatch({ type: 'goLive', presentationId: 'shown', slideIndex: 0 });
    before.dispatch({ type: 'showProp', prop: { id: 'p', name: 'Placeholder prop', elements: [looping] } });
    before.dispatch({ type: 'showPip', source: { kind: 'media', mediaId: 'tide' } });
    before.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: 'waves', media: 'video', fit: 'fill', loop: false },
    });
    clock.now += 5000;
    // The slide's video moved on to 0:30, the prop's paused 5 s in, the box's moved to 0:12, the background paused.
    before.dispatch({ type: 'moveTo', playing: { layer: 'slide', mediaId: 'clouds' }, toMs: 30_000 });
    before.dispatch({ type: 'pausePlaying', playing: { layer: 'props', propId: 'p', mediaId: 'clouds' } });
    before.dispatch({ type: 'moveTo', playing: { layer: 'pip' }, toMs: 12_000 });
    before.dispatch({ type: 'pausePlaying', playing: { layer: 'background' } });
    const was = before.current.layers;
    expect(was.slide?.seeks).toEqual({ clouds: { at: 1_005_000, toMs: 30_000 } });
    expect(was.props[0]?.seeks).toEqual({ clouds: { at: 1_005_000, toMs: 5000, paused: true } });
    await saved(new LiveStateWriter(files, { throttleMs: 10 }), before.current);
    // Drashti stops dead, and starts again 3 s later.
    clock.now += 3000;
    const after = engine();
    const back = toRestore(files);
    if (!back) throw new Error('nothing to put back');
    expect(after.restore(back)).toMatchObject({ slide: true, background: true, props: 1, pip: true });
    expect(after.current.layers.slide).toEqual(was.slide);
    expect(after.current.layers.props).toEqual(was.props);
    expect(after.current.layers.pip).toEqual(was.pip);
    expect(after.current.layers.background).toEqual(was.background);
    // Where each is by now, on every screen: moved ones played on from their move, paused ones waiting.
    const now = clock.now;
    const slide = after.current.layers.slide;
    const prop = after.current.layers.props[0];
    const box = after.current.layers.pip;
    const bg = after.current.layers.background;
    expect(playbackPosition({ startedAt: 0, loop: true, seek: slide?.seeks?.['clouds'] }, 60, now)).toBe(33);
    expect(playbackPosition({ startedAt: 0, loop: true, seek: prop?.seeks?.['clouds'] }, 60, now)).toBe(5);
    expect(playbackPosition({ startedAt: 0, loop: true, seek: box?.seeks?.['tide'] }, 60, now)).toBe(15);
    if (bg?.kind !== 'media') throw new Error('no background');
    expect(playbackPosition(bg, 60, now)).toBe(5);
  });

  it('after an unexpected stop, the logo’s video the time bar moved and paused comes back where it waited (Session 54, the owner’s answer of 28 Oct)', async () => {
    const looping = {
      id: 'placeholder-logo-video',
      kind: 'video',
      mediaId: 'emblem',
      frame: { x: 0, y: 0, width: 640, height: 360 },
      fit: 'fit',
      loop: true,
    } as const;
    const source = makeSource();
    const clock = { now: 1_000_000 };
    const engine = () =>
      new ShowEngine(source, new RecordingTransport(), () => clock.now, undefined, {
        mediaLength: () => 60_000,
        mediaKind: () => 'video',
      });
    const before = engine();
    before.dispatch({
      type: 'showLogo',
      prop: { id: 'logo', name: 'Placeholder logo', elements: [looping] },
    });
    clock.now += 5000;
    // Moved on to 0:20, then paused 2 s later, at 0:22.
    before.dispatch({ type: 'moveTo', playing: { layer: 'logo', mediaId: 'emblem' }, toMs: 20_000 });
    clock.now += 2000;
    before.dispatch({ type: 'pausePlaying', playing: { layer: 'logo', mediaId: 'emblem' } });
    const was = before.current.logo;
    expect(was?.seeks).toEqual({ emblem: { at: 1_007_000, toMs: 22_000, paused: true } });
    await saved(new LiveStateWriter(files, { throttleMs: 10 }), before.current);
    clock.now += 3000;
    const after = engine();
    const back = toRestore(files);
    if (!back) throw new Error('nothing to put back');
    expect(after.restore(back)).toMatchObject({ logo: true });
    expect(after.current.logo).toEqual(was);
    const seek = after.current.logo?.seeks?.['emblem'];
    expect(playbackPosition({ startedAt: 0, loop: true, seek }, 60, clock.now)).toBe(22);
  });

  it('puts props, the logo and messages back with the time they went up, so their videos carry on in step (Session 27)', async () => {
    const state = live({ slideIndex: null, withBackground: false });
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, {
      ...state,
      logo: { id: 'l', name: 'Placeholder logo', elements: [], shownAt: 555 },
      layers: {
        ...state.layers,
        props: [{ id: 'p', name: 'Placeholder prop', elements: [], shownAt: 777 }],
        messages: [{ id: 'm', text: 'Placeholder message', shownAt: 666 }],
      },
    });
    const back = toRestore(files);
    expect(back?.logo?.shownAt).toBe(555);
    expect(back?.props.map((p) => p.shownAt)).toEqual([777]);
    expect(back?.messages.map((m) => m.shownAt)).toEqual([666]);
  });

  it('keeps the announcements ticker, with when it started, so it carries on in step', async () => {
    const state = live({ slideIndex: null, withBackground: false });
    const ticker = { items: [{ id: 'a1', text: 'Placeholder announcement' }], startedAt: 4321 };
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, { ...state, layers: { ...state.layers, ticker } });
    expect(toRestore(files)).toMatchObject({ slide: null, ticker });
    // Nothing else on the screens: the ticker alone is worth putting back.
    await saved(writer, { ...initialEngineState(), layers: { ...initialEngineState().layers, ticker } });
    expect(toRestore(files)?.ticker).toEqual(ticker);
  });

  it('leaves out the layers saved by another engine version', () => {
    writeFileSync(
      files.state,
      JSON.stringify({
        version: 1,
        session: 'other-version',
        engineVersion: 11,
        savedAt: '2026-09-01T10:00:00.000Z',
        slide: { presentationId: 'p1', slideIndex: 1, arrangementId: null },
        background: null,
        blackout: false,
        audio: { id: 'a', title: '', mediaId: 'x', volume: 1, loop: false, startedAt: 1 },
        props: [{ id: 'p', name: '', elements: [] }],
        stageMessage: 'Kept?',
        timers: [{ id: 't', startedAt: 1, elapsedMs: 0 }],
      }),
    );
    // Five minutes after it was saved (the time is the test's own, not the real clock).
    expect(toRestore(files, null, new Date('2026-09-01T10:05:00.000Z'))).toMatchObject({
      slide: { slideIndex: 1 },
      audio: null,
      props: [],
      stageMessage: null,
      timers: [],
    });
  });

  it('reads a file alpha.11 saved (engine 12) whole: 13 only adds to it (Session 52)', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, live());
    const raw = JSON.parse(readFileSync(files.state, 'utf8')) as Record<string, unknown>;
    writeFileSync(files.state, JSON.stringify({ ...raw, engineVersion: 12 }));
    expect(toRestore(files)).toMatchObject({ slide: { slideIndex: 2 }, background });
  });

  it('reads a file alpha.12 saved (engine 13) whole: 14 only adds to it (Session 54)', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, live());
    const raw = JSON.parse(readFileSync(files.state, 'utf8')) as Record<string, unknown>;
    writeFileSync(files.state, JSON.stringify({ ...raw, engineVersion: 13 }));
    expect(toRestore(files)).toMatchObject({ slide: { slideIndex: 2 }, background });
  });

  it('reads files saved before playlists could be played', () => {
    writeFileSync(
      files.state,
      JSON.stringify({
        version: 1,
        session: 'old-run',
        engineVersion: 3,
        savedAt: '2026-09-01T10:00:00.000Z',
        slide: { presentationId: 'p1', slideIndex: 1, arrangementId: null },
        background: null,
        blackout: false,
      }),
    );
    expect(toRestore(files, null, new Date('2026-09-01T10:05:00.000Z'))).toMatchObject({
      slide: { slideIndex: 1 },
      playlist: null,
    });
  });

  it('puts back what was live after an unexpected stop', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, live({ blackout: true }));
    // No clean-quit mark: the run stopped unexpectedly.
    expect(toRestore(files)).toMatchObject({
      slide: { presentationId: 'p1', slideIndex: 2 },
      background,
      blackout: true,
    });
  });

  it('puts nothing back after a clean quit, even if a save lands after the mark', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, live());
    writer.markClean();
    expect(toRestore(files)).toBeNull();
    // A save still in flight at quit rewrites the same run's state: the mark still covers it.
    writer.update(live({ blackout: true }));
    await pause(30);
    await writer.settle();
    expect(toRestore(files)).toBeNull();
    // A later run that stops unexpectedly is not covered by the earlier mark.
    const next = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(next, live({ slideIndex: 4 }));
    expect(toRestore(files)?.slide).toEqual({
      presentationId: 'p1',
      slideIndex: 4,
      arrangementId: null,
      shownAt: 5,
    });
  });

  it('writes a run of changes once, whole, and leaves no partial files', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 40 });
    for (let i = 0; i < 20; i++) writer.update(live({ slideIndex: i }));
    await pause(80);
    await writer.settle();
    expect(JSON.parse(readFileSync(files.state, 'utf8'))).toMatchObject({ slide: { slideIndex: 19 } });
    expect(readdirSync(dir)).toEqual(['live-state.json']);
  });

  it('has nothing to put back when nothing was live, or the files cannot be read', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, live({ slideIndex: null, withBackground: false }));
    expect(toRestore(files)).toBeNull();
    writeFileSync(files.state, '{ not json');
    expect(toRestore(files)).toBeNull();
    writeFileSync(files.state, JSON.stringify({ version: 2 }));
    expect(toRestore(files)).toBeNull();
    rmSync(files.state);
    expect(toRestore(files)).toBeNull();
  });

  it('leaves out a background it cannot trust: another engine version, or not a background', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, live());
    const raw = JSON.parse(readFileSync(files.state, 'utf8')) as Record<string, unknown>;
    writeFileSync(files.state, JSON.stringify({ ...raw, engineVersion: 11 }));
    expect(toRestore(files)).toMatchObject({ slide: { slideIndex: 2 }, background: null });
    writeFileSync(files.state, JSON.stringify({ ...raw, background: { kind: 'media', mediaId: '../x' } }));
    expect(toRestore(files)?.background).toBeNull();
  });
});

/*
 * Session 20: how the last run ended, in each order of events, with the time injected. Every run saves the
 * show from its start (start), and a clean quit saves it once more before its mark, so the saved file always
 * names the last run. Before, a run that changed nothing saved nothing: after a clean quit, such a run made
 * the next start put the show of the run before it back, as after a crash (seen on 9 Oct 2026).
 */
describe('how the last run ended', () => {
  const HOUR = 60 * 60 * 1000;
  // A clock of the tests' own: never compared with the real one.
  let clock = 0;
  const now = () => new Date(clock);
  const nothingLive = initialEngineState();
  const startFinds = () => startupRecovery(files, { now: now() });
  const clean = { cleanQuit: true, recentStop: false, putBack: null, tooOld: null };
  /** A run of Drashti: it starts (saving the show it starts with), and the tests change, quit or stop it. */
  async function begin(state: EngineState = nothingLive) {
    const writer = new LiveStateWriter(files, { throttleMs: 10, now });
    writer.start(state);
    await pause(30);
    await writer.settle();
    return writer;
  }
  beforeEach(() => {
    clock = new Date(2026, 9, 9, 18, 0).getTime();
  });

  it('a clean quit, then a start that changes nothing and quits, then a start: nothing comes back (the 9 Oct order)', async () => {
    const first = await begin();
    await saved(first, live({ blackout: true }));
    first.markClean();
    clock += 2 * 60_000;
    expect(startFinds()).toEqual(clean);
    const second = await begin();
    clock += 90_000;
    second.markClean();
    expect(startFinds()).toEqual(clean);
  });

  it('a crash, then a start: the show comes back', async () => {
    const first = await begin();
    await saved(first, live({ blackout: true }));
    first.stop();
    clock += 30_000;
    const found = startFinds();
    expect(found.cleanQuit).toBe(false);
    expect(found.recentStop).toBe(true);
    expect(found.tooOld).toBeNull();
    expect(found.putBack).toMatchObject({
      slide: { presentationId: 'p1', slideIndex: 2 },
      background,
      blackout: true,
    });
  });

  it('a clean quit, then a start that changes nothing and crashes, then a start: nothing comes back', async () => {
    const first = await begin();
    await saved(first, live());
    first.markClean();
    clock += 60_000;
    const second = await begin();
    second.stop();
    clock += 60_000;
    // That run stopped unexpectedly (so Drashti comes back in the mode it was in), with nothing live.
    expect(startFinds()).toEqual({ cleanQuit: false, recentStop: true, putBack: null, tooOld: null });
  });

  it('a crash, a start that puts the show back and quits cleanly, then a start: nothing comes back', async () => {
    const first = await begin();
    await saved(first, live({ blackout: true }));
    first.stop();
    clock += 60_000;
    expect(startFinds().putBack).not.toBeNull();
    // The second run starts with the show put back, and quits on purpose.
    const second = await begin(live({ blackout: true }));
    clock += 60_000;
    second.markClean();
    expect(startFinds()).toEqual(clean);
  });

  it('a show saved 3 hours or more before the start is named, not put back; just under, it comes back', async () => {
    const first = await begin();
    await saved(first, live({ blackout: true }));
    first.stop();
    const savedAt = clock;
    expect(
      startupRecovery(files, { now: new Date(savedAt + RECOVERY_MAX_AGE_MS - 1) }).putBack,
    ).toMatchObject({
      blackout: true,
    });
    const late = startupRecovery(files, { now: new Date(savedAt + RECOVERY_MAX_AGE_MS) });
    expect(late.cleanQuit).toBe(false);
    expect(late.recentStop).toBe(false);
    expect(late.putBack).toBeNull();
    expect(late.tooOld).toMatchObject({
      slide: { slideIndex: 2 },
      blackout: true,
      savedAt: new Date(savedAt).toISOString(),
    });
    expect(RECOVERY_MAX_AGE_MS).toBe(3 * HOUR);
  });

  it('saves the show again every minute while it runs, so a slide up for hours still comes back after a crash', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10, aliveMs: 20, now });
    writer.start(live());
    await pause(40);
    // Four hours on the same slide, then a crash.
    clock += 4 * HOUR;
    await pause(60);
    writer.stop();
    await writer.settle();
    expect(JSON.parse(readFileSync(files.state, 'utf8'))).toMatchObject({ savedAt: now().toISOString() });
    clock += 5 * 60_000;
    expect(startFinds().putBack).toMatchObject({ slide: { slideIndex: 2 } });
  });

  it('a clean quit saves the show as it is, under this run, before its mark: even straight after the start', () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10, now });
    // Quit before the start's own save has landed (it waits 10 ms): the quit saves it.
    writer.start(live());
    writer.markClean();
    const savedNow = JSON.parse(readFileSync(files.state, 'utf8')) as { session: string; version: number };
    const mark = JSON.parse(readFileSync(files.cleanMark, 'utf8')) as { session: string };
    expect(savedNow).toMatchObject({ version: 2, session: writer.session });
    expect(mark.session).toBe(writer.session);
    expect(readdirSync(dir).sort()).toEqual(['live-state.clean', 'live-state.json']);
  });

  it('cannot put back a show whose time it cannot read', async () => {
    const first = await begin();
    await saved(first, live());
    first.stop();
    const raw = JSON.parse(readFileSync(files.state, 'utf8')) as Record<string, unknown>;
    writeFileSync(files.state, JSON.stringify({ ...raw, savedAt: 'not a time' }));
    expect(startFinds()).toMatchObject({
      cleanQuit: false,
      recentStop: false,
      putBack: null,
      tooOld: { slide: { slideIndex: 2 } },
    });
  });

  /*
   * Session 21: the starting mode uses the same 3-hour answer as putting the show back. Before, a crash in
   * Simple Mode made the next start open in Simple Mode however long ago it was, though nothing came back.
   */
  describe('the mode after an unexpected stop', () => {
    const cases = (['simple', 'pro'] as const).flatMap((wasIn) =>
      [false, true].map((showLive) => ({ wasIn, showLive })),
    );
    /** A run that stops dead, with a show live or not; returns when it last saved (the stop). */
    async function crashed(showLive: boolean): Promise<number> {
      const run = await begin();
      if (showLive) await saved(run, live({ blackout: true }));
      run.stop();
      await run.settle();
      return clock;
    }

    it.each(cases)(
      'just under 3 hours later: the mode it was in ($wasIn; a show live: $showLive)',
      async ({ wasIn, showLive }) => {
        const stoppedAt = await crashed(showLive);
        const found = startupRecovery(files, { now: new Date(stoppedAt + RECOVERY_MAX_AGE_MS - 1) });
        expect(found).toMatchObject({ cleanQuit: false, recentStop: true, tooOld: null });
        expect(found.putBack !== null).toBe(showLive);
        expect(startingMode({ recentStop: found.recentStop, wasIn })).toBe(wasIn);
      },
    );

    it.each(cases)(
      '3 hours or more later: as after a clean quit, Pro Mode ($wasIn; a show live: $showLive)',
      async ({ wasIn, showLive }) => {
        const stoppedAt = await crashed(showLive);
        for (const after of [RECOVERY_MAX_AGE_MS, RECOVERY_MAX_AGE_MS + 1, 3 * 24 * HOUR]) {
          const found = startupRecovery(files, { now: new Date(stoppedAt + after) });
          expect(found).toMatchObject({ cleanQuit: false, recentStop: false, putBack: null });
          expect(found.tooOld !== null).toBe(showLive);
          expect(startingMode({ recentStop: found.recentStop, wasIn })).toBe('pro');
        }
      },
    );

    it('a stop whose time cannot be read starts like a clean quit', async () => {
      await crashed(false);
      const raw = JSON.parse(readFileSync(files.state, 'utf8')) as Record<string, unknown>;
      writeFileSync(files.state, JSON.stringify({ ...raw, savedAt: 'not a time' }));
      const found = startFinds();
      expect(found).toEqual({ cleanQuit: false, recentStop: false, putBack: null, tooOld: null });
      expect(startingMode({ recentStop: found.recentStop, wasIn: 'simple' })).toBe('pro');
    });
  });

  describe('with files saved before Session 20', () => {
    /** A show saved by that Drashti (version 1), and a clean-quit mark written `markAfterMs` after it. */
    function oldFiles(markSession: string, markAfterMs: number) {
      const show = { ...savedFrom(live({ blackout: true }), 'run-1', now()), version: 1 };
      writeFileSync(files.state, JSON.stringify(show));
      writeFileSync(files.cleanMark, JSON.stringify({ session: markSession }));
      const markAt = (clock + markAfterMs) / 1000;
      utimesSync(files.cleanMark, markAt, markAt);
    }

    it('a clean quit, then a run that changed nothing and quit (the files on the dev Mac): a clean start, nothing comes back', () => {
      oldFiles('run-2', 90_000);
      clock += 60 * 60_000;
      expect(startFinds()).toEqual(clean);
    });

    it('a crash after a clean quit before it: the show comes back, as it always did', () => {
      oldFiles('run-0', -60 * 60_000);
      clock += 60_000;
      expect(startFinds()).toMatchObject({
        cleanQuit: false,
        recentStop: true,
        putBack: { blackout: true, slide: { slideIndex: 2 } },
      });
    });

    it('the run that saved it quit cleanly: a clean start', () => {
      oldFiles('run-1', 1000);
      expect(startFinds()).toEqual(clean);
    });
  });
});
