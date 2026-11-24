import { afterEach, expect, it, vi } from 'vitest';
import type { EngineState } from '../../../shared/engine/state';
import { FADE_SOUND_LIMITS, SOUND_LIMITS } from '../../../shared/media';
import type { VideoCrossfade } from '../../../shared/video-cue';
import type { Sound } from '../audio/sounds';

/*
 * QA22-FADE-1 (alpha.23, the owner: "Correct by speed"; "±8%, jump past 0.5 s"): the stream's own sound in a crossfade
 * is brought back by speed, not a jump. StreamSound asks its players to ease (render/playback.ts's `ease`) exactly while
 * a sound carries its crossfade envelope: from the crossfade's state until the engine takes the pair away at its end.
 */

const h = vi.hoisted(() => ({
  sounds: [] as Sound[],
  started: [] as {
    key: string;
    options: { limits?: unknown; ease?: () => unknown };
  }[],
  /** Each resync (a move the engine sent: a cue's Go), with what its player's ease said just then. */
  resyncs: [] as { key: string; ease: unknown }[],
}));
vi.mock('../audio/sounds', () => ({
  soundsOf: () => h.sounds,
  soundMoved: (was: Sound, now: Sound) => was.seek?.at !== now.seek?.at,
  videoSoundGain: () => 1,
}));
vi.mock('../render/playback', () => ({
  startPlayback: (el: { dataset: Record<string, string> }, options: { ease?: () => unknown }) => {
    const key = el.dataset['key'] ?? '';
    h.started.push({ key, options });
    return Object.assign(() => undefined, {
      resync: () => h.resyncs.push({ key, ease: options.ease?.() ?? null }),
    });
  },
}));
vi.mock('../audio/tone-chain', () => ({ toneThrough: () => null, bandsText: () => '' }));
vi.mock('../audio/video-envelope', () => ({ applyVideoEnvelope: () => undefined }));
vi.mock('../audio/cue-start-sounds', () => ({ retainCueSounds: () => null }));

/** A Web Audio context whose nodes only connect. */
class GeneratedContext extends EventTarget {
  state: AudioContextState = 'running';
  currentTime = 0;
  readonly destination = {};
  private node() {
    return { connect: (to: unknown) => to, disconnect: () => undefined };
  }
  createGain() {
    return { ...this.node(), gain: { value: 1, setTargetAtTime: () => undefined } };
  }
  createDelay() {
    return { ...this.node(), delayTime: { value: 0, setValueAtTime: () => undefined } };
  }
  createAnalyser() {
    return { ...this.node(), fftSize: 2048 };
  }
  createMediaStreamDestination() {
    return { ...this.node(), stream: { getAudioTracks: () => [] } };
  }
  createMediaElementSource() {
    return this.node();
  }
  createConstantSource() {
    return { ...this.node(), offset: { value: 0 }, start: () => undefined };
  }
  resume() {
    return Promise.resolve();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  h.sounds = [];
  h.started = [];
  h.resyncs = [];
});

it('the stream’s own sounds ease by speed exactly while they carry their crossfade envelope, through the cue’s Go (QA22-FADE-1)', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', GeneratedContext);
  vi.stubGlobal('document', {
    body: { dataset: {}, append: () => undefined },
    createElement: () => ({ dataset: {}, remove: () => undefined }),
  });
  const { StreamSound } = await import('./sound');
  const sound = new StreamSound();
  // Only what StreamSound reads beside its sounds (soundsOf is the test's): no audio layer, no cue.
  const show = { layers: {} } as unknown as EngineState;
  const fadeAt = Date.now() + 120;
  const fade = {
    id: 'generated cue',
    from: {
      kind: 'media',
      media: 'video',
      mediaId: 'generated red',
      startedAt: 1000,
      loop: true,
      fit: 'fit',
    },
    at: fadeAt,
    durationMs: 2000,
  } as unknown as VideoCrossfade;
  const own = (id: string, startedAt: number, more: Partial<Sound> = {}): Sound => ({
    key: `background:${id}@${String(startedAt)}`,
    mediaId: id,
    startedAt,
    loop: true,
    volume: 1,
    kind: 'video',
    ...more,
  });
  const ease = (key: string) => {
    const started = h.started.filter((s) => s.key === key);
    expect(started, `${key}: one player`).toHaveLength(1);
    expect(started[0]?.options.limits, `${key} plays with a sound's limits`).toBe(SOUND_LIMITS);
    return started[0]?.options.ease?.() ?? null;
  };
  // Before: the background plays, the next video's cue waits prepared (held at its first frame), music under them.
  const playing = own('generated red', 1000);
  const music = own('generated music', 500);
  const waiting = own('generated blue', 2000, {
    cueId: 'generated cue',
    prepared: true,
    seek: { at: Date.now(), toMs: 0, paused: true },
  });
  h.sounds = [playing, waiting, music];
  sound.setOwnSound(true, show);
  expect(h.started).toHaveLength(3);
  for (const s of [playing, waiting, music]) expect(ease(s.key), `${s.key} before the fade`).toBeNull();
  // The cue's Go starts the crossfade: both carry its envelope; the cue's own player goes on (same key, a22-review-x86
  // E2), sent to the fade's moment, and is already easing as that move reaches it (E1: the Go's resync).
  const { cueId: _cue, prepared: _prepared, ...started } = waiting;
  h.sounds = [
    own('generated red', 1000, { envelope: { fade, role: 'out' } }),
    { ...started, seek: { at: fadeAt, toMs: 0 }, envelope: { fade, role: 'in' } },
    music,
  ];
  sound.setOwnSound(true, show);
  expect(h.started, 'the same three players: none made afresh at Go').toHaveLength(3);
  expect(ease(playing.key), 'the outgoing sound, through its fade').toEqual(FADE_SOUND_LIMITS);
  expect(ease(waiting.key), 'the incoming sound, through its fade').toEqual(FADE_SOUND_LIMITS);
  expect(ease(music.key), 'a sound in no fade: as before').toBeNull();
  expect(h.resyncs, 'the Go reached the incoming player already easing').toEqual([
    { key: waiting.key, ease: FADE_SOUND_LIMITS },
  ]);
  // A player first made inside a fade (this page started again in it) is put in place as ever (E5).
  const fresh = own('generated green', 3000, { envelope: { fade, role: 'in' } });
  h.sounds = [...h.sounds, fresh];
  sound.setOwnSound(true, show);
  expect(ease(fresh.key), 'a player made inside a fade: as before').toBeNull();
  // The fade over: the engine takes the pair away, and the incoming sound carries on without its envelope.
  h.sounds = [{ ...started, seek: { at: fadeAt, toMs: 0 } }, music];
  sound.setOwnSound(true, show);
  expect(ease(waiting.key), 'the incoming sound after its fade: as before').toBeNull();
});

it('eases only inside a real crossfade: never for a manual Go’s 0 ms pair, nor once its fade is over (a22-review-fade M1)', async () => {
  // The engine also makes a 0 ms pair at every manual Go from a playing video (show-engine.ts goVideoCue), and a pair
  // stays on the sound page until its take-away gets there (up to ~0.6 s on CI's two-core Windows). Eased then, an
  // ordinary Go's late start lost its re-aim and stayed 0.05-0.17 s off for ~7 s; a real fade kept 8% past its end.
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', GeneratedContext);
  vi.stubGlobal('document', {
    body: { dataset: {}, append: () => undefined },
    createElement: () => ({ dataset: {}, remove: () => undefined }),
  });
  const { StreamSound } = await import('./sound');
  const sound = new StreamSound();
  const show = { layers: {} } as unknown as EngineState;
  const own = (id: string, startedAt: number, more: Partial<Sound> = {}): Sound => ({
    key: `background:${id}@${String(startedAt)}`,
    mediaId: id,
    startedAt,
    loop: true,
    volume: 1,
    kind: 'video',
    ...more,
  });
  const pair = (at: number, durationMs: number) =>
    ({
      id: `generated cue ${String(at)}`,
      from: { kind: 'media', media: 'video', mediaId: 'generated', startedAt: 1, loop: true, fit: 'fit' },
      at,
      durationMs,
    }) as unknown as VideoCrossfade;
  const ease = (key: string) => h.started.find((s) => s.key === key)?.options.ease?.() ?? null;
  const prepared = (id: string, startedAt: number) =>
    own(id, startedAt, {
      cueId: `cue ${id}`,
      prepared: true,
      seek: { at: Date.now(), toMs: 0, paused: true },
    });
  const started = (s: Sound, envelope: Sound['envelope'], at: number): Sound => {
    const { cueId: _cue, prepared: _prepared, ...rest } = s;
    return { ...rest, seek: { at, toMs: 0 }, ...(envelope ? { envelope } : {}) };
  };
  // A manual Go from a playing video: a 0 ms pair, still carried a moment after it.
  const red = own('generated red', 1000);
  const blue = prepared('generated blue', 2000);
  h.sounds = [red, blue];
  sound.setOwnSound(true, show);
  const go = pair(Date.now() + 120, 0);
  h.sounds = [
    own('generated red', 1000, { envelope: { fade: go, role: 'out' } }),
    started(blue, { fade: go, role: 'in' }, go.at),
  ];
  sound.setOwnSound(true, show);
  for (const ms of [0, 120, 400]) {
    vi.advanceTimersByTime(ms === 0 ? 0 : ms - (ms === 400 ? 120 : 0));
    expect(ease(red.key), `the outgoing sound at a manual Go, ${String(ms)} ms on`).toBeNull();
    expect(ease(blue.key), `the incoming sound at a manual Go, ${String(ms)} ms on`).toBeNull();
  }
  // A real 2 s crossfade: eased through it, and not once it is over, though its envelope is still carried.
  const green = own('generated green', 3000);
  const yellow = prepared('generated yellow', 4000);
  h.sounds = [green, yellow];
  sound.setOwnSound(true, show);
  const fade = pair(Date.now() + 120, 2000);
  h.sounds = [
    own('generated green', 3000, { envelope: { fade, role: 'out' } }),
    started(yellow, { fade, role: 'in' }, fade.at),
  ];
  sound.setOwnSound(true, show);
  vi.advanceTimersByTime(1120);
  expect(ease(green.key), 'the outgoing sound inside its fade').toEqual(FADE_SOUND_LIMITS);
  expect(ease(yellow.key), 'the incoming sound inside its fade').toEqual(FADE_SOUND_LIMITS);
  vi.advanceTimersByTime(1000);
  expect(ease(green.key), 'the outgoing sound after its fade’s end').toBeNull();
  expect(ease(yellow.key), 'the incoming sound after its fade’s end').toBeNull();
});
