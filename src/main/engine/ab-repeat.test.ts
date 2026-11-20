import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import type { PlayingRef } from '../../shared/engine/playing';
import type { MusicRun } from '../../shared/engine/state';
import type { MediaMarkers } from '../../shared/markers';
import { playbackAtMs } from '../../shared/media';
import { simpleModeRefuses } from '../../shared/mode';
import { savedFrom } from '../recovery/live-state';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';

/*
 * The time bar's ⋯ in the engine (alpha.20: the owner's Q60-34 items, his "Yes, all A" to Q60-39 P4 A and P6 (i) A).
 * A-B repeat: the background video or the sound (an audio playlist's track too) goes round from A to B, sent to A at
 * once, its own points and loop kept aside (a change to its points while it repeats waits there) until Stop, which
 * plays on from where it is; B before A swapped, kept between its own points, under half a second refused in words;
 * never a change Back or Put it back undo, and a crash's restart plays the file on as its own. One frame back or on
 * while paused: the middle of the frame before or after, between its points; never while it plays, never a sound.
 * Simple Mode refuses both but lets a repeat be stopped. Placeholder media ids only.
 */

const LENGTHS: Record<string, number> = {
  video: 60_000,
  clipped: 60_000,
  sound: 90_000,
  a: 60_000,
  b: 30_000,
};

const MARKERS: Record<string, MediaMarkers> = {
  clipped: { startMs: 10_000, endMs: 40_000, markers: [] },
};

function setup() {
  const lengths: Record<string, number> = { ...LENGTHS };
  const markers: Record<string, MediaMarkers> = { ...MARKERS };
  const source = makeSource();
  source.set('words', [textSlide('w1', 'Placeholder one'), textSlide('w2', 'Placeholder two')]);
  let clock = 1_000_000;
  const jobs: { at: number; run: () => void; cancelled: boolean }[] = [];
  const engine = new ShowEngine(source, new RecordingTransport(), () => clock, undefined, {
    mediaLength: (id) => lengths[id] ?? null,
    mediaMarkers: (id) => markers[id] ?? null,
    mediaKind: () => 'video',
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
  return { engine, elapse, now: () => clock, markers };
}

const BACKGROUND: PlayingRef = { layer: 'background' };
const AUDIO: PlayingRef = { layer: 'audio' };

const repeat = (playing: PlayingRef, fromMs: number, toMs: number): EngineCommand => ({
  type: 'repeatAb',
  playing,
  fromMs,
  toMs,
});
const stop = (playing: PlayingRef): EngineCommand => ({ type: 'stopAb', playing });
const step = (playing: PlayingRef, by: 1 | -1, frameMs: number): EngineCommand => ({
  type: 'stepFrame',
  playing,
  by,
  frameMs,
});
const setVideo = (mediaId: string): EngineCommand => ({
  type: 'setBackground',
  background: { kind: 'media', mediaId, media: 'video', fit: 'fit', loop: false },
});
const playSound = (mediaId: string): EngineCommand => ({
  type: 'playAudio',
  audio: { id: `sound:${mediaId}`, title: 'Placeholder sound', mediaId, volume: 1, loop: false },
});
const music: Omit<MusicRun, 'index'> = {
  playlistId: 'pl',
  name: 'Placeholder music',
  tracks: [
    { mediaId: 'a', title: 'Track A' },
    { mediaId: 'b', title: 'Track B' },
  ],
  loop: false,
  shuffle: false,
};

const background = (e: ShowEngine) => {
  const bg = e.current.layers.background;
  return bg?.kind === 'media' ? bg : null;
};

describe('A-B repeat (alpha.20, the time bar’s ⋯)', () => {
  it('goes round between A and B, sent to A at once, its own loop kept aside; Stop puts it back and plays on from where it is', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(setVideo('video'));
    elapse(5000);
    expect(engine.dispatch(repeat(BACKGROUND, 10_000, 20_000))).toMatchObject({ ok: true, changed: true });
    expect(background(engine)).toMatchObject({
      clip: { startMs: 10_000, endMs: 20_000 },
      loop: true,
      seek: { at: now(), toMs: 10_000 },
      ab: { loop: false },
    });
    expect(background(engine)?.ab).not.toHaveProperty('clip');
    // 25 s on, going round a 10 s span: 5 s past A, and never past B.
    elapse(25_000);
    const bg = background(engine);
    expect(bg ? playbackAtMs(bg, 60_000, now()) : null).toBe(15_000);
    expect(engine.dispatch(stop(BACKGROUND))).toMatchObject({ ok: true, changed: true });
    const after = background(engine);
    expect(after).toMatchObject({ loop: false, seek: { at: now(), toMs: 15_000 } });
    expect(after).not.toHaveProperty('clip');
    expect(after).not.toHaveProperty('ab');
    expect(engine.dispatch(stop(BACKGROUND))).toMatchObject({
      ok: false,
      error: 'not-repeating',
      message: 'It is not repeating A-B: there is nothing to stop.',
    });
  });

  it('keeps a file’s own points aside: B before A swapped, kept between them, half a second at the least; a second A-B within them too', () => {
    const { engine } = setup();
    engine.dispatch(setVideo('clipped'));
    expect(engine.dispatch(repeat(BACKGROUND, 35_000, 5000))).toMatchObject({ ok: true });
    expect(background(engine)).toMatchObject({
      clip: { startMs: 10_000, endMs: 35_000 },
      ab: { clip: { startMs: 10_000, endMs: 40_000 }, loop: false },
    });
    expect(engine.dispatch(repeat(BACKGROUND, 20_000, 20_400))).toEqual({
      ok: false,
      error: 'invalid-command',
      message: 'A and B are too close together: choose them at least half a second apart.',
    });
    // Another A-B while it repeats: within the file's own points, which stay aside.
    expect(engine.dispatch(repeat(BACKGROUND, 38_000, 50_000))).toMatchObject({ ok: true });
    expect(background(engine)).toMatchObject({
      clip: { startMs: 38_000, endMs: 40_000 },
      ab: { clip: { startMs: 10_000, endMs: 40_000 }, loop: false },
    });
    engine.dispatch(stop(BACKGROUND));
    expect(background(engine)).toMatchObject({ clip: { startMs: 10_000, endMs: 40_000 }, loop: false });
  });

  it('waits at A when paused, and Play plays on from A', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(setVideo('video'));
    elapse(1000);
    engine.dispatch({ type: 'pausePlaying', playing: BACKGROUND });
    engine.dispatch(repeat(BACKGROUND, 10_000, 12_000));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 10_000, paused: true });
    elapse(3000);
    engine.dispatch({ type: 'resumePlaying', playing: BACKGROUND });
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 10_000 });
  });

  it('a library change to its points while it repeats waits aside for Stop; its markers show at once', () => {
    const { engine, markers } = setup();
    engine.dispatch(setVideo('video'));
    engine.dispatch(repeat(BACKGROUND, 10_000, 20_000));
    const marks = [{ id: 'm1', name: 'Placeholder verse', atMs: 15_000 }];
    markers['video'] = { startMs: 5000, endMs: 50_000, markers: marks };
    expect(engine.refreshMarkers('video')).toMatchObject({ ok: true, changed: true });
    expect(background(engine)).toMatchObject({
      clip: { startMs: 10_000, endMs: 20_000 },
      marks,
      ab: { clip: { startMs: 5000, endMs: 50_000 }, loop: false },
    });
    engine.dispatch(stop(BACKGROUND));
    expect(background(engine)).toMatchObject({ clip: { startMs: 5000, endMs: 50_000 }, loop: false });
  });

  it('is not a change to the show: Back and Put it back keep it, as they keep a jump', () => {
    const { engine } = setup();
    engine.dispatch(setVideo('video'));
    engine.dispatch({ type: 'goLive', presentationId: 'words', slideIndex: 0 });
    engine.dispatch({ type: 'next' });
    engine.dispatch(repeat(BACKGROUND, 10_000, 20_000));
    expect(engine.dispatch({ type: 'back' })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.layers.slide?.slideIndex).toBe(0);
    expect(background(engine)).toMatchObject({
      clip: { startMs: 10_000, endMs: 20_000 },
      loop: true,
      ab: { loop: false },
    });
    engine.dispatch({ type: 'clearAll' });
    expect(engine.dispatch({ type: 'putBack' })).toMatchObject({ ok: true, changed: true });
    expect(background(engine)).toMatchObject({ clip: { startMs: 10_000, endMs: 20_000 }, loop: true });
  });

  it('the sound goes round too, and an audio playlist’s track never moves on by itself while it does; Music’s Pause waits at A', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(playSound('sound'));
    elapse(1000);
    expect(engine.dispatch(repeat(AUDIO, 30_000, 40_000))).toMatchObject({ ok: true });
    expect(engine.current.layers.audio).toMatchObject({
      clip: { startMs: 30_000, endMs: 40_000 },
      loop: true,
      seek: { at: now(), toMs: 30_000 },
    });
    engine.dispatch({ type: 'playMusic', music, index: 0 });
    elapse(2000);
    expect(engine.dispatch(repeat(AUDIO, 10_000, 20_000))).toMatchObject({ ok: true });
    // Well past its own end (60 s): still track A, going round.
    elapse(90_000);
    expect(engine.current.layers.audio).toMatchObject({ mediaId: 'a', music: { index: 0 } });
    engine.dispatch(stop(AUDIO));
    expect(engine.current.layers.audio?.loop).toBe(false);
    // At its end now, as ever: on to track B.
    engine.dispatch({ type: 'moveTo', playing: AUDIO, toMs: 59_000 });
    elapse(1500);
    expect(engine.current.layers.audio).toMatchObject({ mediaId: 'b' });
    // Music's Pause, then A-B: it waits at A, with no jump.
    engine.dispatch({ type: 'pauseMusic' });
    engine.dispatch(repeat(AUDIO, 5000, 8000));
    expect(engine.current.layers.audio).toMatchObject({
      mediaId: 'b',
      pausedAtMs: 0,
      clip: { startMs: 5000 },
    });
    expect(engine.current.layers.audio).not.toHaveProperty('seek');
  });

  it('is for the background video and the sound only', () => {
    const { engine } = setup();
    expect(engine.dispatch(repeat({ layer: 'slide', mediaId: 'video' }, 0, 5000))).toMatchObject({
      ok: false,
    });
    expect(engine.dispatch(repeat(BACKGROUND, 0, 5000))).toMatchObject({
      ok: false,
      error: 'nothing-playing',
    });
  });

  it('a crash’s restart plays the file on as its own: it is saved without the repeat', () => {
    const { engine } = setup();
    engine.dispatch(setVideo('video'));
    engine.dispatch(repeat(BACKGROUND, 10_000, 20_000));
    const saved = savedFrom(engine.current, 'placeholder-run', new Date('2026-11-20T12:00:00Z'));
    expect(saved.background).toMatchObject({ mediaId: 'video', loop: false });
    expect(saved.background).not.toHaveProperty('ab');
  });

  it('Simple Mode refuses A-B and frame steps, as its window has no ⋯, but lets a repeat be stopped', () => {
    expect(simpleModeRefuses(repeat(BACKGROUND, 0, 5000), null)).toBe(true);
    expect(simpleModeRefuses(step(BACKGROUND, 1, 40), null)).toBe(true);
    expect(simpleModeRefuses(stop(BACKGROUND), null)).toBe(false);
  });
});

describe('one frame back or on (alpha.20, the time bar’s ⋯ and Alt with the arrows)', () => {
  it('while paused, to the middle of the frame after or before, at 25 and at 60 a second, kept between its points', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(setVideo('video'));
    elapse(1000);
    expect(engine.dispatch(step(BACKGROUND, 1, 40))).toEqual({
      ok: false,
      error: 'invalid-command',
      message: 'Pause it first: a frame is stepped while it waits.',
    });
    engine.dispatch({ type: 'pausePlaying', playing: BACKGROUND });
    engine.dispatch({ type: 'moveTo', playing: BACKGROUND, toMs: 1000 });
    // 25 a second: frame 25 is 1000-1040 ms; the next one's middle is 1060.
    expect(engine.dispatch(step(BACKGROUND, 1, 40))).toMatchObject({ ok: true, changed: true });
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 1060, paused: true });
    engine.dispatch(step(BACKGROUND, 1, 40));
    expect(background(engine)?.seek?.toMs).toBe(1100);
    engine.dispatch(step(BACKGROUND, -1, 40));
    expect(background(engine)?.seek?.toMs).toBe(1060);
    // 60 a second, from 1 s: frame 60, then the middle of frame 61.
    engine.dispatch({ type: 'moveTo', playing: BACKGROUND, toMs: 1000 });
    engine.dispatch(step(BACKGROUND, 1, 1000 / 60));
    expect(background(engine)?.seek?.toMs).toBe(1025);
    // Never before its start.
    engine.dispatch({ type: 'moveTo', playing: BACKGROUND, toMs: 0 });
    engine.dispatch(step(BACKGROUND, -1, 40));
    expect(background(engine)?.seek?.toMs).toBe(0);
  });

  it('is for a video: a sound is refused in words', () => {
    const { engine, elapse } = setup();
    engine.dispatch(playSound('sound'));
    elapse(1000);
    engine.dispatch({ type: 'pausePlaying', playing: AUDIO });
    expect(engine.dispatch(step(AUDIO, 1, 40))).toEqual({
      ok: false,
      error: 'invalid-command',
      message: 'One frame back and on are for a video: use them on a video that is playing.',
    });
  });
});
