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
