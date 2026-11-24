import { describe, expect, it } from 'vitest';
import { LEVEL_QUIET_MS, levelMeter } from './level-meter';

function meter() {
  let db = -100;
  let at = 0;
  const level = { db: () => db, set: (next: number) => (db = next) };
  const m = levelMeter(level, () => at);
  return {
    level,
    /** Ten reports a second of `reading`, with the meter's own tick between them, for `ms`. */
    reports(reading: number, ms: number) {
      for (let t = 0; t < ms; t += 100) {
        at += 100;
        m.report(reading);
        m.tick();
      }
    },
    /** No report at all for `ms`: only the tick. */
    silent(ms: number) {
      for (let t = 0; t < ms; t += 100) {
        at += 100;
        m.tick();
      }
    },
    report: (reading: number) => m.report(reading),
  };
}

describe('the Stream panel’s sound meter', () => {
  it('shows a peak at once and falls back 2 dB a report, as before', () => {
    const m = meter();
    m.reports(-10, 100);
    expect(m.level.db()).toBe(-10);
    m.reports(-100, 500);
    expect(m.level.db()).toBe(-20);
  });

  it('holds while the reports come, a late one included', () => {
    const m = meter();
    m.reports(-10, 1000);
    m.silent(LEVEL_QUIET_MS - 100);
    expect(m.level.db(), 'a report a little late is no silence').toBe(-10);
    m.reports(-10, 1000);
    expect(m.level.db()).toBe(-10);
  });

  it('falls back as in silence when the reports stop, never holding its last peak (a22-review-x86 S3)', () => {
    // The stream's sound page down, at its cap or hung: nothing reports, and the meter held its last peak (about
    // -10 dB) while the stream was silent.
    const m = meter();
    m.reports(-10, 1000);
    m.silent(LEVEL_QUIET_MS + 1000);
    expect(m.level.db(), 'falling at 20 dB a second once no report came for its 300 ms').toBeLessThanOrEqual(-28);
    m.silent(10_000);
    expect(m.level.db(), 'down to silence, and no lower').toBe(-100);
    m.report(-12);
    expect(m.level.db(), 'a report shows at once again').toBe(-12);
  });
});
