import { describe, expect, it } from 'vitest';
import { markersFrom, pp6Markers } from './markers';

/* Markers read from the older formats (made-up values; unconfirmed against real files). */

describe('imported markers', () => {
  it('keep in and out points and named markers, in ms', () => {
    const m = markersFrom(1.5, 8, 20, [
      { name: 'Placeholder chorus', seconds: 4.25 },
      { name: '', seconds: 3 },
    ]);
    expect(m).toMatchObject({
      startMs: 1500,
      endMs: 8000,
      markers: [{ name: 'Placeholder chorus', atMs: 4250 }],
    });
  });

  it('say nothing for the whole file with no markers; an out point at the end plays to the end', () => {
    expect(markersFrom(0, 20, 20, [])).toBeNull();
    expect(markersFrom(2, 20, 20, [])).toMatchObject({ startMs: 2000, endMs: null });
  });

  it('read ProPresenter 6’s points in its time scale', () => {
    expect(
      pp6Markers({ timeScale: '600', inPoint: '1200', outPoint: '3000', endPoint: '6000' }),
    ).toMatchObject({
      startMs: 2000,
      endMs: 5000,
    });
    expect(pp6Markers({ inPoint: '0', outPoint: '6000', endPoint: '6000' })).toBeNull();
  });
});
