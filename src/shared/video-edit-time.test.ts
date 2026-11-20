import { describe, expect, it } from 'vitest';
import { PLAIN_VIDEO_EDIT } from './video-edit';
import { videoEditTimes } from './video-edit-time';

describe('source times at an immutable prepared showing', () => {
  const recipe = { ...PLAIN_VIDEO_EDIT, trim: { startMs: 2000, endMs: 8000 }, speed: 2 };
  it('maps row trims, seeks and markers once without modifying their source records', () => {
    const source = {
      startMs: 4000,
      endMs: 7000,
      markers: [
        { id: 'kept', name: 'Placeholder', atMs: 5000 },
        { id: 'outside', name: 'Before', atMs: 1000 },
      ],
    };
    const before = structuredClone(source);
    const t = videoEditTimes(recipe, 10000);
    expect(t.durationMs).toBe(3000);
    expect(t.markers(source)).toEqual({
      startMs: 1000,
      endMs: 2500,
      markers: [{ id: 'kept', name: 'Placeholder', atMs: 1500 }],
    });
    expect(t.seek({ at: 123, toMs: 6000, paused: true })).toEqual({ at: 123, toMs: 2000, paused: true });
    expect(source).toEqual(before);
  });
  it('clips caption intervals to the prepared file and preserves text and identities', () => {
    const track = {
      id: 'captions',
      language: 'und',
      automatic: false,
      name: 'Placeholder',
      cues: [
        { startMs: 1000, endMs: 3000, text: 'Placeholder A' },
        { startMs: 6000, endMs: 9000, text: 'Placeholder B' },
      ],
    };
    expect(videoEditTimes(recipe, 10000).captions(track).cues).toEqual([
      { startMs: 0, endMs: 500, text: 'Placeholder A' },
      { startMs: 2000, endMs: 3000, text: 'Placeholder B' },
    ]);
  });
  it('refuses a row cut wholly outside the edited interval', () => {
    expect(() => videoEditTimes(recipe, 10000).clip({ startMs: 9000, endMs: 9500 })).toThrow('outside');
  });
});
