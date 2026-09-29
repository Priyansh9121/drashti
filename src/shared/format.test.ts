import { describe, expect, it } from 'vitest';
import { fileStamp, formatBytes } from './format';

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
});
