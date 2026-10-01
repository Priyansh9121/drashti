/*
 * Simple Mode and Pro Mode (PLAN.md section 3). Simple Mode is one screen
 * with big buttons for running a sabha from a playlist; nothing in it can
 * change the library, the screens or the sound, and the main process
 * refuses such requests while it is on. Leaving it takes a deliberate step:
 * View > Switch to Pro Mode…, then typing the word below.
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
  'Simple Mode is on, so this cannot be changed. An admin can switch to Pro Mode from the View menu.';

export const isOperatorMode = (value: unknown): value is OperatorMode =>
  value === 'pro' || value === 'simple';
