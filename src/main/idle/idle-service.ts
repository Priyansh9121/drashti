import { localDateOf, nextMidnight } from '../../shared/calendar';
import type { CommandResult } from '../../shared/engine/commands';
import {
  DEFAULT_IDLE_SETTINGS,
  type IdleSettings,
  idleSettingsSchema,
  type OldIdleRotation,
  type Quote,
  quoteOfTheDay,
} from '../../shared/idle';

/*
 * What is left of the idle rotation (Session 55, Part 12: taken out of the window, the phone, the API and the
 * screens). Its settings and quotes stay in the library, unseen:
 * - oldIdleRotation lists what it was set to show, for Part 6 to make a wallpaper set of it, so nothing is lost;
 * - QuoteOfTheDay puts the quote of the day into the engine's state (again just after midnight), for a stage layout's
 *   Quote box, which shows one quote a day from the quotes it had.
 */

/** The library's settings, where the idle rotation's are kept. */
export interface IdleSettingsStore {
  get(name: string): unknown;
}

/** The setting the idle rotation's settings are kept under (as Session 12 kept them). */
export const IDLE_SETTING = 'idleRotation';

/** The idle rotation's settings as the library keeps them (its defaults when there are none, or they do not read). */
export function idleSettings(settings: IdleSettingsStore): IdleSettings {
  const parsed = idleSettingsSchema.safeParse(settings.get(IDLE_SETTING));
  return parsed.success ? parsed.data : DEFAULT_IDLE_SETTINGS;
}

/**
 * What the idle rotation was set to show (shared/idle.ts OldIdleRotation), read from the library: its pictures in
 * order, each with its name in the media library (`picture`: null once it is gone), the seconds each, whether the
 * quote of the day came after them, and the quotes. Part 6 turns this into a wallpaper set.
 */
export function oldIdleRotation(deps: {
  settings: IdleSettingsStore;
  quotes: { list(): Quote[] };
  picture(mediaId: string): { name: string } | null;
}): OldIdleRotation {
  const settings = idleSettings(deps.settings);
  return {
    pictures: settings.pictures.map((mediaId) => ({ mediaId, name: deps.picture(mediaId)?.name ?? null })),
    secondsEach: settings.secondsEach,
    quoteOfTheDay: settings.quoteOfTheDay,
    quotes: deps.quotes.list(),
  };
}

export interface QuoteOfTheDayDeps {
  quotes: { list(): Quote[] };
  engine: { setQuote(quote: Quote | null): CommandResult };
  /** The engine's clock (Date.now). */
  now(): number;
  schedule?: (ms: number, run: () => void) => () => void;
}

/** Look again at least this often, so a change to the computer's clock is noticed. */
const RECHECK_MS = 60 * 60_000;

/** The quote of the day in the engine's state, for a stage layout's Quote box: one quote a date, from the quotes. */
export class QuoteOfTheDay {
  private cancelTimer: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly deps: QuoteOfTheDayDeps) {
    this.refresh();
  }

  /** Today's quote into the engine; the next look just after midnight. */
  refresh(): void {
    if (this.disposed) return;
    const now = this.deps.now();
    this.deps.engine.setQuote(quoteOfTheDay(this.deps.quotes.list(), localDateOf(now)));
    this.cancelTimer?.();
    const schedule =
      this.deps.schedule ??
      ((wait: number, go: () => void) => {
        const t = setTimeout(go, wait);
        return () => {
          clearTimeout(t);
        };
      });
    this.cancelTimer = schedule(Math.max(1000, Math.min(nextMidnight(now) + 500 - now, RECHECK_MS)), () => {
      this.refresh();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }
}
