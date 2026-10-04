import type { CalendarDay, CalendarResult, CalendarView } from '../../shared/calendar';
import { localDateOf, nextMidnight } from '../../shared/calendar';
import type { CommandResult } from '../../shared/engine/commands';
import type { CalendarRepo } from '../db/calendar';

/*
 * Today's Samvat date and tithi (src/shared/calendar.ts), as the main
 * process keeps it: the loaded calendars' entry for today's date (by the
 * engine's clock, this computer's local date) goes into the engine's state,
 * again just after midnight and whenever a calendar is loaded or removed.
 * A date no calendar gives is null: the screens show nothing for it.
 */

export interface CalendarDeps {
  repo: CalendarRepo;
  engine: { setCalendar(day: CalendarDay | null): CommandResult };
  /** The engine's clock (Date.now). */
  now(): number;
  /** Run `run` after `ms`; returns a way to cancel it (setTimeout when left out). */
  schedule?: (ms: number, run: () => void) => () => void;
  /** The calendars or today's entry changed: the operator window is told. */
  changed(view: CalendarView): void;
  log(level: 'info' | 'warn', message: string): void;
}

/** Look again at least this often, so a change to the computer's clock is noticed. */
const RECHECK_MS = 60 * 60_000;

export class CalendarService {
  private cancelTimer: (() => void) | null = null;
  private disposed = false;
  private lastDate = '';

  constructor(private readonly deps: CalendarDeps) {
    this.refresh();
  }

  view(): CalendarView {
    return { calendars: this.deps.repo.list(), today: this.deps.repo.day(localDateOf(this.deps.now())) };
  }

  /** Today's entry into the engine, the operator window told, and the next look just after midnight. */
  refresh(): void {
    if (this.disposed) return;
    const now = this.deps.now();
    const view = this.view();
    this.deps.engine.setCalendar(view.today);
    const date = localDateOf(now);
    if (date !== this.lastDate) {
      this.lastDate = date;
      this.deps.log('info', `Calendar: ${view.today ? 'an entry' : 'no entry'} for today`);
    }
    this.deps.changed(view);
    this.cancelTimer?.();
    const schedule =
      this.deps.schedule ??
      ((wait: number, go: () => void) => {
        const t = setTimeout(go, wait);
        return () => {
          clearTimeout(t);
        };
      });
    const wait = Math.min(nextMidnight(now) + 500 - now, RECHECK_MS);
    this.cancelTimer = schedule(Math.max(1000, wait), () => {
      this.refresh();
    });
  }

  remove(id: string): CalendarResult {
    if (!this.deps.repo.remove(id)) return { ok: false, message: 'That calendar is no longer loaded.' };
    this.refresh();
    return { ok: true };
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }
}
