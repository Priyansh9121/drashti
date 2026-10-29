import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import { parseEngineCommand } from '../../shared/engine/commands';
import { simpleModeRefuses } from '../../shared/mode';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';

/*
 * Session 55, Part 4. Oops (the owner's idea B): one key and a button put back what was on the screens before the
 * last change, step by step, at least the last 10; a video put back carries on where it would be by now, as Put it
 * back's does. Only the operator's own changes are steps (a slide moving on by itself, a file's length learned or an
 * audio playlist's next track are not), and an Oops is never a step of its own. And a click on a playlist's video row
 * (the engine's playItem): a finished video starts again from its start point, a playing one carries on, a paused one
 * stays paused; a finished sound starts again too. Placeholder names and media ids only.
 */

/** Each placeholder file's length (ms), as the library has it once a window has played it. */
const LENGTHS: Record<string, number> = { clip: 10_000, long: 60_000, tone: 8_000 };

function setup() {
  const source = makeSource();
  source.set('words', [textSlide('w1', 'Placeholder one'), textSlide('w2', 'Placeholder two')]);
  // Moves on by itself every 4 seconds.
  source.set(
    'timed',
    [textSlide('t1', 'Timed one'), textSlide('t2', 'Timed two'), textSlide('t3', 'Timed three')],
    [],
    {
      autoAdvance: [4000, 4000, 4000],
      loop: false,
    },
  );
  for (let i = 0; i < 14; i++)
    source.set(`many${String(i)}`, [textSlide(`m${String(i)}`, `Placeholder ${i}`)]);
  const playlists = new MemoryPlaylistSource();
  playlists.set('pl', [
    { id: 'i-words', kind: 'presentation', presentationId: 'words', arrangementId: undefined },
    { id: 'i-clip', kind: 'media', mediaId: 'clip', media: 'video', label: 'Placeholder clip' },
    { id: 'i-long', kind: 'media', mediaId: 'long', media: 'video', label: 'Placeholder long' },
    { id: 'i-pic', kind: 'media', mediaId: 'pic', media: 'image', label: 'Placeholder picture' },
    { id: 'i-tone', kind: 'media', mediaId: 'tone', media: 'audio', label: 'Placeholder tone' },
  ]);
  let clock = 1_000_000;
  const jobs: { at: number; run: () => void; cancelled: boolean }[] = [];
  const engine = new ShowEngine(source, new RecordingTransport(), () => clock, playlists, {
    mediaLength: (id) => LENGTHS[id] ?? null,
    mediaKind: (id) => (id === 'pic' ? 'image' : id === 'tone' ? 'audio' : 'video'),
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

const playItem = (itemId: string): EngineCommand => ({ type: 'playItem', playlistId: 'pl', itemId });
const oops: EngineCommand = { type: 'oops' } as unknown as EngineCommand;

const background = (e: ShowEngine) => {
  const bg = e.current.layers.background;
  return bg?.kind === 'media' ? bg : null;
};
const words = (e: ShowEngine) => {
  const el = e.current.layers.slide?.slide.elements[0];
  return el?.kind === 'text' ? el.text : null;
};
const canOops = (e: ShowEngine) => e.current.canOops ?? false;
/** How many changes Oops takes back from here: pressed until it has none left (the engine is used up). */
const stepsLeft = (e: ShowEngine): number => {
  let n = 0;
  while (e.dispatch(oops).ok) n++;
  return n;
};

describe('a click on a playlist’s video or sound row (playItem)', () => {
  it('starts a finished video again from its start point; one still playing carries on; a paused one stays paused', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(playItem('i-clip'));
    const first = background(engine)?.startedAt;
    expect(first).toBe(now());

    // Still playing: a click changes nothing about it.
    elapse(4_000);
    engine.dispatch(playItem('i-clip'));
    expect(background(engine)?.startedAt).toBe(first);
    expect(background(engine)?.seek).toBeUndefined();

    // Played to its end (10 s, not looping): a click starts it again, from now, from its start point.
    elapse(7_000);
    expect(engine.dispatch(playItem('i-clip'))).toMatchObject({ ok: true, changed: true });
    expect(background(engine)?.startedAt).toBe(now());
    expect(background(engine)?.seek).toBeUndefined();

    // Paused part-way: a click leaves it paused where it is.
    elapse(2_000);
    engine.dispatch({ type: 'pausePlaying', playing: { layer: 'background' } });
    const paused = background(engine);
    expect(paused?.seek?.paused).toBe(true);
    elapse(30_000);
    engine.dispatch(playItem('i-clip'));
    expect(background(engine)?.seek).toEqual(paused?.seek);
    expect(background(engine)?.startedAt).toBe(paused?.startedAt);
  });

  it('starts a finished sound again too, and never one still playing', () => {
    const { engine, elapse, now } = setup();
    engine.dispatch(playItem('i-tone'));
    const first = engine.current.layers.audio?.startedAt;
    elapse(3_000);
    engine.dispatch(playItem('i-tone'));
    expect(engine.current.layers.audio?.startedAt).toBe(first);
    elapse(6_000);
    engine.dispatch(playItem('i-tone'));
    expect(engine.current.layers.audio?.startedAt).toBe(now());
  });
});

describe('Oops: what was on the screens before the last change, step by step', () => {
  it('is a command a window may send, and Simple Mode never refuses it', () => {
    expect(parseEngineCommand({ type: 'oops' }).ok).toBe(true);
    expect(simpleModeRefuses(oops, null)).toBe(false);
  });

  it('puts back the slide, the background and the sound as they were, a video carrying on where it would be', () => {
    const { engine, elapse } = setup();
    expect(engine.dispatch(oops)).toMatchObject({ ok: false, error: 'nothing-to-put-back' });
    engine.dispatch(playItem('i-long'));
    const video = background(engine);
    elapse(5_000);
    // By mistake: the picture goes up in the video's place.
    engine.dispatch(playItem('i-pic'));
    expect(background(engine)?.mediaId).toBe('pic');
    expect(canOops(engine)).toBe(true);
    expect(engine.dispatch(oops)).toMatchObject({ ok: true, changed: true });
    // The video is back, from when it first went up: it carries on where it would be now.
    expect(background(engine)?.mediaId).toBe('long');
    expect(background(engine)?.startedAt).toBe(video?.startedAt);
    expect(engine.current.live.playlist).toEqual({ playlistId: 'pl', itemId: 'i-long' });
    expect(canOops(engine)).toBe(true);
    // Once more: nothing was up before it.
    engine.dispatch(oops);
    expect(engine.current.layers.background).toBeNull();
    expect(engine.current.live.playlist).toBeNull();
    expect(canOops(engine)).toBe(false);
    expect(engine.dispatch(oops)).toMatchObject({ ok: false, error: 'nothing-to-put-back' });
  });

  it('goes back at least 10 steps, one at a time, and a slide put back is the slide that was up', () => {
    const { engine } = setup();
    for (let i = 0; i < 14; i++)
      engine.dispatch({ type: 'goLive', presentationId: `many${String(i)}`, slideIndex: 0 });
    expect(words(engine)).toBe('Placeholder 13');
    for (let i = 12; i >= 3; i--) {
      engine.dispatch(oops);
      expect(words(engine)).toBe(`Placeholder ${String(i)}`);
    }
    // Ten taken back, and the rest still there: the first four slides' changes.
    expect(stepsLeft(engine)).toBe(4);
    expect(engine.current.layers.slide).toBeNull();
  });

  it('keeps the last 20 changes at most', () => {
    const { engine } = setup();
    for (let i = 0; i < 25; i++)
      engine.dispatch({ type: 'goLive', presentationId: `many${String(i % 14)}`, slideIndex: 0 });
    expect(stepsLeft(engine)).toBe(20);
  });

  it('takes back Clear all and a Next, and is no step of its own; a change after it starts again from there', () => {
    const { engine } = setup();
    engine.dispatch(playItem('i-words'));
    engine.dispatch({ type: 'next' });
    expect(words(engine)).toBe('Placeholder two');
    engine.dispatch({ type: 'clearAll' });
    expect(engine.current.layers.slide).toBeNull();
    engine.dispatch(oops);
    expect(words(engine)).toBe('Placeholder two');
    engine.dispatch(oops);
    expect(words(engine)).toBe('Placeholder one');
    // A new change: Oops takes that back first.
    engine.dispatch({ type: 'clearLayer', layer: 'slide' });
    engine.dispatch(oops);
    expect(words(engine)).toBe('Placeholder one');
  });

  it('a slide moving on by itself is no step: Oops takes back the operator’s own last change', () => {
    const { engine, elapse } = setup();
    engine.dispatch(playItem('i-pic'));
    engine.dispatch({ type: 'goLive', presentationId: 'timed', slideIndex: 0 });
    elapse(4_000);
    elapse(4_000);
    expect(words(engine)).toBe('Timed three');
    // Back to before the timed slides went up: the picture alone; then nothing.
    engine.dispatch(oops);
    expect(engine.current.layers.slide).toBeNull();
    expect(background(engine)?.mediaId).toBe('pic');
    expect(stepsLeft(engine)).toBe(1);
  });
});
