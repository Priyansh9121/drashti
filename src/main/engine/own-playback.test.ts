import { describe, expect, it } from 'vitest';
import type { VideoCaptionsShown } from '../../shared/video-captions';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport } from './testing';

/*
 * Sound and picture… (alpha.20) in the engine: the tone and the sound's delay of each file sounding now are stamped
 * into the sound state, as the even gains are; a file with neither has none; a caption delay changed is a change of
 * the captions shown. Placeholder ids only.
 */

const CAPTIONS: VideoCaptionsShown = {
  track: {
    id: 't',
    language: 'en',
    label: 'Placeholder',
    cues: [{ startMs: 0, endMs: 1000, text: 'Placeholder' }],
  },
  size: 'medium',
  place: 'bottom',
} as unknown as VideoCaptionsShown;

function setup() {
  const own: Record<
    string,
    { tone: { bassDb: number; trebleDb: number; voice: boolean } | null; soundDelayMs: number }
  > = {};
  const captionDelays: Record<string, number> = {};
  const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => 1_000_000, undefined, {
    mediaLength: () => 60_000,
    mediaKind: () => 'video',
    playbackOf: (id) => own[id] ?? null,
    videoCaptionsOf: (id) =>
      id === 'v' ? { ...CAPTIONS, ...(captionDelays[id] ? { delayMs: captionDelays[id] } : {}) } : null,
  });
  return { engine, own, captionDelays };
}

describe('a file’s own tone and delays in the engine', () => {
  it('stamps the tone and the sound’s delay of the files sounding now, and none for a file with neither', () => {
    const { engine, own } = setup();
    own['v'] = { tone: { bassDb: 6, trebleDb: 0, voice: true }, soundDelayMs: 200 };
    own['s'] = { tone: null, soundDelayMs: 0 };
    engine.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: 'v', media: 'video', fit: 'fit', loop: false },
    });
    engine.dispatch({
      type: 'playAudio',
      audio: { id: 'sound:s', title: 'Placeholder', mediaId: 's', volume: 1, loop: false },
    });
    expect(engine.current.sound).toMatchObject({
      tones: { v: { bassDb: 6, trebleDb: 0, voice: true } },
      delays: { v: 200 },
    });
    expect(engine.current.sound?.tones).not.toHaveProperty('s');
    // Changed in the library while it plays: stamped again on refresh.
    own['v'] = { tone: null, soundDelayMs: 0 };
    expect(engine.refreshSound()).toMatchObject({ ok: true, changed: true });
    expect(engine.current.sound).not.toHaveProperty('tones');
    expect(engine.current.sound).not.toHaveProperty('delays');
  });

  it('a caption delay changed is a change of the captions shown', () => {
    const { engine, captionDelays } = setup();
    engine.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: 'v', media: 'video', fit: 'fit', loop: false },
    });
    expect(engine.current.videoCaptions?.['v']).not.toHaveProperty('delayMs');
    captionDelays['v'] = 500;
    expect(engine.refreshVideoCaptions()).toMatchObject({ ok: true, changed: true });
    expect(engine.current.videoCaptions?.['v']?.delayMs).toBe(500);
  });
});
