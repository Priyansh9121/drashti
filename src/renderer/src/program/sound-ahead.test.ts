import { expect, it } from 'vitest';
import { keepSoundAhead, STREAM_SOUND_AHEAD_S } from './sound-ahead';

it('keeps a second of decoded sound ahead, more than the longest hold of the page’s media thread seen (0.5 s)', () => {
  expect(STREAM_SOUND_AHEAD_S).toBeGreaterThanOrEqual(1);
  const element = { tagName: 'AUDIO', latencyHint: Number.NaN } as unknown as HTMLMediaElement & {
    latencyHint: number;
  };
  expect(keepSoundAhead(element)).toBe(true);
  expect(element.latencyHint).toBe(STREAM_SOUND_AHEAD_S);
});

it('says so where the browser cannot be asked, rather than claiming the sound is kept ahead', () => {
  const element = { tagName: 'AUDIO' } as unknown as HTMLMediaElement;
  expect(keepSoundAhead(element)).toBe(false);
  expect('latencyHint' in element).toBe(false);
});
