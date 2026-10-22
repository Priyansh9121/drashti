import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import { parseEngineCommand } from '../../shared/engine/commands';
import { EngineMirror } from '../../shared/engine/mirror';
import type { MusicRun } from '../../shared/engine/state';
import type { MediaMarkers } from '../../shared/markers';
import { playbackPosition } from '../../shared/media';
import { REMOTE_COMMANDS } from '../../shared/network-api';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport } from './testing';

/*
 * Back 15 s, Forward 15 s and Last 10 s (Session 50) on the background video and the sound playing: a jump,
 * as to a marker (the layer's seek, which every screen, the audio player, the nodes and the stream play on
 * from), never past the file's start or end points. At the end, the end does what it always does: a looping
 * file goes round, a once-only one holds its end, an audio playlist goes on to its next track. Paused, the
 * track waits at its new point. Placeholder media ids only.
 */

/** Each placeholder file's length (ms), as the library has it once a window has played it. */
const LENGTHS: Record<string, number> = {
  video: 60_000,
  short: 8_000,
  clipped: 60_000,
  sound: 90_000,
  a: 60_000,
  b: 30_000,
  c: 45_000,
};

/** A file with start and end points (Session 14): it plays between 0:10 and 0:40. */
const MARKERS: Record<string, MediaMarkers> = {
  clipped: { startMs: 10_000, endMs: 40_000, markers: [] },
};

function setup() {
  let clock = 1_000_000;
  const jobs: { at: number; run: () => void; cancelled: boolean }[] = [];
  const transport = new RecordingTransport();
  const engine = new ShowEngine(makeSource(), transport, () => clock, undefined, {
    mediaLength: (id) => LENGTHS[id] ?? null,
    mediaMarkers: (id) => MARKERS[id] ?? null,
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
  return { engine, transport, elapse, now: () => clock };
}

const video = (mediaId: string, loop = false): EngineCommand => ({
  type: 'setBackground',
  background: { kind: 'media', mediaId, media: 'video', fit: 'fit', loop },
});

const sound = (mediaId: string, loop = false): EngineCommand => ({
  type: 'playAudio',
  audio: { id: `sound:${mediaId}`, title: 'Placeholder sound', mediaId, volume: 1, loop },
});

const skip = (layer: 'background' | 'audio', jump: 'back' | 'forward' | 'last'): EngineCommand => ({
  type: 'skip',
  layer,
  jump,
});

const music = (over: Partial<Omit<MusicRun, 'index'>> = {}): Omit<MusicRun, 'index'> => ({
  playlistId: 'pl',
  name: 'Placeholder music',
  tracks: [
    { mediaId: 'a', title: 'Track A' },
    { mediaId: 'b', title: 'Track B' },
    { mediaId: 'c', title: 'Track C' },
  ],
  loop: false,
  shuffle: false,
  ...over,
});

const background = (e: ShowEngine) => {
  const bg = e.current.layers.background;
  return bg?.kind === 'media' ? bg : null;
};
const audio = (e: ShowEngine) => e.current.layers.audio;

describe('Back 15 s, Forward 15 s and Last 10 s (Session 50)', () => {
  it('jump the background video: Back within the first 15 s to the start, else 15 s either way; Last 10 s', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(video('video'));
    elapse(10_000);
    expect(engine.dispatch(skip('background', 'back'))).toMatchObject({ ok: true, changed: true });
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 0 });
    elapse(30_000);
    engine.dispatch(skip('background', 'back'));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 15_000 });
    elapse(5000);
    engine.dispatch(skip('background', 'forward'));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 35_000 });
    engine.dispatch(skip('background', 'last'));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 50_000 });
    // The same file, start time and look: only where it plays from moved.
    expect(background(engine)).toMatchObject({ mediaId: 'video', startedAt: 1_000_000, durationMs: 60_000 });
  });

  it('go no further than the end: a video played once holds it, a looping one goes round from its start', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(video('video'));
    elapse(50_000);
    engine.dispatch(skip('background', 'forward'));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 60_000 });
    const held = background(engine);
    if (held) expect(playbackPosition(held, 60, now() + 5000)).toBe(60);
    // Already at its end: nothing more to do.
    expect(engine.dispatch(skip('background', 'forward'))).toMatchObject({ ok: true, changed: false });
    // Last 10 s on a file shorter than 10 s goes to the end too.
    engine.dispatch(video('short'));
    elapse(1000);
    engine.dispatch(skip('background', 'last'));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 8000 });
    // Looping, the end goes round: it plays on from its start.
    engine.dispatch(video('video', true));
    elapse(50_000);
    engine.dispatch(skip('background', 'forward'));
    const looped = background(engine);
    expect(looped?.seek).toEqual({ at: now(), toMs: 60_000 });
    if (looped) expect(playbackPosition(looped, 60, now() + 2000)).toBe(2);
  });

  it('keep between a file’s start and end points', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(video('clipped'));
    expect(background(engine)?.clip).toEqual({ startMs: 10_000, endMs: 40_000 });
    elapse(5000);
    engine.dispatch(skip('background', 'back'));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 10_000 });
    elapse(18_000);
    engine.dispatch(skip('background', 'forward'));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 40_000 });
    engine.dispatch(skip('background', 'last'));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 30_000 });
    engine.dispatch(skip('background', 'back'));
    expect(background(engine)?.seek).toEqual({ at: now(), toMs: 15_000 });
  });

  it('jump a single sound the same way: played once it ends at the end, looping it goes round', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(sound('sound'));
    elapse(20_000);
    engine.dispatch(skip('audio', 'back'));
    expect(audio(engine)?.seek).toEqual({ at: now(), toMs: 5000 });
    engine.dispatch(skip('audio', 'last'));
    expect(audio(engine)?.seek).toEqual({ at: now(), toMs: 80_000 });
    elapse(5000);
    engine.dispatch(skip('audio', 'forward'));
    expect(audio(engine)).toMatchObject({ mediaId: 'sound', seek: { at: now(), toMs: 90_000 } });
    engine.dispatch(sound('b', true));
    elapse(20_000);
    engine.dispatch(skip('audio', 'forward'));
    const looped = audio(engine);
    expect(looped?.seek).toEqual({ at: now(), toMs: 30_000 });
    if (looped) expect(playbackPosition(looped, 30, now() + 2000)).toBe(2);
  });

  it('take an audio playlist on to its next track at the end, as at any end; the last ends it unless it goes round', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch({ type: 'playMusic', music: music(), index: 0 });
    elapse(50_000);
    engine.dispatch(skip('audio', 'forward'));
    expect(audio(engine)).toMatchObject({ mediaId: 'b', startedAt: now() });
    expect(audio(engine)?.seek).toBeUndefined();
    // Last 10 s of track B: ten seconds later, C starts where B ended.
    engine.dispatch(skip('audio', 'last'));
    expect(audio(engine)?.seek).toEqual({ at: now(), toMs: 20_000 });
    elapse(9_900);
    expect(audio(engine)?.mediaId).toBe('b');
    elapse(100);
    expect(audio(engine)).toMatchObject({ mediaId: 'c', startedAt: now() });
    // The last track: Forward within its last 15 s ends the music.
    elapse(35_000);
    engine.dispatch(skip('audio', 'forward'));
    expect(audio(engine)).toBeNull();
    // Going round, the last track's end goes on to the first; Last 10 s within the last 10 s goes back to them.
    engine.dispatch({ type: 'playMusic', music: music({ loop: true }), index: 2 });
    elapse(40_000);
    engine.dispatch(skip('audio', 'last'));
    expect(audio(engine)).toMatchObject({ mediaId: 'c', seek: { at: now(), toMs: 35_000 } });
    engine.dispatch(skip('audio', 'forward'));
    expect(audio(engine)).toMatchObject({ mediaId: 'a', startedAt: now() });
  });

  it('move a paused track where playing will start: at its end the next waits at its start, the last at its end', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch({ type: 'playMusic', music: music(), index: 0 });
    elapse(20_000);
    engine.dispatch({ type: 'pauseMusic' });
    engine.dispatch(skip('audio', 'back'));
    expect(audio(engine)).toMatchObject({ mediaId: 'a', pausedAtMs: 5000 });
    expect(audio(engine)?.seek).toBeUndefined();
    engine.dispatch(skip('audio', 'back'));
    expect(audio(engine)?.pausedAtMs).toBe(0);
    engine.dispatch(skip('audio', 'last'));
    expect(audio(engine)?.pausedAtMs).toBe(50_000);
    engine.dispatch(skip('audio', 'forward'));
    expect(audio(engine)).toMatchObject({ mediaId: 'b', pausedAtMs: 0 });
    // Paused, it waits however long, and plays from its new point.
    elapse(5 * 60_000);
    expect(audio(engine)).toMatchObject({ mediaId: 'b', pausedAtMs: 0 });
    engine.dispatch(skip('audio', 'forward'));
    engine.dispatch({ type: 'resumeMusic' });
    expect(audio(engine)).toMatchObject({ mediaId: 'b', startedAt: now() - 15_000 });
    expect(audio(engine)?.pausedAtMs).toBeUndefined();
    // The last track, paused: its end waits there (it can still come back); Play then ends the music.
    engine.dispatch({ type: 'musicNext' });
    engine.dispatch({ type: 'pauseMusic' });
    engine.dispatch(skip('audio', 'last'));
    expect(audio(engine)).toMatchObject({ mediaId: 'c', pausedAtMs: 35_000 });
    engine.dispatch(skip('audio', 'forward'));
    expect(audio(engine)).toMatchObject({ mediaId: 'c', pausedAtMs: 45_000 });
    engine.dispatch(skip('audio', 'back'));
    expect(audio(engine)?.pausedAtMs).toBe(30_000);
    engine.dispatch(skip('audio', 'forward'));
    engine.dispatch({ type: 'resumeMusic' });
    expect(audio(engine)).toBeNull();
  });

  it('land in step: the jump is in the change every window gets, and a window following it plays from there', () => {
    const { engine, transport, elapse, now } = setup();
    const mirror = new EngineMirror();
    expect(mirror.apply(engine.snapshot())).toBe('applied');
    engine.dispatch(video('video'));
    engine.dispatch(sound('sound'));
    elapse(30_000);
    engine.dispatch(skip('background', 'forward'));
    engine.dispatch(skip('audio', 'back'));
    // As a window gets them (IPC clones them), in order.
    for (const message of transport.messages)
      mirror.apply(JSON.parse(JSON.stringify(message)) as typeof message);
    expect(mirror.rev).toBe(engine.rev);
    expect(mirror.state?.layers).toEqual(engine.current.layers);
    const bg = mirror.state?.layers.background;
    const heard = mirror.state?.layers.audio;
    if (bg?.kind !== 'media' || !heard) throw new Error('nothing playing in the window');
    // Every screen and the audio player work out where it is from the same clock (playbackPosition).
    expect(playbackPosition(bg, 60, now() + 1000)).toBe(46);
    expect(playbackPosition(heard, 90, now() + 1000)).toBe(16);
  });

  it('are no change to the slides: Back still undoes the last Next, the files playing on from where they jumped', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(video('video'));
    engine.dispatch(sound('sound'));
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    engine.dispatch({ type: 'next' });
    elapse(20_000);
    engine.dispatch(skip('background', 'back'));
    engine.dispatch(skip('audio', 'forward'));
    const at = now();
    elapse(1000);
    engine.dispatch({ type: 'back' });
    expect(engine.current.layers.slide?.slideIndex).toBe(0);
    expect(background(engine)?.seek).toEqual({ at, toMs: 5000 });
    expect(audio(engine)?.seek).toEqual({ at, toMs: 35_000 });
    // Clear all and Put it back: back where they would be by now, from the jump.
    engine.dispatch({ type: 'clearAll' });
    expect(engine.dispatch({ type: 'putBack' })).toMatchObject({ ok: true });
    expect(background(engine)?.seek).toEqual({ at, toMs: 5000 });
    expect(audio(engine)?.seek).toEqual({ at, toMs: 35_000 });
  });

  it('say so when nothing is playing there, and wait until the file’s length is known', () => {
    const { engine } = setup();
    expect(engine.dispatch(skip('background', 'back'))).toMatchObject({
      ok: false,
      error: 'nothing-playing',
    });
    expect(engine.dispatch(skip('audio', 'forward'))).toMatchObject({ ok: false, error: 'nothing-playing' });
    engine.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: 'picture', media: 'image', fit: 'fit', loop: false },
    });
    expect(engine.dispatch(skip('background', 'last'))).toMatchObject({
      ok: false,
      error: 'nothing-playing',
    });
    // A file no window has said the length of yet: nothing moves.
    engine.dispatch(video('new'));
    const before = engine.rev;
    expect(engine.dispatch(skip('background', 'last'))).toMatchObject({ ok: false, error: 'no-length' });
    expect(engine.dispatch(skip('background', 'back'))).toMatchObject({ ok: false, error: 'no-length' });
    expect(engine.rev).toBe(before);
    // Once a window says how long it is, it jumps.
    engine.learnLength('new', 20_000);
    expect(engine.dispatch(skip('background', 'last'))).toMatchObject({ ok: true, changed: true });
    expect(background(engine)?.seek?.toMs).toBe(10_000);
  });

  it('come from the operator window only: a phone remote cannot send them, and only these three exist', () => {
    expect(REMOTE_COMMANDS as readonly string[]).not.toContain('skip');
    expect(parseEngineCommand({ type: 'skip', layer: 'audio', jump: 'last' }).ok).toBe(true);
    expect(parseEngineCommand({ type: 'skip', layer: 'audio', jump: 'next' }).ok).toBe(false);
    expect(parseEngineCommand({ type: 'skip', layer: 'slide', jump: 'back' }).ok).toBe(false);
  });
});
