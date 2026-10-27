import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import { parseEngineCommand } from '../../shared/engine/commands';
import { EngineMirror } from '../../shared/engine/mirror';
import type { EnginePatchMessage } from '../../shared/engine/protocol';
import type { PlayingRef } from '../../shared/engine/playing';
import type { MusicRun, PipLayer, PropItem } from '../../shared/engine/state';
import type { MediaMarkers } from '../../shared/markers';
import { playbackAtMs } from '../../shared/media';
import type { MediaElement, RenderSlide } from '../../shared/model';
import { SIMPLE_MODE_REFUSED_COMMANDS } from '../../shared/mode';
import { DEFAULT_PIP_PLACE } from '../../shared/pip';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';

/*
 * The time bar (Session 54): one "move to" for each kind that plays (the background video, the sound, an audio
 * playlist's track, and a video on the slide up, a prop, the logo or in the picture-in-picture box), kept between
 * its file's start and end points; Pause, which holds it where it is on every screen alike, and Play, which plays it
 * on from there. Each is a jump, as to a marker, which every screen, node, key and fill, the stream and the audio
 * player land on in step; none is a change Back or Put it back undo; and each comes back after an unexpected restart
 * where it would be by now. Placeholder media ids only.
 */

/** Each placeholder file's length (ms), as the library has it once a window has played it. */
const LENGTHS: Record<string, number> = {
  video: 60_000,
  clipped: 60_000,
  sound: 90_000,
  a: 60_000,
  b: 30_000,
  boxed: 20_000,
};

/** The library's points and markers (Session 14): 'clipped' plays between 0:10 and 0:40. */
const MARKERS: Record<string, MediaMarkers> = {
  clipped: {
    startMs: 10_000,
    endMs: 40_000,
    markers: [{ id: 'm1', name: 'Placeholder chorus', atMs: 20_000 }],
  },
};

const videoEl = (id: string, mediaId: string, loop = false): MediaElement => ({
  id,
  kind: 'video',
  mediaId,
  frame: { x: 0, y: 0, width: 640, height: 360 },
  fit: 'fit',
  loop,
});

/** A slide with these videos under its words. */
function slideWith(id: string, ...media: MediaElement[]): RenderSlide {
  const words = textSlide(id, 'Placeholder words');
  return { ...words, elements: [...media, ...words.elements] };
}

const prop = (id: string, mediaId: string, loop = true): PropItem => ({
  id,
  name: `Placeholder ${id}`,
  elements: [videoEl(`${id}-video`, mediaId, loop)],
});

const music = (over: Partial<Omit<MusicRun, 'index'>> = {}): Omit<MusicRun, 'index'> => ({
  playlistId: 'pl',
  name: 'Placeholder music',
  tracks: [
    { mediaId: 'a', title: 'Track A' },
    { mediaId: 'b', title: 'Track B' },
  ],
  loop: false,
  shuffle: false,
  ...over,
});

function setup() {
  const lengths: Record<string, number> = { ...LENGTHS };
  const markers: Record<string, MediaMarkers> = { ...MARKERS };
  const source = makeSource();
  source.set('videos', [
    slideWith('v1', videoEl('v1-a', 'clipped', true), videoEl('v1-b', 'video')),
    textSlide('v2', 'Placeholder words alone'),
    slideWith('v3', videoEl('v3-a', 'video')),
  ]);
  let clock = 1_000_000;
  const jobs: { at: number; run: () => void; cancelled: boolean }[] = [];
  const transport = new RecordingTransport();
  const engine = new ShowEngine(source, transport, () => clock, undefined, {
    mediaLength: (id) => lengths[id] ?? null,
    mediaMarkers: (id) => markers[id] ?? null,
    mediaKind: (id) => (id === 'still' ? 'image' : 'video'),
    schedule: (delay, run) => {
      const job = { at: clock + delay, run, cancelled: false };
      jobs.push(job);
      return () => {
        job.cancelled = true;
      };
    },
  });
  const elapse = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      const next = jobs.filter((j) => !j.cancelled && j.at <= end).sort((x, y) => x.at - y.at)[0];
      if (!next) break;
      jobs.splice(jobs.indexOf(next), 1);
      clock = Math.max(clock, next.at);
      next.run();
    }
    clock = end;
  };
  return { engine, transport, elapse, now: () => clock, lengths, markers, source };
}

const moveTo = (playing: PlayingRef, toMs: number): EngineCommand => ({ type: 'moveTo', playing, toMs });
const pause = (playing: PlayingRef): EngineCommand => ({ type: 'pausePlaying', playing });
const play = (playing: PlayingRef): EngineCommand => ({ type: 'resumePlaying', playing });

const BACKGROUND: PlayingRef = { layer: 'background' };
const AUDIO: PlayingRef = { layer: 'audio' };
const BOX: PlayingRef = { layer: 'pip' };
const onSlide = (mediaId: string): PlayingRef => ({ layer: 'slide', mediaId });

const setVideo = (mediaId: string, loop = false): EngineCommand => ({
  type: 'setBackground',
  background: { kind: 'media', mediaId, media: 'video', fit: 'fit', loop },
});
const playSound = (mediaId: string): EngineCommand => ({
  type: 'playAudio',
  audio: { id: `sound:${mediaId}`, title: 'Placeholder sound', mediaId, volume: 1, loop: false },
});
const goLive = (slideIndex: number): EngineCommand => ({
  type: 'goLive',
  presentationId: 'videos',
  slideIndex,
});

const background = (e: ShowEngine) => {
  const bg = e.current.layers.background;
  return bg?.kind === 'media' ? bg : null;
};

describe('the time bar’s move (Session 54)', () => {
  it('moves the background video and the sound there, in step everywhere, never past the file’s start or end points', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(setVideo('video'));
    elapse(5000);
    expect(engine.dispatch(moveTo(BACKGROUND, 30_000))).toMatchObject({ ok: true, changed: true });
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 30_000 });
    // Past its end: its end, where a file played once holds.
    engine.dispatch(moveTo(BACKGROUND, 99_000));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 60_000 });
    // Between its points: the start point, at the least, and the end point, at the most.
    engine.dispatch(setVideo('clipped'));
    engine.dispatch(moveTo(BACKGROUND, 2000));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 10_000 });
    engine.dispatch(moveTo(BACKGROUND, 50_000));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 40_000 });
    // A single sound the same way.
    engine.dispatch(playSound('sound'));
    elapse(1000);
    engine.dispatch(moveTo(AUDIO, 45_000));
    expect(engine.current.layers.audio).toMatchObject({
      mediaId: 'sound',
      seek: { at: now(), toMs: 45_000 },
    });
  });

  it('moves a video on the slide up, a prop’s, the logo’s and the box’s, each by its file: until now only the background and the sound had moves', () => {
    const { engine, now } = setup();
    engine.dispatch(goLive(0));
    expect(engine.dispatch(moveTo(onSlide('video'), 12_000))).toMatchObject({ ok: true, changed: true });
    // Kept between its file's points: 'clipped' plays from 0:10 to 0:40.
    engine.dispatch(moveTo(onSlide('clipped'), 45_000));
    expect(engine.current.layers.slide?.seeks).toEqual({
      video: { at: now(), toMs: 12_000 },
      clipped: { at: now(), toMs: 40_000 },
    });
    expect(engine.current.layers.slide?.shownAt).toBe(1_000_000);
    engine.dispatch({ type: 'showProp', prop: prop('pr', 'video') });
    engine.dispatch(moveTo({ layer: 'props', propId: 'pr', mediaId: 'video' }, 7000));
    expect(engine.current.layers.props[0]?.seeks).toEqual({ video: { at: now(), toMs: 7000 } });
    engine.dispatch({ type: 'showLogo', prop: prop('logo', 'clipped') });
    engine.dispatch(moveTo({ layer: 'logo', mediaId: 'clipped' }, 0));
    expect(engine.current.logo?.seeks).toEqual({ clipped: { at: now(), toMs: 10_000 } });
    engine.dispatch({ type: 'showPip', source: { kind: 'media', mediaId: 'boxed' } });
    const shown = engine.current.layers.pip?.shownAt;
    engine.dispatch(moveTo(BOX, 15_000));
    expect(engine.current.layers.pip).toMatchObject({
      shownAt: shown,
      seeks: { boxed: { at: now(), toMs: 15_000 } },
    });
  });

  it('refuses what is not playing, and a file whose length is not known yet', () => {
    const { engine, lengths } = setup();
    // Never played on this computer: its length is not known yet.
    delete lengths['video'];
    for (const ref of [
      BACKGROUND,
      AUDIO,
      BOX,
      onSlide('video'),
      { layer: 'logo', mediaId: 'video' } as const,
    ])
      expect(engine.dispatch(moveTo(ref, 1000))).toMatchObject({ ok: false, error: 'nothing-playing' });
    // A picture has no time.
    engine.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: 'still', media: 'image', fit: 'fit', loop: false },
    });
    expect(engine.dispatch(moveTo(BACKGROUND, 1000))).toMatchObject({ ok: false, error: 'nothing-playing' });
    // Not on the slide up.
    engine.dispatch(goLive(0));
    expect(engine.dispatch(moveTo(onSlide('boxed'), 1000))).toMatchObject({
      ok: false,
      error: 'nothing-playing',
    });
    // No length yet (a moment after it starts, a screen says): nothing to keep to.
    engine.dispatch(setVideo('video'));
    expect(engine.dispatch(moveTo(BACKGROUND, 1000))).toMatchObject({ ok: false, error: 'no-length' });
    expect(engine.dispatch(moveTo(onSlide('video'), 1000))).toMatchObject({ ok: false, error: 'no-length' });
    engine.learnLength('video', 60_000);
    expect(engine.dispatch(moveTo(BACKGROUND, 1000))).toMatchObject({ ok: true, changed: true });
    expect(engine.dispatch(moveTo(onSlide('video'), 1000))).toMatchObject({ ok: true, changed: true });
  });

  it('takes an audio playlist’s track on to the next at its end, as Forward 15 s does; paused, it waits there', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch({ type: 'playMusic', music: music(), index: 0 });
    elapse(2000);
    engine.dispatch(moveTo(AUDIO, 30_000));
    expect(engine.current.layers.audio).toMatchObject({ mediaId: 'a', seek: { at: now(), toMs: 30_000 } });
    engine.dispatch(moveTo(AUDIO, 60_000));
    expect(engine.current.layers.audio).toMatchObject({ mediaId: 'b', startedAt: now() });
    // Paused, as Music's Pause does: a move waits where it puts it.
    engine.dispatch(pause(AUDIO));
    expect(engine.current.layers.audio?.pausedAtMs).toBe(0);
    engine.dispatch(moveTo(AUDIO, 12_000));
    expect(engine.current.layers.audio).toMatchObject({ mediaId: 'b', pausedAtMs: 12_000 });
    elapse(5000);
    engine.dispatch(play(AUDIO));
    expect(engine.current.layers.audio).toMatchObject({ mediaId: 'b', startedAt: now() - 12_000 });
    expect(engine.current.layers.audio?.pausedAtMs).toBeUndefined();
  });

  it('parses: what plays named by its layer (and its file and prop), the point as whole ms; Simple Mode refuses the move', () => {
    expect(
      parseEngineCommand({ type: 'moveTo', playing: { layer: 'slide', mediaId: 'video' }, toMs: 1500 }).ok,
    ).toBe(true);
    expect(parseEngineCommand({ type: 'moveTo', playing: { layer: 'slide' }, toMs: 1500 }).ok).toBe(false);
    expect(parseEngineCommand({ type: 'moveTo', playing: { layer: 'pip' }, toMs: -1 }).ok).toBe(false);
    expect(parseEngineCommand({ type: 'pausePlaying', playing: { layer: 'messages' } }).ok).toBe(false);
    expect(
      parseEngineCommand({ type: 'resumePlaying', playing: { layer: 'props', propId: 'p', mediaId: 'v' } })
        .ok,
    ).toBe(true);
    expect(SIMPLE_MODE_REFUSED_COMMANDS).toContain('moveTo');
    expect(SIMPLE_MODE_REFUSED_COMMANDS).not.toContain('pausePlaying');
    expect(SIMPLE_MODE_REFUSED_COMMANDS).not.toContain('resumePlaying');
  });
});

describe('the time bar’s Pause and Play (Session 54)', () => {
  it('holds what plays where it is, every screen alike, and plays it on from there', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(setVideo('video'));
    elapse(8000);
    expect(engine.dispatch(pause(BACKGROUND))).toMatchObject({ ok: true, changed: true });
    const at = now();
    expect(background(engine)?.seek).toEqual({ at, toMs: 8000, paused: true });
    // Paused: it waits there, whatever the time.
    elapse(20_000);
    const held = background(engine);
    if (held) expect(playbackAtMs(held, 60_000, now())).toBe(8000);
    expect(engine.dispatch(pause(BACKGROUND))).toMatchObject({ ok: true, changed: false });
    // A move while paused waits where it puts it.
    engine.dispatch(moveTo(BACKGROUND, 15_000));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 15_000, paused: true });
    // Play: on from there.
    elapse(1000);
    expect(engine.dispatch(play(BACKGROUND))).toMatchObject({ ok: true, changed: true });
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 15_000 });
    expect(engine.dispatch(play(BACKGROUND))).toMatchObject({ ok: true, changed: false });
    elapse(3000);
    const playing = background(engine);
    if (playing) expect(playbackAtMs(playing, 60_000, now())).toBe(18_000);
  });

  it('pauses a video on the slide, a prop’s, the logo’s and the box’s, each by its file, and a single sound; a looping one where it is this time round', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(goLive(0));
    // 'clipped' loops between 0:10 and 0:40: 35 s after it went up it is 5 s into its second time round.
    elapse(35_000);
    engine.dispatch(pause(onSlide('clipped')));
    expect(engine.current.layers.slide?.seeks).toEqual({
      clipped: { at: now(), toMs: 15_000, paused: true },
    });
    engine.dispatch(play(onSlide('clipped')));
    expect(engine.current.layers.slide?.seeks).toEqual({ clipped: { at: now(), toMs: 15_000 } });
    engine.dispatch({ type: 'showProp', prop: prop('pr', 'video') });
    engine.dispatch({ type: 'showLogo', prop: prop('logo', 'video') });
    engine.dispatch({ type: 'showPip', source: { kind: 'media', mediaId: 'boxed' } });
    engine.dispatch(playSound('sound'));
    elapse(4000);
    for (const ref of [
      { layer: 'props', propId: 'pr', mediaId: 'video' },
      { layer: 'logo', mediaId: 'video' },
      BOX,
      AUDIO,
    ] as const)
      expect(engine.dispatch(pause(ref)), ref.layer).toMatchObject({ ok: true, changed: true });
    expect(engine.current.layers.props[0]?.seeks).toEqual({ video: { at: now(), toMs: 4000, paused: true } });
    expect(engine.current.logo?.seeks).toEqual({ video: { at: now(), toMs: 4000, paused: true } });
    expect(engine.current.layers.pip?.seeks).toEqual({ boxed: { at: now(), toMs: 4000, paused: true } });
    expect(engine.current.layers.audio?.seek).toEqual({ at: now(), toMs: 4000, paused: true });
  });

  it('plays a file held at its end again from its start point', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(setVideo('clipped'));
    elapse(45_000);
    // Played once, it holds at its end point: Pause has nothing to hold, Play starts it again.
    expect(engine.dispatch(play(BACKGROUND))).toMatchObject({ ok: true, changed: true });
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 10_000 });
    engine.dispatch(moveTo(BACKGROUND, 40_000));
    engine.dispatch(pause(BACKGROUND));
    engine.dispatch(play(BACKGROUND));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 10_000 });
  });

  it('pauses and plays an audio playlist’s track as Music’s buttons do', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch({ type: 'playMusic', music: music(), index: 0 });
    elapse(6000);
    engine.dispatch(pause(AUDIO));
    expect(engine.current.layers.audio).toMatchObject({ mediaId: 'a', pausedAtMs: 6000 });
    expect(engine.current.layers.audio?.seek).toBeUndefined();
    elapse(30_000);
    engine.dispatch(play(AUDIO));
    expect(engine.current.layers.audio).toMatchObject({ mediaId: 'a', startedAt: now() - 6000 });
  });

  it('keeps a pause through Back 15 s and a slide naming the same file; a marker plays it from there', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(setVideo('clipped'));
    elapse(20_000);
    engine.dispatch(pause(BACKGROUND));
    engine.dispatch({ type: 'skip', layer: 'background', jump: 'back' });
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 15_000, paused: true });
    // The same file again carries on as it is: still paused.
    engine.dispatch(setVideo('clipped'));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 15_000, paused: true });
    // A marker is a jump to play from.
    engine.dispatch({ type: 'jumpToMarker', layer: 'background', markerId: 'm1' });
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 20_000 });
  });
});

describe('the time bar in the show (Session 54)', () => {
  it('reaches every screen and node: a copy kept from the engine’s snapshot and patches has the moves, the pauses and the lengths and markers', () => {
    const { engine, transport, elapse } = setup();
    const mirror = new EngineMirror();
    expect(mirror.apply(engine.snapshot())).toBe('applied');
    let seen = 0;
    const follow = () => {
      for (; seen < transport.messages.length; seen++) {
        const wire = JSON.parse(JSON.stringify(transport.messages[seen])) as EnginePatchMessage;
        expect(mirror.apply(wire)).toBe('applied');
      }
      expect(mirror.state).toEqual(engine.current);
    };
    engine.dispatch(goLive(0));
    engine.dispatch({ type: 'showPip', source: { kind: 'media', mediaId: 'boxed' } });
    follow();
    // The slide's and the box's videos' lengths and markers, for the bar on LIVE and a phone.
    expect(mirror.state?.videoFiles).toEqual({
      clipped: { durationMs: 60_000, marks: [{ id: 'm1', name: 'Placeholder chorus', atMs: 20_000 }] },
      video: { durationMs: 60_000 },
      boxed: { durationMs: 20_000 },
    });
    elapse(1000);
    engine.dispatch(moveTo(onSlide('video'), 30_000));
    engine.dispatch(pause(BOX));
    follow();
    expect(mirror.state?.layers.slide?.seeks?.['video']?.toMs).toBe(30_000);
    expect(mirror.state?.layers.pip?.seeks?.['boxed']?.paused).toBe(true);
    // Nothing of them up: none.
    engine.dispatch({ type: 'clearAll' });
    follow();
    expect(mirror.state?.videoFiles ?? null).toBeNull();
  });

  it('learns a length a screen tells, and markers saved while it plays', () => {
    const { engine, lengths, markers } = setup();
    delete lengths['video'];
    engine.dispatch(goLive(2));
    expect(engine.current.videoFiles ?? null).toBeNull();
    expect(engine.learnLength('video', 61_000)).toMatchObject({ ok: true, changed: true });
    expect(engine.current.videoFiles).toEqual({ video: { durationMs: 61_000 } });
    markers['video'] = {
      startMs: null,
      endMs: null,
      markers: [{ id: 'm2', name: 'Placeholder verse', atMs: 5000 }],
    };
    expect(engine.refreshMarkers('video')).toMatchObject({ ok: true, changed: true });
    expect(engine.current.videoFiles).toEqual({
      video: { durationMs: 61_000, marks: [{ id: 'm2', name: 'Placeholder verse', atMs: 5000 }] },
    });
  });

  it('is not a change to the show: Back still undoes the Next, keeping what plays where the bar left it', () => {
    const { engine, now } = setup();
    engine.dispatch({ type: 'showPip', source: { kind: 'media', mediaId: 'boxed' } });
    engine.dispatch({ type: 'showProp', prop: prop('pr', 'video') });
    engine.dispatch(setVideo('video'));
    engine.dispatch(goLive(0));
    engine.dispatch({ type: 'next' });
    engine.dispatch(moveTo(BOX, 5000));
    engine.dispatch(pause({ layer: 'props', propId: 'pr', mediaId: 'video' }));
    engine.dispatch(moveTo(BACKGROUND, 9000));
    expect(engine.dispatch({ type: 'back' })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.layers.slide?.slideIndex).toBe(0);
    expect(engine.current.layers.pip?.seeks).toEqual({ boxed: { at: now(), toMs: 5000 } });
    expect(engine.current.layers.props[0]?.seeks).toEqual({ video: { at: now(), toMs: 0, paused: true } });
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 9000 });
  });

  it('keeps the slide’s moves when the slide up is edited, and drops them with the next slide', () => {
    const { engine, now, source } = setup();
    engine.dispatch(goLive(0));
    engine.dispatch(pause(onSlide('video')));
    // Its words edited while it is up: new content, its videos carrying on as they were.
    const edited = slideWith('v1', videoEl('v1-a', 'clipped', true), videoEl('v1-b', 'video'));
    source.set('videos', [
      {
        ...edited,
        elements: edited.elements.map((e) => (e.kind === 'text' ? { ...e, text: 'Placeholder edit' } : e)),
      },
      textSlide('v2', 'Placeholder words alone'),
    ]);
    engine.refreshLive('videos');
    expect(
      engine.current.layers.slide?.slide.elements.some(
        (e) => e.kind === 'text' && e.text === 'Placeholder edit',
      ),
    ).toBe(true);
    expect(engine.current.layers.slide?.seeks).toEqual({ video: { at: now(), toMs: 0, paused: true } });
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide).not.toHaveProperty('seeks');
  });

  it('comes back after an unexpected stop where it would be by now: moved on from its move, paused where it waited', () => {
    const { engine, now } = setup();
    const box: PipLayer = {
      source: { kind: 'media', mediaId: 'boxed', media: 'video' },
      place: DEFAULT_PIP_PLACE,
      swapped: false,
      shownAt: 900_000,
      seeks: { boxed: { at: 950_000, toMs: 3000, paused: true } },
    };
    const put = engine.restore({
      slide: {
        presentationId: 'videos',
        slideIndex: 0,
        shownAt: 900_000,
        seeks: { video: { at: 990_000, toMs: 20_000 } },
      },
      background: {
        kind: 'media',
        mediaId: 'clipped',
        media: 'video',
        fit: 'fit',
        loop: false,
        startedAt: 800_000,
        seek: { at: 990_000, toMs: 25_000, paused: true },
      },
      blackout: false,
      props: [{ ...prop('pr', 'video'), shownAt: 950_000, seeks: { video: { at: 960_000, toMs: 1000 } } }],
      pip: box,
    });
    expect(put).toMatchObject({ slide: true, background: true, props: 1, pip: true });
    expect(engine.current.layers.slide?.seeks).toEqual({ video: { at: 990_000, toMs: 20_000 } });
    const slide = engine.current.layers.slide;
    if (slide)
      expect(
        playbackAtMs({ startedAt: slide.shownAt, loop: false, seek: slide.seeks?.['video'] }, 60_000, now()),
      ).toBe(30_000);
    const bg = background(engine);
    expect(bg?.seek).toEqual({ at: 990_000, toMs: 25_000, paused: true });
    if (bg) expect(playbackAtMs(bg, 60_000, now())).toBe(25_000);
    expect(engine.current.layers.props[0]?.seeks).toEqual({ video: { at: 960_000, toMs: 1000 } });
    expect(engine.current.layers.pip?.seeks).toEqual(box.seeks);
  });
});
