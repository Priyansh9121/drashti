import { localDateOf, nextMidnight } from '../../shared/calendar';
import type { CommandResult } from '../../shared/engine/commands';
import {
  DEFAULT_IDLE_SETTINGS,
  IDLE_DISSOLVE_MS,
  type IdleItem,
  type IdleResult,
  type IdleSettings,
  idleSettingsSchema,
  type IdleState,
  type IdleView,
  type Quote,
  quoteFieldsSchema,
  quoteOfTheDay,
  type QuoteResult,
  QUOTES_MAX,
} from '../../shared/idle';
import type { QuoteRepo } from '../db/quotes';

/*
 * The idle rotation (src/shared/idle.ts), as the main process keeps it: the
 * admin's settings and quotes, the pictures that are still in the media
 * library, and the quote of the day (again just after midnight), all put
 * into the engine's state so every window shows the same. Starting and
 * stopping it are engine commands (the panel, a macro); which groups show
 * it is in their Look.
 */

export interface IdleDeps {
  quotes: QuoteRepo;
  settings: { get(name: string): unknown; set(name: string, value: unknown): void };
  /** A picture in the media library (not missing), with its name; null otherwise. */
  picture(mediaId: string): { name: string } | null;
  engine: {
    setIdle(content: Omit<IdleState, 'startedAt'>): CommandResult;
    setQuote(quote: Quote | null): CommandResult;
  };
  /** The engine's clock (Date.now). */
  now(): number;
  schedule?: (ms: number, run: () => void) => () => void;
  /** The settings, quotes or the quote of the day changed: the operator window is told. */
  changed(view: IdleView): void;
}

const SETTING = 'idleRotation';
/** Look again at least this often, so a change to the computer's clock is noticed. */
const RECHECK_MS = 60 * 60_000;

export class IdleService {
  private cancelTimer: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly deps: IdleDeps) {
    this.refresh();
  }

  settings(): IdleSettings {
    const parsed = idleSettingsSchema.safeParse(this.deps.settings.get(SETTING));
    return parsed.success ? parsed.data : DEFAULT_IDLE_SETTINGS;
  }

  view(): IdleView {
    const settings = this.settings();
    const quotes = this.deps.quotes.list();
    return {
      settings,
      quotes,
      pictures: settings.pictures.map((mediaId) => ({
        mediaId,
        name: this.deps.picture(mediaId)?.name ?? null,
      })),
      quoteOfTheDay: quoteOfTheDay(quotes, localDateOf(this.deps.now())),
    };
  }

  saveSettings(input: unknown): IdleResult {
    const parsed = idleSettingsSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'Those settings do not read.' };
    const pictures = [...new Set(parsed.data.pictures)];
    const gone = pictures.find((id) => this.deps.picture(id) === null);
    if (gone !== undefined)
      return { ok: false, message: 'A chosen picture is no longer in the media library.' };
    this.deps.settings.set(SETTING, { ...parsed.data, pictures });
    this.refresh();
    return { ok: true };
  }

  saveQuote(id: string | null, input: unknown): QuoteResult {
    const parsed = quoteFieldsSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'That quote does not read.' };
    if (id === null) {
      if (this.deps.quotes.count() >= QUOTES_MAX)
        return { ok: false, message: `There can be up to ${String(QUOTES_MAX)} quotes.` };
      const made = this.deps.quotes.create(parsed.data);
      this.refresh();
      return { ok: true, id: made };
    }
    if (!this.deps.quotes.save(id, parsed.data))
      return { ok: false, message: 'That quote is no longer there.' };
    this.refresh();
    return { ok: true, id };
  }

  removeQuote(id: string): IdleResult {
    if (!this.deps.quotes.remove(id)) return { ok: false, message: 'That quote is no longer there.' };
    this.refresh();
    return { ok: true };
  }

  /** What the rotation shows, into the engine; the operator window told; the next look just after midnight. */
  refresh(): void {
    if (this.disposed) return;
    const view = this.view();
    const items: IdleItem[] = view.pictures.flatMap((p) =>
      p.name === null ? [] : [{ kind: 'picture' as const, mediaId: p.mediaId }],
    );
    if (view.settings.quoteOfTheDay && view.quoteOfTheDay)
      items.push({ kind: 'quote', quote: view.quoteOfTheDay });
    this.deps.engine.setIdle({ items, secondsEach: view.settings.secondsEach, dissolveMs: IDLE_DISSOLVE_MS });
    this.deps.engine.setQuote(view.quoteOfTheDay);
    this.deps.changed(view);
    this.cancelTimer?.();
    const now = this.deps.now();
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
