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
 * quit or a stop longer ago (Session 21): Pro Mode, with roles on too (Session 46: as the operator, admin
 * locked, with no PIN asked; until then Simple Mode, Pro Mode taking a PIN). Roles held locked (the PIN
 * file could not be read) start in Simple Mode before this is asked (src/main/index.ts).
 */
export function startingMode(last: { recentStop: boolean; wasIn: OperatorMode }): OperatorMode {
  return last.recentStop ? last.wasIn : 'pro';
}

/**
 * Engine commands Simple Mode refuses, wherever they come from (the window,
 * a phone, the API): Simple Mode keeps the live Look, and a picture-in-picture
 * box is set up, swapped and moved in Pro Mode only (Session 50; Take off and
 * Clear all still take one off).
 */
export const SIMPLE_MODE_REFUSED_COMMANDS: readonly string[] = [
  'setLook',
  'zoomLive',
  'resetLiveZoom',
  'showPip',
  'swapPip',
  'placePip',
];
