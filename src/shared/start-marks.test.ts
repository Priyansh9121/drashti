import { describe, expect, it } from 'vitest';
import { parseStartMarks, START_MARKS } from './start-marks';

/* The operator window's own start (question 36 of Session 54), as the main process takes it from the window. */

const GOOD = {
  access: 1_793_000_000_100,
  mode: 1_793_000_000_120,
  keys: 1_793_000_000_121,
  info: 1_793_000_000_130,
  drawn: 1_793_000_000_140,
};

describe('the operator window’s start marks', () => {
  it('takes every mark as a time on this computer’s clock', () => {
    expect(parseStartMarks(GOOD)).toEqual(GOOD);
    expect(START_MARKS).toEqual(['access', 'mode', 'keys', 'info', 'drawn']);
  });

  it('refuses anything else: a mark missing, not a time, or not a plain object', () => {
    const { info: _info, ...noInfo } = GOOD;
    expect(parseStartMarks(noInfo)).toBeNull();
    expect(parseStartMarks({ ...GOOD, mode: '1793000000120' })).toBeNull();
    expect(parseStartMarks({ ...GOOD, keys: Number.NaN })).toBeNull();
    expect(parseStartMarks({ ...GOOD, drawn: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseStartMarks({ ...GOOD, access: -5 })).toBeNull();
    expect(parseStartMarks(null)).toBeNull();
    expect(parseStartMarks('marks')).toBeNull();
    expect(parseStartMarks([GOOD])).toBeNull();
  });

  it('keeps only the marks it knows', () => {
    expect(parseStartMarks({ ...GOOD, extra: 5 })).toEqual(GOOD);
  });
});
