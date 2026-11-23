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
}));
vi.mock('../audio/sounds', () => ({
  soundsOf: () => h.sounds,
  soundMoved: () => false,
  videoSoundGain: () => 1,
}));
vi.mock('../render/playback', () => ({
  startPlayback: (el: { dataset: Record<string, string> }, options: { ease?: () => unknown }) => {
    h.started.push({ key: el.dataset['key'] ?? '', options });
    return Object.assign(() => undefined, { resync: () => undefined });
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
});

it('the stream’s own sounds ease by speed exactly while they carry their crossfade envelope (QA22-FADE-1)', async () => {
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
  const video = (id: string, startedAt: number) => ({
    kind: 'media' as const,
    media: 'video' as const,
    mediaId: id,
    startedAt,
    loop: true,
    fit: 'fit' as const,
  });
  const fade = {
    id: 'generated cue',
    from: video('generated red', 1000),
    at: Date.now() + 120,
    durationMs: 2000,
  } as unknown as VideoCrossfade;
  const own = (id: string, startedAt: number, envelope?: Sound['envelope']): Sound => ({
    key: `background:${id}@${String(startedAt)}`,
    mediaId: id,
    startedAt,
    loop: true,
    volume: 1,
    kind: 'video',
    ...(envelope ? { envelope } : {}),
  });
  const outgoing = own('generated red', 1000, { fade, role: 'out' });
  const incoming = own('generated blue', 2000, { fade, role: 'in' });
  const music = own('generated music', 500);
  h.sounds = [outgoing, incoming, music];
  sound.setOwnSound(true, show);
  const ease = (key: string) => {
    const started = h.started.find((s) => s.key === key);
    if (!started) throw new Error(`${key} was not played`);
    expect(started.options.limits, `${key} plays with a sound's limits`).toBe(SOUND_LIMITS);
    return started.options.ease?.() ?? null;
  };
  expect(ease(outgoing.key), 'the outgoing sound, through its fade').toEqual(FADE_SOUND_LIMITS);
  expect(ease(incoming.key), 'the incoming sound, through its fade').toEqual(FADE_SOUND_LIMITS);
  expect(ease(music.key), 'a sound in no fade: as before').toBeNull();
  // The fade over: the engine takes the pair away, and the incoming sound carries on without its envelope.
  h.sounds = [own('generated blue', 2000), music];
  sound.setOwnSound(true, show);
  expect(ease(incoming.key), 'the incoming sound after its fade: as before').toBeNull();
  expect(h.started, 'the same players carried on').toHaveLength(3);
});
