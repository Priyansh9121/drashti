import { z } from 'zod';
import { idSchema } from './model-schema';

/*
 * The idle rotation (Session 12), taken out in Session 55 (Part 12: gone from the window, the phone, the API and the
 * screens). It showed darshan pictures from the media library and quotes from the admin's list, each up for a set
 * time, while nothing else was up; Drashti shipped no pictures and no quotes. Its settings and quotes stay in the
 * library, unseen, so nothing is lost: Part 6 turns its pictures into a wallpaper set (main/idle/idle-service.ts
 * oldIdleRotation lists them), and a stage layout's Quote box still shows the quote of the day from its quotes.
 *
 * When it showed was decided per screen group, in the Look ("When nothing is up"), which a Look still stores
 * (shared/looks.ts): nothing, the idle rotation once started, or always.
 */

export type IdleWhen = 'off' | 'started' | 'always';
export const IDLE_WHENS = ['off', 'started', 'always'] as const satisfies readonly IdleWhen[];

/** The languages a quote is given in. */
export type QuoteLang = 'gu' | 'hi' | 'en';
export const QUOTE_LANGS = ['gu', 'hi', 'en'] as const satisfies readonly QuoteLang[];

export interface Quote {
  id: string;
  /** Its words in one or more languages. */
  words: Partial<Record<QuoteLang, string>>;
  /** Who said or wrote it, as it should show ("— …"); may be empty. */
  attribution: string;
}

export type QuoteFields = Omit<Quote, 'id'>;

/** The admin's settings for the rotation, as the library keeps them. */
export interface IdleSettings {
  /** Pictures from the media library, in the order they show. */
  pictures: string[];
  secondsEach: number;
  /** After the pictures, the quote of the day. */
  quoteOfTheDay: boolean;
}

export const IDLE_SECONDS_MIN = 3;
export const IDLE_SECONDS_MAX = 600;
export const IDLE_PICTURES_MAX = 200;
export const QUOTES_MAX = 2000;

export const DEFAULT_IDLE_SETTINGS: IdleSettings = { pictures: [], secondsEach: 10, quoteOfTheDay: true };

export const idleSettingsSchema = z
  .object({
    pictures: z.array(idSchema).max(IDLE_PICTURES_MAX),
    secondsEach: z.number().int().min(IDLE_SECONDS_MIN).max(IDLE_SECONDS_MAX),
    quoteOfTheDay: z.boolean(),
  })
  .strict();

/**
 * What the idle rotation was set to show, as the library keeps it (main/idle/idle-service.ts oldIdleRotation): its
 * pictures in order (each with its name in the media library, or null when it is no longer there), the seconds each
 * was up, whether the quote of the day came after them, and the quotes. Part 6 makes a wallpaper set of it.
 */
export interface OldIdleRotation {
  pictures: { mediaId: string; name: string | null }[];
  secondsEach: number;
  quoteOfTheDay: boolean;
  quotes: Quote[];
}

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

export const quoteIdSchema = idSchema;
