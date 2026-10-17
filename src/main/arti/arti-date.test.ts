import { describe, expect, it } from 'vitest';
import { defaultArtiDate } from '../../shared/arti';

/*
 * A new arti's date (Sessions 31–36, I18N-8): today where the mandir is, never UTC's day. Run under
 * TZ=Asia/Kolkata at 00:30, when UTC is still on the day before.
 */

describe('a new arti’s date (Sessions 31–36, I18N-8)', () => {
  it('is today where the mandir is: at 00:30 in Asia/Kolkata it is that day, not the day before in UTC', () => {
    const was = process.env['TZ'];
    process.env['TZ'] = 'Asia/Kolkata';
    try {
      const now = new Date(2026, 9, 17, 0, 30);
      expect(now.getTimezoneOffset()).toBe(-330);
      expect(defaultArtiDate(now)).toBe('2026-10-17');
    } finally {
      if (was === undefined) delete process.env['TZ'];
      else process.env['TZ'] = was;
    }
  });
});
