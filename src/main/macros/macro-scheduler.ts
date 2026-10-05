import type { MacroCountdown, MacroCountdownView, MacroRunResult, MacroSchedule } from '../../shared/macros';
import { MACRO_COUNTDOWN_MS, MACRO_RUN_WITHIN_MS } from '../../shared/macros';
import { scheduleTimes } from '../../shared/schedule';

/*
 * Macros that run by themselves (Session 14, shared/macros.ts). At a
 * schedule's time the operator window counts down ten seconds, with Cancel,
 * then the macro runs as if pressed, in either mode (the one exception to
 * Simple Mode running no macros). A time is only run within a minute of it:
 * one that passed while Drashti was closed, or that a sleeping computer
 * missed, is never run late. Times are on the schedules' clock (the arti's).
 */

/** Look again at least this often, so a change to the computer's clock is noticed. */
const RECHECK_MS = 30_000;

export interface MacroSchedulerDeps {
  /** Every macro with its times. */
  macros(): { id: string; name: string; schedules: MacroSchedule[] }[];
  /** Run one now, as its schedule (Simple Mode lets this through). */
  run(macroId: string): MacroRunResult;
  /** The schedules' clock. */
  now(): number;
  /** The engine's clock, which the windows count down with. */
  engineNow(): number;
  changed(view: MacroCountdownView): void;
  log(level: 'info' | 'warn', message: string): void;
  schedule?: (ms: number, run: () => void) => () => void;
}

interface Counting {
  key: string;
  macroId: string;
  name: string;
  /** When it runs (the schedules' clock). */
  runAt: number;
}

export class MacroScheduler {
  private readonly startedAt: number;
  private checkedUpTo: number;
  private readonly counting = new Map<string, Counting>();
  private cancelTimer: (() => void) | null = null;
  private disposed = false;
  private lastSent = '';

  constructor(private readonly deps: MacroSchedulerDeps) {
    this.startedAt = deps.now();
    this.checkedUpTo = this.startedAt;
    this.check();
  }

  view(): MacroCountdownView {
    const offset = this.deps.now() - this.deps.engineNow();
    const countdowns: MacroCountdown[] = [...this.counting.values()]
      .sort((a, b) => a.runAt - b.runAt)
      .map((c) => ({ key: c.key, macroId: c.macroId, name: c.name, runAt: c.runAt - offset }));
    return { countdowns };
  }

  /** Cancel one counting down: it does not run this time. */
  cancel(key: unknown): MacroCountdownView {
    if (typeof key === 'string' && this.counting.delete(key)) {
      this.deps.log('info', 'Macros: running by itself cancelled');
      this.changed();
    }
    return this.view();
  }

  /** The macros (or their times) changed. */
  refresh(): void {
    this.check();
  }

  private changed(): void {
    const view = this.view();
    const sent = JSON.stringify(view);
    if (sent === this.lastSent) return;
    this.lastSent = sent;
    this.deps.changed(view);
  }

  check(): void {
    if (this.disposed) return;
    const now = this.deps.now();
    const macros = this.deps.macros();
    // Times since the last look, never before Drashti started.
    const from = Math.max(this.checkedUpTo, this.startedAt);
    for (const m of macros)
      for (const s of m.schedules) {
        if (!s.enabled) continue;
        for (const at of scheduleTimes(s, from, now + 1)) {
          const key = `${m.id}/${s.id}@${String(at)}`;
          if (this.counting.has(key)) continue;
          if (now - at > MACRO_RUN_WITHIN_MS) {
            this.deps.log(
              'info',
              `Macros: a time at ${new Date(at).toTimeString().slice(0, 5)} was missed, not run late`,
            );
            continue;
          }
          this.counting.set(key, { key, macroId: m.id, name: m.name, runAt: now + MACRO_COUNTDOWN_MS });
          this.deps.log('info', 'Macros: one runs by itself in ten seconds unless cancelled');
        }
      }
    this.checkedUpTo = now + 1;
    // Counted down: run, in order. A macro removed meanwhile, or its time turned off, goes quietly.
    for (const c of [...this.counting.values()].sort((a, b) => a.runAt - b.runAt)) {
      if (c.runAt > now) continue;
      this.counting.delete(c.key);
      const still = macros.find((m) => m.id === c.macroId);
      if (!still) continue;
      const result = this.deps.run(c.macroId);
      if (!result.ok) this.deps.log('warn', `Macros: could not run one by itself (${result.message})`);
    }
    this.changed();
    this.wake(now, macros);
  }

  private wake(now: number, macros: { schedules: MacroSchedule[] }[]): void {
    let next = now + RECHECK_MS;
    for (const c of this.counting.values()) if (c.runAt < next) next = c.runAt;
    for (const m of macros)
      for (const s of m.schedules)
        if (s.enabled) {
          const at = scheduleTimes(s, now + 1, next)[0];
          if (at !== undefined && at < next) next = at;
        }
    this.cancelTimer?.();
    const schedule =
      this.deps.schedule ??
      ((ms: number, run: () => void) => {
        const t = setTimeout(run, ms);
        return () => {
          clearTimeout(t);
        };
      });
    this.cancelTimer = schedule(Math.max(0, next - now), () => {
      this.check();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }
}
