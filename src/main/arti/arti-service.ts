import {
  ARTI_BY_ITSELF_WITHIN_MS,
  ARTI_COUNTDOWN_MS,
  ARTI_LATE_MS,
  ARTI_SCHEDULES_MAX,
  type ArtiAnswer,
  artiFieldsSchema,
  type ArtiPrompt,
  type ArtiResult,
  artiTimes,
  type ArtiView,
  nextArtiTime,
} from '../../shared/arti';
import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import type { EngineState } from '../../shared/engine/state';
import type { ArtiRepo, StoredArti } from '../db/arti';

/*
 * The arti at its time (src/shared/arti.ts), as the main process runs it.
 * One prompt at a time, the earliest: it shows from its schedule's minutes
 * before; at the time the arti is cued (what Next shows); the operator puts
 * it up or says not now. A schedule that goes up by itself counts ten
 * seconds first, which the operator can cancel. The prompt goes once the
 * arti is up (however it got there), once answered, or ten minutes after
 * its time. A time that passed while Drashti was closed is never run.
 */

export interface ArtiDeps {
  repo: ArtiRepo;
  engine: {
    state(): EngineState;
    dispatch(command: EngineCommand): CommandResult;
    onChange(listener: (state: EngineState) => void): () => void;
  };
  /** This computer's time, for the schedules (Date.now; the tests move it). */
  now(): number;
  /** The engine's clock, which the windows count down with (Date.now). */
  engineNow(): number;
  /** Run `run` after `ms`; returns a way to cancel it (setTimeout when left out). */
  schedule?: (ms: number, run: () => void) => () => void;
  /** The schedules or the prompt changed: the operator window is told. */
  changed(view: ArtiView): void;
  log(level: 'info' | 'warn', message: string): void;
}

/** A time of a schedule, while it prompts. */
interface Showing {
  key: string;
  scheduleId: string;
  name: string;
  presentationId: string;
  /** "19:00". */
  time: string;
  /** Its time (this computer's clock). */
  at: number;
  promptMs: number;
  byItself: boolean;
  /** It is cued in the engine (from its time). */
  cued: boolean;
  /** Counting down to go up by itself, until then (this computer's clock). */
  byItselfAt: number | null;
  /** The operator cancelled going up by itself. */
  cancelled: boolean;
}

/** Check again at least this often, so a change to the computer's clock is noticed. */
const RECHECK_MS = 30_000;
const keyOf = (scheduleId: string, at: number) => `${scheduleId}@${String(at)}`;
const gone: ArtiAnswer = { ok: false, message: 'That arti prompt has gone.' };

export class ArtiService {
  /** Times before this (Drashti was closed) are never run. */
  private readonly startedAt: number;
  /** Times answered, put up, or gone by: they prompt no more. */
  private readonly done = new Map<string, number>();
  private showing: Showing | null = null;
  private cancelTimer: (() => void) | null = null;
  private readonly stopListening: () => void;
  private lastSent = '';
  private disposed = false;

  constructor(private readonly deps: ArtiDeps) {
    this.startedAt = deps.now();
    this.stopListening = deps.engine.onChange((state) => {
      this.engineChanged(state);
    });
    this.check();
  }

  view(): ArtiView {
    const now = this.deps.now();
    const offset = now - this.deps.engineNow();
    const schedules = this.deps.repo.list().map((s) => ({
      ...s,
      nextAt: s.enabled && s.presentationName !== null ? nextArtiTime(s, now) : null,
    }));
    const c = this.showing;
    const prompt: ArtiPrompt | null = c
      ? {
          key: c.key,
          scheduleId: c.scheduleId,
          name: c.name,
          presentationId: c.presentationId,
          time: c.time,
          at: c.at - offset,
          byItselfAt: c.byItselfAt === null ? null : c.byItselfAt - offset,
        }
      : null;
    return { schedules, prompt, offsetMs: offset };
  }

  save(id: string | null, input: unknown): ArtiResult {
    const parsed = artiFieldsSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'That is not a valid schedule.' };
    const fields = parsed.data;
    if (!this.deps.repo.hasPresentation(fields.presentationId))
      return { ok: false, message: 'That presentation is no longer in the library.' };
    if (id === null && this.deps.repo.count() >= ARTI_SCHEDULES_MAX)
      return { ok: false, message: `There can be up to ${String(ARTI_SCHEDULES_MAX)} arti schedules.` };
    if (id === null) {
      const made = this.deps.repo.create(fields);
      this.changed(true);
      return { ok: true, id: made };
    }
    if (!this.deps.repo.save(id, fields)) return { ok: false, message: 'That schedule is no longer there.' };
    this.changed(true);
    return { ok: true, id };
  }

  setEnabled(id: string, enabled: boolean): ArtiResult {
    if (!this.deps.repo.setEnabled(id, enabled))
      return { ok: false, message: 'That schedule is no longer there.' };
    this.changed(true);
    return { ok: true, id };
  }

  remove(id: string): ArtiResult {
    if (!this.deps.repo.remove(id)) return { ok: false, message: 'That schedule is no longer there.' };
    this.changed(true);
    return { ok: true, id };
  }

  /** Put up Arti now: cued if it was not yet, then up, in its playlist when the live one has it. */
  putUp(key: string): ArtiAnswer {
    const c = this.showing;
    if (c?.key !== key) return gone;
    const up = this.play(c);
    if (!up.ok) return up;
    this.end(c, false);
    return { ok: true };
  }

  /** Not now: the prompt goes, and so does the cue. */
  notNow(key: string): ArtiAnswer {
    const c = this.showing;
    if (c?.key !== key) return gone;
    this.end(c, true);
    return { ok: true };
  }

  /** Cancel going up by itself: the prompt stays, for the operator to answer. */
  cancel(key: string): ArtiAnswer {
    const c = this.showing;
    if (c?.key !== key) return gone;
    c.cancelled = true;
    c.byItselfAt = null;
    this.deps.log('info', 'Arti: going up by itself cancelled');
    this.changed(false);
    return { ok: true };
  }

  /** The library or the clock changed: look again (the schedules' presentations, what is due). */
  refresh(): void {
    this.changed(true);
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.stopListening();
  }

  /** What is due now, what it does, and when to look again. */
  check(): void {
    if (this.disposed) return;
    const now = this.deps.now();
    for (const [key, at] of this.done) if (at < now - 2 * 24 * 3600 * 1000) this.done.delete(key);
    const schedules = this.deps.repo.list();
    const due = this.due(schedules, now);
    // A schedule changed or switched off, its presentation went, or its time went by: its prompt goes.
    const c = this.showing;
    if (c && !due.some((d) => d.key === c.key)) this.end(c, true);
    // The earliest due (one whose arti cannot be cued gives way to the next).
    for (const d of due) {
      if (this.showing) break;
      if (this.done.has(d.key)) continue;
      if (this.isUp(d.presentationId)) {
        this.done.set(d.key, d.at);
        continue;
      }
      this.showing = d;
      this.deps.log('info', `Arti: prompt for its time ${new Date(d.at).toTimeString().slice(0, 5)}`);
      this.advance(d, now);
    }
    if (this.showing) this.advance(this.showing, now);
    this.changed(false);
    this.wake(now, schedules);
  }

  /** The times prompting now, earliest first. */
  private due(schedules: readonly StoredArti[], now: number): Showing[] {
    const out: Showing[] = [];
    for (const s of schedules) {
      if (!s.enabled || s.presentationId === null || s.presentationName === null) continue;
      const promptMs = s.promptMinutes * 60_000;
      for (const at of artiTimes(s, now - ARTI_LATE_MS + 1, now + promptMs + 1)) {
        const key = keyOf(s.id, at);
        if (at < this.startedAt || this.done.has(key)) continue;
        if (now < at - promptMs || now >= at + ARTI_LATE_MS) continue;
        const was = this.showing?.key === key ? this.showing : null;
        out.push(
          was ?? {
            key,
            scheduleId: s.id,
            name: s.name,
            presentationId: s.presentationId,
            time: s.time,
            at,
            promptMs,
            byItself: s.byItself,
            cued: false,
            byItselfAt: null,
            cancelled: false,
          },
        );
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  /** At its time: cued; going up by itself, the countdown, then up. */
  private advance(c: Showing, now: number): void {
    if (now < c.at) return;
    if (!c.cued) {
      const cued = this.deps.engine.dispatch({
        type: 'cueNext',
        presentationId: c.presentationId,
        label: c.name,
      });
      if (!cued.ok) {
        this.deps.log('warn', `Arti: could not cue its presentation (${cued.message})`);
        this.end(c, false);
        return;
      }
      c.cued = true;
    }
    // Only near its time: after the computer slept through it, the prompt asks instead.
    if (c.byItself && !c.cancelled && c.byItselfAt === null && now < c.at + ARTI_BY_ITSELF_WITHIN_MS)
      c.byItselfAt = now + ARTI_COUNTDOWN_MS;
    if (c.byItselfAt !== null && now >= c.byItselfAt) {
      const up = this.play(c);
      if (up.ok) this.deps.log('info', 'Arti: up by itself, as its schedule says');
      else this.deps.log('warn', `Arti: could not go up by itself (${up.message})`);
      this.end(c, false);
    }
  }

  /** Up now: cued first if it was not, then played. */
  private play(c: Showing): ArtiAnswer {
    const { engine } = this.deps;
    if (engine.state().cue?.presentationId !== c.presentationId) {
      const cued = engine.dispatch({ type: 'cueNext', presentationId: c.presentationId, label: c.name });
      if (!cued.ok) return { ok: false, message: cued.message };
      c.cued = true;
    }
    const up = engine.dispatch({ type: 'playCue' });
    return up.ok ? { ok: true } : { ok: false, message: up.message };
  }

  private isUp(presentationId: string): boolean {
    const state = this.deps.engine.state();
    return (
      state.live.presentationId === presentationId && state.layers.slide?.presentationId === presentationId
    );
  }

  /** The arti went up another way, or its cue went: the prompt has done its work. */
  private engineChanged(state: EngineState): void {
    const c = this.showing;
    if (!c) return;
    const cueGone = c.cued && state.cue?.presentationId !== c.presentationId;
    if (this.isUp(c.presentationId) || cueGone) {
      this.end(c, false);
      // Another time may be due straight after.
      this.soon();
    }
  }

  /** The prompt goes; with `withdraw`, so does its cue (when it is still the engine's). */
  private end(c: Showing, withdraw: boolean): void {
    if (this.showing !== c) return;
    this.showing = null;
    this.done.set(c.key, c.at);
    if (withdraw && this.deps.engine.state().cue?.presentationId === c.presentationId)
      this.deps.engine.dispatch({ type: 'clearCue' });
    this.changed(false);
  }

  private changed(schedules: boolean): void {
    if (schedules) {
      // A schedule changed: what is due may have, too.
      this.lastSent = '';
      this.soon();
    }
    const view = this.view();
    const sent = JSON.stringify(view);
    if (sent === this.lastSent) return;
    this.lastSent = sent;
    this.deps.changed(view);
  }

  private timer(ms: number, run: () => void): void {
    this.cancelTimer?.();
    const schedule =
      this.deps.schedule ??
      ((wait: number, go: () => void) => {
        const t = setTimeout(go, wait);
        return () => {
          clearTimeout(t);
        };
      });
    this.cancelTimer = schedule(ms, run);
  }

  private soon(): void {
    this.timer(0, () => {
      this.check();
    });
  }

  /** Look again when something next happens: a prompt starts, a time comes, a countdown ends, a prompt goes. */
  private wake(now: number, schedules: readonly StoredArti[]): void {
    let next = now + RECHECK_MS;
    const consider = (t: number) => {
      if (t > now && t < next) next = t;
    };
    for (const s of schedules) {
      if (!s.enabled || s.presentationName === null) continue;
      const promptMs = s.promptMinutes * 60_000;
      for (const at of artiTimes(s, now - ARTI_LATE_MS, now + promptMs + RECHECK_MS + 1)) {
        consider(at - promptMs);
        consider(at);
        consider(at + ARTI_LATE_MS);
      }
    }
    const c = this.showing;
    if (c?.byItselfAt != null) consider(c.byItselfAt);
    this.timer(Math.max(0, next - now), () => {
      this.check();
    });
  }
}
