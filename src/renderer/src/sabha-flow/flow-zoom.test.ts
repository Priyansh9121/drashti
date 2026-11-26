import { describe, expect, it } from 'vitest';
import { parseZoom, zoomPosition, zoomStep, ZOOM_STEPS } from './FlowPage';

describe('PDF zoom', () => {
  it.each([
    ['130', 1.3],
    ['130%', 1.3],
    [' 75 ', 0.75],
    ['25', 0.25],
    ['400%', 4],
  ])('accepts %s', (text, value) => {
    expect(parseZoom(text)).toBe(value);
  });
  it.each(['24', '401', 'abc', '', '130%%', 'Infinity', '1e2'])(
    'refuses %s without changing zoom',
    (text) => {
      expect(parseZoom(text)).toBeNull();
    },
  );
  it('steps from arbitrary zooms and stops at the limits', () => {
    expect(ZOOM_STEPS).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]);
    expect(zoomStep(1.3, 1)).toBe(1.5);
    expect(zoomStep(1.3, -1)).toBe(1.25);
    expect(zoomStep(0.25, -1)).toBe(0.25);
    expect(zoomStep(4, 1)).toBe(4);
  });
  it('keeps the centre when a scrollbar changes the viewport size', () => {
    expect(zoomPosition(100, 80, 1, 2, 8, 72)).toBe(280);
  });
  it('keeps the centre or pointer over the same page coordinate, accounting for padding', () => {
    expect(zoomPosition(100, 80, 1, 2, 8)).toBe(272);
    expect(zoomPosition(272, 80, 2, 1, 8)).toBe(100);
    expect(zoomPosition(0, 30, 1, 0.25, 8)).toBe(0);
  });
});
