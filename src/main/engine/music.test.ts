import { describe, expect, it } from 'vitest';
import type { MusicRun } from '../../shared/engine/state';
import { MUSIC_UNKNOWN_LENGTH_MS, ShowEngine } from './show-engine';
import { RecordingTransport, makeSource } from './testing';

/*
 * Audio playlists in the engine (Session 14): tracks one after another on
 * the audio layer, from each one's start and length (every window agrees);
 * pause and play on; next and previous; loop or stop at the end; and how
 * they meet a slide's sound, Clear audio, Put it back, Back and recovery.
 */

const LENGTHS: Record<string, number> = { a: 60_000, b: 30_000, c: 45_000 };

function setup() {
  let clock = 1_000_000;
  const jobs: { at: number; run: () => void; cancelled: boolean }[] = [];
  const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => clock, undefined, {
    mediaLength: (id) => LENGTHS[id] ?? null,
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
  return { engine, elapse, now: () => clock };
}

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

const playing = (e: ShowEngine) => e.current.layers.audio;

describe('audio playlists', () => {
  it('move on even when the timer comes a moment early (it waits again for what is left)', () => {
    let clock = 1_000_000;
    let early = 3;
    const jobs: { at: number; run: () => void; cancelled: boolean }[] = [];
    const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => clock, undefined, {
      mediaLength: (id) => LENGTHS[id] ?? null,
      // The first wait comes 3 ms early, as a timer can; later ones on time.
      schedule: (delay, run) => {
        const job = { at: clock + Math.max(0, delay - early), run, cancelled: false };
        early = 0;
        jobs.push(job);
        return () => {
          job.cancelled = true;
        };
      },
    });
    const start = clock;
    engine.dispatch({ type: 'playMusic', music: music(), index: 0 });
    const runDue = () => {
      for (const job of jobs.filter((j) => !j.cancelled && j.at <= clock)) {
        jobs.splice(jobs.indexOf(job), 1);
        job.run();
      }
    };
    clock = start + 60_000 - 3;
    runDue();
    expect(playing(engine)).toMatchObject({ mediaId: 'a' });
    // Nothing else happens; at the end it moves on all the same.
    clock = start + 60_000;
    runDue();
    expect(playing(engine)).toMatchObject({ mediaId: 'b', startedAt: start + 60_000 });
  });

  it('play their tracks one after another, each from where the last ended, and stop at the end', () => {
    const { engine, elapse, now } = setup();
    const start = now();
    engine.dispatch({ type: 'playMusic', music: music(), index: 0 });
    expect(playing(engine)).toMatchObject({
      mediaId: 'a',
      startedAt: start,
      durationMs: 60_000,
      loop: false,
    });
    elapse(60_000);
    expect(playing(engine)).toMatchObject({ mediaId: 'b', startedAt: start + 60_000 });
    elapse(30_000 + 45_000);
    expect(playing(engine)).toBeNull();
  });

  it('go round again when they loop; next and previous move through them', () => {
    const { engine, elapse } = setup();
    engine.dispatch({ type: 'playMusic', music: music({ loop: true }), index: 2 });
    elapse(45_000);
    expect(playing(engine)?.mediaId).toBe('a');
    engine.dispatch({ type: 'musicPrevious' });
    expect(playing(engine)?.mediaId).toBe('c');
    engine.dispatch({ type: 'musicNext' });
    engine.dispatch({ type: 'musicNext' });
    expect(playing(engine)?.mediaId).toBe('b');
    engine.dispatch({ type: 'setMusicLoop', loop: false });
    engine.dispatch({ type: 'musicNext' });
    engine.dispatch({ type: 'musicNext' });
    expect(playing(engine)).toBeNull();
  });

  it('pause where they are, and play on from there', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch({ type: 'playMusic', music: music(), index: 0 });
    elapse(20_000);
    engine.dispatch({ type: 'pauseMusic' });
    expect(playing(engine)?.pausedAtMs).toBe(20_000);
    // Paused, nothing moves on.
    elapse(5 * 60_000);
    expect(playing(engine)).toMatchObject({ mediaId: 'a', pausedAtMs: 20_000 });
    engine.dispatch({ type: 'resumeMusic' });
    expect(playing(engine)).toMatchObject({ mediaId: 'a', startedAt: now() - 20_000 });
    expect(playing(engine)?.pausedAtMs).toBeUndefined();
    elapse(40_000);
    expect(playing(engine)?.mediaId).toBe('b');
  });

  it('give way to a sound put up; Back after a track ended still undoes the last Next, the music going on', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    const start = now();
    engine.dispatch({ type: 'playMusic', music: music(), index: 0 });
    // A track ending is no change to the slides: Back can still undo a Next made before it.
    engine.dispatch({ type: 'next' });
    elapse(61_000);
    expect(playing(engine)?.mediaId).toBe('b');
    engine.dispatch({ type: 'back' });
    expect(engine.current.layers.slide?.slideIndex).toBe(0);
    expect(playing(engine)).toMatchObject({ mediaId: 'b', startedAt: start + 60_000 });
    // A sound put up takes the audio layer: the music stops.
    engine.dispatch({
      type: 'playAudio',
      audio: { id: 's', title: 'Cue', mediaId: 's', volume: 1, loop: false },
    });
    expect(playing(engine)?.mediaId).toBe('s');
  });

  it('stop with Clear audio; Put it back brings it back where it would be by now, tracks passed included', () => {
    const { engine, elapse, now } = setup();
    const start = now();
    engine.dispatch({ type: 'playMusic', music: music(), index: 0 });
    engine.dispatch({ type: 'clearAll' });
    expect(playing(engine)).toBeNull();
    elapse(70_000);
    engine.dispatch({ type: 'putBack' });
    // Seventy seconds on: track A (60 s) has ended, B started where it ended.
    expect(playing(engine)).toMatchObject({ mediaId: 'b', startedAt: start + 60_000 });
  });

  it('stay as they are through Back and Put it back while they play (they are independent of the slides)', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'playMusic', music: music(), index: 1 });
    expect(engine.current.canPutBack).toBe(false);
    engine.dispatch({ type: 'back' });
    expect(engine.current.layers.slide?.slideIndex).toBe(0);
    expect(playing(engine)?.mediaId).toBe('b');
  });

  it('pass a track no window can play after a while', () => {
    const { engine, elapse } = setup();
    engine.dispatch({
      type: 'playMusic',
      music: music({
        tracks: [
          { mediaId: 'broken', title: 'Cannot play' },
          { mediaId: 'a', title: 'A' },
        ],
      }),
      index: 0,
    });
    elapse(MUSIC_UNKNOWN_LENGTH_MS);
    expect(playing(engine)?.mediaId).toBe('a');
  });

  it('come back after a restart where they would be', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch({ type: 'playMusic', music: music(), index: 0 });
    const saved = playing(engine);
    const fresh = setup();
    fresh.elapse(0);
    if (saved)
      fresh.engine.restore({
        slide: null,
        background: null,
        blackout: false,
        audio: { ...saved, startedAt: fresh.now() - 65_000 },
      });
    expect(fresh.engine.current.layers.audio?.mediaId).toBe('b');
    expect(now()).toBeGreaterThan(0);
    elapse(0);
  });
});

describe('playback markers (Session 14)', () => {
  it('play a sound between its points, jump to a marker in step, and end a music track at its end point', () => {
    let clock = 1_000_000;
    const jobs: { at: number; run: () => void; cancelled: boolean }[] = [];
    const markers = {
      startMs: 10_000,
      endMs: 40_000,
      markers: [{ id: 'm1', name: 'Placeholder chorus', atMs: 30_000 }],
    };
    const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => clock, undefined, {
      mediaLength: (id) => LENGTHS[id] ?? null,
      mediaMarkers: (id) => (id === 'a' ? markers : null),
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
    engine.dispatch({ type: 'playMusic', music: music(), index: 0 });
    expect(playing(engine)).toMatchObject({
      mediaId: 'a',
      clip: { startMs: 10_000, endMs: 40_000 },
      marks: [{ name: 'Placeholder chorus' }],
    });
    // A jump: from then it plays on from the marker, and the track ends 10 s later (at its end point).
    elapse(5000);
    expect(engine.dispatch({ type: 'jumpToMarker', layer: 'audio', markerId: 'm1' }).ok).toBe(true);
    expect(playing(engine)?.seek).toEqual({ at: clock, toMs: 30_000 });
    elapse(9_900);
    expect(playing(engine)?.mediaId).toBe('a');
    elapse(200);
    expect(playing(engine)?.mediaId).toBe('b');
    expect(engine.dispatch({ type: 'jumpToMarker', layer: 'audio', markerId: 'gone' }).ok).toBe(false);
  });
});
