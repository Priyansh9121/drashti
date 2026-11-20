import { describe, expect, it } from 'vitest';
import { keepScene, storyFrame } from './video-analysis';
import type { MediaMarkers } from './markers';

describe('source-time video analysis', () => {
  it('selects a bounded cached frame at both ends and with invalid pointer input', () => {
    expect([0, 0.5, 1, -1, 2, Number.NaN].map(storyFrame)).toEqual([0, 10, 19, 0, 19, 0]);
  });
  it('keeps a suggested scene only in a new draft, retaining row trim points and named markers', () => {
    const row: MediaMarkers = {
      startMs: 120, endMs: 5000, markers: [{ id: 'own', name: 'Placeholder point', atMs: 900 }],
    };
    const kept = keepScene(row, 2500, 'suggestion');
    expect(kept).toEqual({ ...row, markers: [...row.markers, { id: 'suggestion', name: 'Scene 0:02.5', atMs: 2500 }] });
    expect(row.markers).toHaveLength(1);
    expect(keepScene(kept, 2500, 'again')).toEqual(kept);
  });
  it('does not silently replace a marker when the row has 50 already', () => {
    const row: MediaMarkers = { startMs: null, endMs: null, markers: Array.from({ length: 50 }, (_, i) => ({ id: String(i), name: 'Placeholder', atMs: i })) };
    expect(keepScene(row, 1000, 'overflow')).toEqual(row);
  });
});
