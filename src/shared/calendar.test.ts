import { describe, expect, it } from 'vitest';
import {
  calendarKey,
  type CalendarDay,
  festivalsLine,
  localDateOf,
  nameIn,
  nextMidnight,
  readCalendarFile,
  samvatLine,
} from './calendar';

/* Calendar files and today's lines (placeholder names only). */

const day = (date: string, over: Record<string, unknown> = {}) => ({
  date,
  samvat: 1001,
  month: { gu: 'નમૂના માસ', en: 'Placeholder month' },
  paksha: { gu: 'પહેલો પક્ષ', en: 'First half' },
  tithi: { gu: 'નમૂના તિથિ ૩', en: 'Placeholder tithi 3' },
  ...over,
});
const file = (days: unknown[], over: Record<string, unknown> = {}) => ({
  format: 'drashti-calendar',
  version: 1,
  name: 'Placeholder calendar',
  days,
  ...over,
});

describe('calendar files', () => {
  it('leave out a day that does not read, and a date given twice; sorted by date', () => {
    const read = readCalendarFile(
      file([
        day('2026-10-06'),
        day('2026-02-30'),
        day('2026-10-04', { tithi: {} }),
        day('2026-10-05'),
        day('2026-10-05', { samvat: 1002 }),
      ]),
    );
    if (!read.ok) throw new Error(read.message);
    expect(read.calendar.days.map((d) => [d.date, d.samvat])).toEqual([
      ['2026-10-05', 1001],
      ['2026-10-06', 1001],
    ]);
    expect(read.issues.map((i) => i.message)).toEqual([
      'Day 2 was left out: That date does not exist. (at days › 1 › date).',
      'Day 3 was left out: Give it in Gujarati, English or both. (at days › 2 › tithi).',
      '2026-10-05 is given twice: the first is kept.',
    ]);
  });

  it('refuse a file that is not a calendar, or has no day that reads', () => {
    expect(readCalendarFile({ format: 'drashti-shastra' })).toMatchObject({ ok: false });
    const extra = readCalendarFile(file([day('2026-10-04')], { colour: 'red' }));
    expect(extra.ok ? '' : extra.message).toMatch(/^This is not a calendar Drashti can read: /u);
    expect(readCalendarFile(file([day('nope')]))).toEqual({
      ok: false,
      message: 'The calendar has no days that Drashti can read.',
    });
    expect(readCalendarFile(file([]))).toMatchObject({ ok: false });
  });
});

describe("today's lines", () => {
  const today: CalendarDay = {
    ...day('2026-10-04'),
    festivals: [{ gu: 'નમૂના ઉત્સવ', en: 'Placeholder festival' }, { en: 'Second placeholder festival' }],
  };

  it('put the names together, the year in Gujarati digits in Gujarati', () => {
    expect(samvatLine(today, 'en')).toBe('Samvat 1001, Placeholder month First half Placeholder tithi 3');
    expect(samvatLine(today, 'gu')).toBe('સંવત ૧૦૦૧, નમૂના માસ પહેલો પક્ષ નમૂના તિથિ ૩');
    expect(festivalsLine(today, 'en')).toBe('Placeholder festival · Second placeholder festival');
    // A name given in one language shows in the other's place.
    expect(festivalsLine(today, 'gu')).toBe('નમૂના ઉત્સવ · Second placeholder festival');
    expect(nameIn({ gu: 'નમૂના' }, 'en')).toBe('નમૂના');
    expect(festivalsLine({ ...today, festivals: [] }, 'en')).toBe('');
  });

  it('know a calendar by its name, and today by the local date', () => {
    expect(calendarKey('  Placeholder   Calendar ')).toBe(calendarKey('placeholder calendar'));
    const evening = new Date(2026, 9, 4, 23, 59, 30).getTime();
    expect(localDateOf(evening)).toBe('2026-10-04');
    expect(localDateOf(nextMidnight(evening))).toBe('2026-10-05');
    expect(new Date(nextMidnight(evening)).getHours()).toBe(0);
  });
});
