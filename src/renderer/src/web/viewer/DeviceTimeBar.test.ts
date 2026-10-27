import { describe, expect, it } from 'vitest';
import { clockText } from './DeviceTimeBar';

/* A video's time on a phone's time bar (Session 54, D1): minutes and seconds, hours past the hour, never below 0. */

describe('a video’s time on a phone', () => {
  it('is minutes and seconds, with hours once past the hour', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(65_400)).toBe('1:05');
    expect(clockText(3_725_000)).toBe('1:02:05');
    expect(clockText(-500)).toBe('0:00');
    expect(clockText(Number.NaN)).toBe('0:00');
  });
});
