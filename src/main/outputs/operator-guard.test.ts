import { describe, expect, it } from 'vitest';
import type { DisplayInfo } from '../../shared/screens';
import { displayOf, placeOperator } from './operator-guard';

function display(
  id: number,
  x: number,
  width = 1920,
  height = 1080,
  extra: Partial<DisplayInfo> = {},
): DisplayInfo {
  const bounds = { x, y: 0, width, height };
  return {
    id,
    label: `D${id}`,
    bounds,
    workArea: { x, y: 25, width, height: height - 25 },
    scaleFactor: 1,
    pixelWidth: width,
    pixelHeight: height,
    refreshHz: 60,
    rotation: 0,
    internal: false,
    primary: false,
    key: { id, label: `D${id}`, pixelWidth: width, pixelHeight: height, x, y: 0, internal: false },
    ...extra,
  };
}

const laptop = display(1, 0, 1440, 900, { primary: true, internal: true });
const hall = display(2, 1440);
const stage = display(3, 3360);
const operator = { x: 100, y: 100, width: 1200, height: 700 };

describe('displayOf', () => {
  it('finds the display holding the middle of the window', () => {
    expect(displayOf(operator, [laptop, hall])?.id).toBe(1);
    expect(displayOf({ ...operator, x: 1500 }, [laptop, hall])?.id).toBe(2);
  });

  it('falls back to the biggest overlap when the middle is off every display', () => {
    expect(displayOf({ x: -900, y: 0, width: 1000, height: 500 }, [laptop, hall])?.id).toBe(1);
    expect(displayOf({ x: 99999, y: 0, width: 10, height: 10 }, [laptop])).toBeNull();
  });
});

describe('placeOperator', () => {
  it('leaves the operator alone when nothing covers it', () => {
    expect(placeOperator(operator, [laptop, hall], new Set([2]))).toBeNull();
  });

  it('moves the operator off an output to a free display, inside its work area', () => {
    const covered = { ...operator, x: 1600 };
    expect(placeOperator(covered, [laptop, hall, stage], new Set([2, 3]))).toEqual({
      x: 0 + Math.round((1440 - 1200) / 2),
      y: 25 + Math.round((875 - 700) / 2),
      width: 1200,
      height: 700,
    });
  });

  it('shrinks the window to fit a smaller display', () => {
    const big = { x: 1500, y: 0, width: 1900, height: 1060 };
    const moved = placeOperator(big, [laptop, hall], new Set([2]));
    expect(moved).toMatchObject({ width: 1440, height: 875, x: 0, y: 25 });
  });

  it('prefers the primary display, then the built-in one', () => {
    const other = display(4, -1920);
    const covered = { ...operator, x: 1600 };
    expect(placeOperator(covered, [other, hall, laptop], new Set([2]))?.x).toBe(
      Math.round((1440 - 1200) / 2),
    );
    const noPrimary = display(5, 0, 1440, 900, { internal: true });
    expect(placeOperator(covered, [other, hall, noPrimary], new Set([2]))?.x).toBe(
      Math.round((1440 - 1200) / 2),
    );
  });

  it('cannot help when every display has an output (the uncover shortcut is the way back)', () => {
    expect(placeOperator(operator, [laptop], new Set([1]))).toBeNull();
    expect(placeOperator(operator, [laptop, hall], new Set([1, 2]))).toBeNull();
  });
});
