import { goesAt, lookOf } from '../../shared/audience-timer';
import type { EngineState } from '../../shared/engine/state';
import type { EngineAction } from './actions';

/*
 * What goes off the audience screens by itself at a time (Session 55, Part 15), by the engine's clock: a message up
 * for a set time (its `until`), and a timer for the audience whose look goes by itself at zero (Countdown to the
 * start among them). The engine waits for the soonest (show-engine.ts scheduleTimed) and then takes off what is due,
 * each playing its out from the moment it was due, the same on every screen.
 */

/** The soonest moment something up goes by itself, and a key that changes whenever that moment or thing does. */
export function nextDue(state: EngineState, now: number): { at: number; key: string } | null {
  let at: number | null = null;
  let key = '';
  for (const m of state.layers.messages)
    if (m.until !== undefined && (at === null || m.until < at)) {
      at = m.until;
      key = `message:${m.id}@${String(m.until)}`;
    }
  const up = state.layers.timer;
  if (up) {
    const t = state.timers.find((x) => x.id === up.timerId);
    const zero = t ? goesAt(lookOf(t), t, now) : null;
    if (zero !== null && (at === null || zero < at)) {
      at = zero;
      key = `timer:${up.timerId}@${String(up.shownAt)}>${String(zero)}`;
    }
  }
  return at === null ? null : { at, key };
}

/** What is due by `now`: the messages whose time is up, and the timer for the audience at its zero, each from then. */
export function dueActions(state: EngineState, now: number): EngineAction[] {
  const actions: EngineAction[] = [];
  for (const m of state.layers.messages)
    if (m.until !== undefined && m.until <= now)
      actions.push({ type: 'message/hide', messageId: m.id, at: m.until });
  const up = state.layers.timer;
  if (up) {
    const t = state.timers.find((x) => x.id === up.timerId);
    const zero = t ? goesAt(lookOf(t), t, now) : null;
    if (zero !== null && zero <= now) actions.push({ type: 'timer/hide', at: zero });
  }
  return actions;
}
