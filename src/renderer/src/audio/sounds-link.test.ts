import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState } from '../../../shared/engine/state';
import { hallSoundsOf, soundsOf } from './sounds';

/*
 * A stream link's sound (alpha.20, the playback set's slice 8; the owner's Q60-39 P3 A): heard in the hall at the Video
 * level as a video's is, never in Drashti's own stream (someone else's webcast never goes out again: the stream's page
 * mixes soundsOf, the audio player hallSoundsOf).
 */

const ID = '00000000-0000-4000-8000-000000000001';

function withLink(patch: Partial<EngineState> = {}): EngineState {
  const s = initialEngineState();
  return {
    ...s,
    ...patch,
    layers: {
      ...s.layers,
      background: { kind: 'link', linkId: ID, name: 'media.example.org', startedAt: 4000 },
    },
  };
}

describe('a stream link’s sound', () => {
  it('plays in the hall at the Video level, one sound for the link whatever start its pages are on', () => {
    const link = hallSoundsOf(withLink()).filter((s) => s.link !== undefined);
    expect(link).toEqual([
      {
        key: `link:${ID}`,
        mediaId: `link:${ID}`,
        link: ID,
        startedAt: 4000,
        loop: false,
        volume: 1,
        kind: 'video',
      },
    ]);
    // Every page starting again together (a new start) keeps the same sound.
    const again = withLink();
    const bg = again.layers.background;
    if (bg?.kind !== 'link') throw new Error('a link expected');
    const later = { ...again, layers: { ...again.layers, background: { ...bg, startedAt: 9000 } } };
    expect(hallSoundsOf(later).find((s) => s.link !== undefined)?.key).toBe(`link:${ID}`);
  });

  it('is never in Drashti’s own stream’s mix, and none at all once Drashti has stopped', () => {
    expect(soundsOf(withLink()).some((s) => s.key.startsWith('link:'))).toBe(false);
    expect(hallSoundsOf(withLink({ stopped: { at: 1 } }))).toEqual([]);
  });
});
