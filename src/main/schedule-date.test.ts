import { describe, expect, it } from 'vitest';
import { localDate } from '../shared/schedule';

/*
 * A schedule's date of today (Sessions 31–36, I18N-8; the arti's test until it left, Session 44): where the
 * mandir is, never UTC's day. Run under
 * TZ=Asia/Kolkata at 00:30, when UTC is still on the day before.
 */

describe('a schedule’s date of today (Sessions 31–36, I18N-8)', () => {
  it('is today where the mandir is: at 00:30 in Asia/Kolkata it is that day, not the day before in UTC', () => {
    const was = process.env['TZ'];
    process.env['TZ'] = 'Asia/Kolkata';
    try {
      const now = new Date(2026, 9, 17, 0, 30);
      expect(now.getTimezoneOffset()).toBe(-330);
      expect(localDate(now)).toBe('2026-10-17');
    } finally {
      if (was === undefined) delete process.env['TZ'];
      else process.env['TZ'] = was;
    }
  });
});
