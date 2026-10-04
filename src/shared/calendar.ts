import { z } from 'zod';

/*
 * Samvat and tithi (Session 12). Drashti computes no tithi: an admin loads a
 * calendar file (docs/calendar-format.md) that gives, for each date, the
 * Vikram Samvat year, the month, the paksha, the tithi and any festivals,
 * in Gujarati and English, from a source BAPS or the mandir has authorised.
 * Today's entry (by this computer's clock, the one the engine counts with)
 * goes into the engine's state, so every window shows the same: the
 * operator window, stage boxes, and messages with a Samvat field. A date
 * the calendars do not give shows nothing.
 */

export const CALENDAR_FORMAT = 'drashti-calendar';
export const CALENDAR_MAX_DAYS = 4000;
export const CALENDAR_MAX_FESTIVALS = 12;

/** The two languages a calendar gives its names in. */
export type CalendarLang = 'gu' | 'en';
export const CALENDAR_LANGS = ['gu', 'en'] as const satisfies readonly CalendarLang[];
export const CALENDAR_LANG_NAMES: Record<CalendarLang, string> = { gu: 'Gujarati', en: 'English' };

/** A name in Gujarati and English (a file may give just one; the other then shows it too). */
export interface CalendarName {
  gu?: string;
  en?: string;
}

export interface CalendarDay {
  /** "YYYY-MM-DD". */
  date: string;
  /** The Vikram Samvat year. */
  samvat: number;
  month: CalendarName;
  paksha: CalendarName;
  tithi: CalendarName;
  festivals: CalendarName[];
}

export interface CalendarFile {
  name: string;
  description: string | null;
  days: CalendarDay[];
}

/** A loaded calendar, as the Calendar dialog lists it. */
export interface CalendarInfo {
  id: string;
  name: string;
  description: string | null;
  firstDate: string;
  lastDate: string;
  dayCount: number;
  loadedAt: string;
}

export interface CalendarView {
  calendars: CalendarInfo[];
  /** Today's entry, or null when no calendar gives today. */
  today: CalendarDay | null;
}

export type CalendarResult = { ok: true } | { ok: false; message: string };

const name = (max: number) =>
  z
    .object({
      gu: z.string().trim().min(1).max(max).optional(),
      en: z.string().trim().min(1).max(max).optional(),
    })
    .strict()
    .refine((n) => n.gu !== undefined || n.en !== undefined, 'Give it in Gujarati, English or both.');

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Write dates as YYYY-MM-DD.')
  .refine((d) => {
    const t = new Date(`${d}T12:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  }, 'That date does not exist.');

const daySchema = z
  .object({
    date: dateSchema,
    samvat: z.number().int().min(1).max(9999),
    month: name(60),
    paksha: name(60),
    tithi: name(60),
    festivals: z.array(name(120)).max(CALENDAR_MAX_FESTIVALS).default([]),
  })
  .strict();

const fileSchema = z
  .object({
    format: z.literal(CALENDAR_FORMAT),
    version: z.literal(1),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    days: z.array(z.unknown()).min(1, 'The calendar has no days.').max(CALENDAR_MAX_DAYS),
  })
  .strict();

export interface CalendarIssue {
  message: string;
}

export type ReadCalendar =
  { ok: true; calendar: CalendarFile; issues: CalendarIssue[] } | { ok: false; message: string };

/** Where in the file a problem is: "(at days › 3 › tithi)". */
function where(path: readonly PropertyKey[]): string {
  return path.length > 0 ? ` (at ${path.map(String).join(' › ')})` : '';
}

/**
 * A calendar file, checked. A day that does not read is left out (the
 * issues say which and why), as is a date given twice (the first is kept);
 * a file with no day that reads is refused.
 */
export function readCalendarFile(json: unknown): ReadCalendar {
  const file = fileSchema.safeParse(json);
  if (!file.success) {
    const issue = file.error.issues[0];
    return {
      ok: false,
      message: `This is not a calendar Drashti can read: ${issue?.message ?? 'unknown problem'}${where(issue?.path ?? [])}.`,
    };
  }
  const issues: CalendarIssue[] = [];
  const days: CalendarDay[] = [];
  const seen = new Set<string>();
  file.data.days.forEach((raw, i) => {
    const day = daySchema.safeParse(raw);
    if (!day.success) {
      const issue = day.error.issues[0];
      issues.push({
        message: `Day ${String(i + 1)} was left out: ${issue?.message ?? 'it does not read'}${where(['days', i, ...(issue?.path ?? [])])}.`,
      });
      return;
    }
    if (seen.has(day.data.date)) {
      issues.push({ message: `${day.data.date} is given twice: the first is kept.` });
      return;
    }
    seen.add(day.data.date);
    days.push(day.data);
  });
  if (days.length === 0) return { ok: false, message: 'The calendar has no days that Drashti can read.' };
  days.sort((a, b) => a.date.localeCompare(b.date));
  return {
    ok: true,
    calendar: { name: file.data.name, description: file.data.description ?? null, days },
    issues,
  };
}

/** A calendar is known by its name: the same name (ignoring case and spaces) is the same calendar. */
export const calendarKey = (calendarName: string): string =>
  calendarName.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();

/** The name in this language, else the other. */
export const nameIn = (n: CalendarName, lang: CalendarLang): string =>
  (lang === 'gu' ? (n.gu ?? n.en) : (n.en ?? n.gu)) ?? '';

const GUJARATI_DIGITS = '૦૧૨૩૪૫૬૭૮૯';
const gujaratiDigits = (s: string) => s.replace(/\d/gu, (d) => GUJARATI_DIGITS[Number(d)] ?? d);

/** "Samvat 2082, Placeholder month Sud Teras" / "સંવત ૨૦૮૨, …": the date line. */
export function samvatLine(day: CalendarDay, lang: CalendarLang): string {
  const year = lang === 'gu' ? `સંવત ${gujaratiDigits(String(day.samvat))}` : `Samvat ${String(day.samvat)}`;
  const rest = [day.month, day.paksha, day.tithi].map((n) => nameIn(n, lang)).join(' ');
  return `${year}, ${rest}`;
}

/** The festivals, " · " between them; empty when there are none. */
export const festivalsLine = (day: CalendarDay, lang: CalendarLang): string =>
  day.festivals.map((f) => nameIn(f, lang)).join(' · ');

/** The local date of a time, "YYYY-MM-DD" (this computer's time zone). */
export function localDateOf(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The next local midnight after a time. */
export function nextMidnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

export const calendarIdSchema = z.string().min(1).max(64);
