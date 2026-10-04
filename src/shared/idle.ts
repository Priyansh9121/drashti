import { z } from 'zod';
import { idSchema } from './model-schema';

/*
 * The idle rotation (Session 12): darshan pictures from the media library
 * and quotes from the admin's list, each up for a set time, dissolving into
 * the next, in step on every screen (each works out where the rotation is
 * from the engine's clock, as with video). Drashti ships no pictures and no
 * quotes: the admin chooses pictures the mandir has, and types quotes from
 * authorised sources.
 *
 * When it shows is decided per screen group, in the Look ("When nothing is
 * up"):
 * - **The idle rotation, once started**: the operator starts it (the Idle
 *   rotation panel, or a macro); it shows on these screens while nothing
 *   else is up there, and stops by itself when the first slide or picture
 *   goes up, so a later Clear all does not bring it back.
 * - **The idle rotation, always** (a lobby screen): whenever nothing is up
 *   there, started or not.
 * - **Nothing** (the default): these screens never show it.
 *
 * The quote of the day is one quote per date (the same all day, on every
 * screen); the rotation can show it after the pictures, and a stage layout
 * can show it in a box.
 */

export type IdleWhen = 'off' | 'started' | 'always';
export const IDLE_WHENS = ['off', 'started', 'always'] as const satisfies readonly IdleWhen[];
export const IDLE_WHEN_NAMES: Record<IdleWhen, string> = {
  off: 'Nothing',
  started: 'The idle rotation, once started',
  always: 'The idle rotation, always (a lobby screen)',
};

/** The languages a quote is given in. */
export type QuoteLang = 'gu' | 'hi' | 'en';
export const QUOTE_LANGS = ['gu', 'hi', 'en'] as const satisfies readonly QuoteLang[];
export const QUOTE_LANG_NAMES: Record<QuoteLang, string> = { gu: 'Gujarati', hi: 'Hindi', en: 'English' };

export interface Quote {
  id: string;
  /** Its words in one or more languages. */
  words: Partial<Record<QuoteLang, string>>;
  /** Who said or wrote it, as it should show ("— …"); may be empty. */
  attribution: string;
}

export type QuoteFields = Omit<Quote, 'id'>;

/** One thing the rotation shows. */
export type IdleItem = { kind: 'picture'; mediaId: string } | { kind: 'quote'; quote: Quote };

/** The rotation as the engine carries it to every window. */
export interface IdleState {
  /** When the operator started it; null while it is not running (lobby screens show it anyway). */
  startedAt: number | null;
  /** In order: the pictures, then the quote of the day when chosen. */
  items: IdleItem[];
  /** Each item is up this long, its dissolve included. */
  secondsEach: number;
  dissolveMs: number;
}

/** The admin's settings for the rotation. */
export interface IdleSettings {
  /** Pictures from the media library, in the order they show. */
  pictures: string[];
  secondsEach: number;
  /** After the pictures, the quote of the day. */
  quoteOfTheDay: boolean;
}

export const IDLE_DISSOLVE_MS = 1500;
export const IDLE_SECONDS_MIN = 3;
export const IDLE_SECONDS_MAX = 600;
export const IDLE_PICTURES_MAX = 200;
export const QUOTES_MAX = 2000;

export const DEFAULT_IDLE_SETTINGS: IdleSettings = { pictures: [], secondsEach: 10, quoteOfTheDay: true };

export const NO_IDLE: IdleState = {
  startedAt: null,
  items: [],
  secondsEach: DEFAULT_IDLE_SETTINGS.secondsEach,
  dissolveMs: IDLE_DISSOLVE_MS,
};

export const idleSettingsSchema = z
  .object({
    pictures: z.array(idSchema).max(IDLE_PICTURES_MAX),
    secondsEach: z.number().int().min(IDLE_SECONDS_MIN).max(IDLE_SECONDS_MAX),
    quoteOfTheDay: z.boolean(),
  })
  .strict();

export const quoteFieldsSchema = z
  .object({
    words: z
      .object({
        gu: z.string().trim().min(1).max(600).optional(),
        hi: z.string().trim().min(1).max(600).optional(),
        en: z.string().trim().min(1).max(600).optional(),
      })
      .strict()
      .refine((w) => QUOTE_LANGS.some((l) => w[l] !== undefined), 'Give its words in at least one language.'),
    attribution: z.string().trim().max(120),
  })
  .strict();

/** The settings, the quotes, and what the rotation shows now, for the operator window. */
export interface IdleView {
  settings: IdleSettings;
  quotes: Quote[];
  /** The pictures' names (a picture removed from the library is left out of the rotation, and listed as gone). */
  pictures: { mediaId: string; name: string | null }[];
  quoteOfTheDay: Quote | null;
}

export type IdleResult = { ok: true } | { ok: false; message: string };
export type QuoteResult = { ok: true; id: string } | { ok: false; message: string };

/** Days since 1970-01-01 for a "YYYY-MM-DD" date (the same everywhere: no time zone in it). */
function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 864e5);
}

/** One quote for a date: the same all day, the next one the next day, round the list. */
export function quoteOfTheDay<T>(quotes: readonly T[], date: string): T | null {
  if (quotes.length === 0) return null;
  const n = dayNumber(date);
  return quotes[((n % quotes.length) + quotes.length) % quotes.length] ?? null;
}

/**
 * Where the rotation is at `now`: the item up, and the one after it with how
 * far it has dissolved in (0 to 1; 0 outside the dissolve). Counted from
 * `anchor` (when it was started, or 0 for a lobby screen showing it without
 * a start), so every window works it out alike. Null with nothing to show.
 */
export function idleFrame(
  idle: Pick<IdleState, 'items' | 'secondsEach' | 'dissolveMs'>,
  anchor: number,
  now: number,
): { index: number; next: number; fade: number } | null {
  const count = idle.items.length;
  if (count === 0) return null;
  const each = idle.secondsEach * 1000;
  const elapsed = Math.max(0, now - anchor);
  const step = Math.floor(elapsed / each);
  const index = step % count;
  const into = elapsed - step * each;
  const dissolve = Math.min(idle.dissolveMs, each / 2);
  const fade = count > 1 && into > each - dissolve ? (into - (each - dissolve)) / dissolve : 0;
  return { index, next: (index + 1) % count, fade: Math.min(1, Math.max(0, fade)) };
}

export const quoteIdSchema = idSchema;
