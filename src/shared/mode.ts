/*
 * Simple Mode and Pro Mode (PLAN.md section 3). Simple Mode is one screen
 * with big buttons for running a sabha from a playlist; nothing in it can
 * change the library, the screens or the sound, and the main process
 * refuses such requests while it is on. Leaving it takes a deliberate step:
 * Switch to Pro Mode… (on Simple Mode's own screen, or in the View menu),
 * then typing the word below.
 */

export type OperatorMode = 'pro' | 'simple';

export const OPERATOR_MODES = ['pro', 'simple'] as const satisfies readonly OperatorMode[];

/** The word typed to leave Simple Mode (letter case does not matter). */
export const LEAVE_SIMPLE_WORD = 'pro';

/** The word was typed (spaces around it and letter case do not matter). */
export const isLeaveWord = (typed: string): boolean => typed.trim().toLowerCase() === LEAVE_SIMPLE_WORD;

export type ModeResult = { ok: true; mode: OperatorMode } | { ok: false; message: string };

/** What a request that would change something gets while Simple Mode is on. */
export const SIMPLE_MODE_REFUSAL =
  'Simple Mode is on, so this cannot be changed. On the Drashti computer, Switch to Pro Mode… leaves it.';

export const isOperatorMode = (value: unknown): value is OperatorMode =>
  value === 'pro' || value === 'simple';

/**
 * The mode Drashti starts in (Session 20). After an unexpected stop less than 3 hours before the start
 * (restart recovery's own limit, RECOVERY_MAX_AGE_MS): the mode it was in, so a volunteer in the middle
 * of a sabha carries on where they were (admin locked, as after every start). Otherwise, after a clean
 * quit or a stop longer ago (Session 21): Pro Mode, or Simple Mode with roles on (Pro Mode then takes a
 * PIN).
 */
export function startingMode(last: {
  recentStop: boolean;
  rolesOn: boolean;
  wasIn: OperatorMode;
}): OperatorMode {
  if (last.recentStop) return last.wasIn;
  return last.rolesOn ? 'simple' : 'pro';
}

/**
 * Engine commands Simple Mode refuses, wherever they come from (the window,
 * a phone, the API): Simple Mode keeps the live Look.
 */
export const SIMPLE_MODE_REFUSED_COMMANDS: readonly string[] = ['setLook'];
