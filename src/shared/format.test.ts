import { describe, expect, it } from 'vitest';
import { fileStamp, formatBytes, formatClock, formatDuration } from './format';

describe('formatting for people', () => {
  it('names a moment in local time, without colons', () => {
    // Built from local parts, so the expectation holds in any time zone.
    expect(fileStamp(new Date(2026, 8, 29, 18, 5))).toBe('2026-09-29 18-05');
    expect(fileStamp(new Date(2027, 0, 3, 7, 0))).toBe('2027-01-03 07-00');
  });

  it('writes byte counts in the unit that reads best', () => {
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
    expect(formatBytes(1.25 * 1024 ** 3)).toBe('1.3 GB');
  });

  it('one way to write a length (Sessions 31–36, I18N-8): down to the second, or up; below zero 0:00 unless signed', () => {
    expect(formatDuration(125_900)).toBe('2:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(125_100, { roundUp: true })).toBe('2:06');
    expect(formatDuration(-12_000)).toBe('0:00');
    expect(formatDuration(-12_000, { signed: true })).toBe('-0:12');
    expect(formatDuration(-400, { signed: true })).toBe('0:00');
  });

  it('writes the time of day in a clock style: its locale and its time zone', () => {
    const at = Date.UTC(2026, 9, 16, 19, 0);
    expect(formatClock(at, { locale: 'en-GB', timeZone: 'Asia/Kolkata' })).toBe('0:30');
    expect(formatClock(at, { locale: 'en-GB', timeZone: 'UTC' })).toBe('19:00');
    // A style's formatter is made once (PERF-5d): asked again, the same words, a minute on as they should be.
    expect(formatClock(at + 60_000, { locale: 'en-GB', timeZone: 'Asia/Kolkata' })).toBe('0:31');
    // One this computer cannot write in: its own way, rather than no clock.
    expect(formatClock(at, { locale: 'en-GB', timeZone: 'Placeholder/Nowhere' })).toBe(
      new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    );
    // Without a style, this computer's own way (it follows the computer's zone, so it is never kept).
    expect(formatClock(at, null)).toBe(
      new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    );
  });
});
