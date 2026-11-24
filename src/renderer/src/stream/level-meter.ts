/*
 * The Stream panel's sound meter (stream/preview.ts): what it shows from the stream's level reports, about ten a
 * second from the stream's sound page (alpha.23, Codex x86) by way of its picture page.
 */

/** With no level report for this long, the meter counts it as silence (ms): ten reports' gap is three of them. */
export const LEVEL_QUIET_MS = 300;

export interface MeterLevel {
  db(): number;
  set(db: number): void;
}

/**
 * Like a mixer's meter: a peak shows at once and falls back at 20 dB a second (2 dB a report). `tick` runs every
 * 100 ms between reports.
 */
export function levelMeter(level: MeterLevel, _now: () => number) {
  return {
    report(db: number): void {
      const shown = Math.max(db, level.db() - 2);
      if (Math.abs(level.db() - shown) >= 0.5) level.set(shown);
    },
    tick(): void {
      // Nothing yet: the meter holds its last reading until the next report.
    },
  };
}
