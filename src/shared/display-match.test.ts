import { describe, expect, it } from 'vitest';
import { describeDisplay, matchDisplays } from './display-match';
import type { DisplayInfo, DisplayKey } from './screens';

function display(id: number, label: string, w: number, h: number, x = 0, y = 0): DisplayInfo {
  const key: DisplayKey = { id, label, pixelWidth: w, pixelHeight: h, x, y, internal: false };
  return {
    id,
    label,
    bounds: { x, y, width: w, height: h },
    workArea: { x, y, width: w, height: h },
    scaleFactor: 1,
    pixelWidth: w,
    pixelHeight: h,
    refreshHz: 60,
    rotation: 0,
    internal: false,
    primary: id === 1,
    key,
  };
}
const saved = (screenId: string, d: DisplayInfo, overrides: Partial<DisplayKey> = {}) => ({
  screenId,
  key: { ...d.key, ...overrides },
});

describe('matchDisplays', () => {
  const laptop = display(1, 'Built-in', 2880, 1800);
  const hall = display(2, 'Hall TV', 1920, 1080, 1440, 0);
  const stage = display(3, 'Stage TV', 1920, 1080, 3360, 0);

  it('matches by id and size', () => {
    const m = matchDisplays([saved('a', hall), saved('b', stage)], [laptop, hall, stage]);
    expect([...m]).toEqual([
      ['a', 2],
      ['b', 3],
    ]);
  });

  it('falls back to the label when the id changed', () => {
    const m = matchDisplays(
      [saved('a', hall, { id: 77 })],
      [laptop, display(8, 'Hall TV', 1920, 1080, 1440, 0)],
    );
    expect(m.get('a')).toBe(8);
  });

  it('uses the position for unlabelled displays of the same size', () => {
    const left = display(10, '', 1920, 1080, 0, 0);
    const right = display(11, '', 1920, 1080, 1920, 0);
    const m = matchDisplays([saved('r', right, { id: 99 }), saved('l', left, { id: 98 })], [left, right]);
    expect(m.get('r')).toBe(11);
    expect(m.get('l')).toBe(10);
  });

  it('finds a monitor whose resolution changed by its label', () => {
    const m = matchDisplays(
      [saved('a', hall, { id: 5 })],
      [laptop, display(6, 'Hall TV', 1280, 720, 1440, 0)],
    );
    expect(m.get('a')).toBe(6);
  });

  it('reports a missing display as null', () => {
    const m = matchDisplays([saved('a', hall), saved('b', stage)], [laptop, hall]);
    expect(m.get('a')).toBe(2);
    expect(m.get('b')).toBeNull();
  });

  it('never gives one display to two screens', () => {
    const m = matchDisplays([saved('a', hall), saved('b', hall)], [laptop, hall]);
    expect([m.get('a'), m.get('b')]).toEqual([2, null]);
  });

  it('does not guess between two equally good displays', () => {
    const tv1 = display(21, 'TV', 1920, 1080, 0, 0);
    const tv2 = display(22, 'TV', 1920, 1080, 1920, 0);
    const m = matchDisplays([saved('a', tv1, { id: 5, x: 500 })], [tv1, tv2]);
    expect(m.get('a')).toBeNull();
  });

  it('describes a display for the UI', () => {
    expect(describeDisplay({ ...hall, refreshHz: 59.94 })).toBe('Hall TV · 1920 × 1080 · 59.94 Hz');
    expect(describeDisplay(display(4, '', 1280, 720))).toBe('Display 4 · 1280 × 720 · 60 Hz');
  });
});
