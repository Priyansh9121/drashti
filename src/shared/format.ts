/** A byte count for people: "512 bytes", "3.4 MB", "1.2 GB". */
export function formatBytes(n: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${v} bytes` : `${v.toFixed(1)} ${units[i] ?? ''}`;
}

/**
 * A date and time for names people see (backup folders, the diagnostics
 * file), in the computer's own time zone: "2026-09-29 18-30". No colons,
 * which Windows file names cannot hold.
 */
export function fileStamp(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}-${two(date.getMinutes())}`;
}

/**
 * A length as "2:05" (or "1:02:05" past an hour): rounded down to the second, or up (a countdown, so 0:00
 * shows only at the end). Below zero it is 0:00, unless `signed` ("-0:12", a timer run over).
 */
export function formatDuration(ms: number, { roundUp = false, signed = false } = {}): string {
  const negative = ms < 0 && signed;
  const away = negative ? Math.abs(ms) : Math.max(0, ms);
  const whole = roundUp && !negative ? Math.ceil(away / 1000) : Math.floor(away / 1000);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  const body = h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${s}` : `${String(m)}:${s}`;
  return negative && whole > 0 ? `-${body}` : body;
}

/**
 * How Drashti's computer writes the time (Sessions 31–36, I18N-8): its locale and time zone, which every
 * output, node, the stream's page, the stage display and the remote write their clocks in.
 */
export interface ClockStyle {
  locale: string;
  timeZone: string;
}

/** The time of day as a clock style writes it ("7:05 PM", "19:05"); without one, this computer's own way. */
export function formatClock(ms: number, style: ClockStyle | null | undefined): string {
  const time = { hour: 'numeric', minute: '2-digit' } as const;
  try {
    return new Date(ms).toLocaleTimeString(style?.locale ?? [], {
      ...time,
      ...(style ? { timeZone: style.timeZone } : {}),
    });
  } catch {
    // A style this computer cannot write in: its own way, rather than no clock.
    return new Date(ms).toLocaleTimeString([], time);
  }
}

/** A clock style as given (by Main, or over the network), when it is one this computer can write in. */
export function validClockStyle(raw: unknown): ClockStyle | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { locale, timeZone } = raw as Record<string, unknown>;
  if (typeof locale !== 'string' || typeof timeZone !== 'string') return null;
  if (locale.length > 40 || timeZone.length > 60) return null;
  try {
    new Intl.DateTimeFormat(locale, { timeZone });
    return { locale, timeZone };
  } catch {
    return null;
  }
}

/** This computer's clock style. */
export const ownClockStyle = (locale: string): ClockStyle => ({
  locale,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});
