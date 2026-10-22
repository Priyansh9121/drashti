/*
 * Audience and Stage (Session 50): two switches, each closing this computer's output windows of its kind so their
 * displays go back to the computer, and opening them again where they were. The show carries on. Both are on
 * again at every start; off is never remembered.
 */

export type ScreenSwitch = 'audience' | 'stage';
export const SCREEN_SWITCHES = ['audience', 'stage'] as const satisfies readonly ScreenSwitch[];

/** Which are on: true for on. */
export interface ScreenSwitches {
  audience: boolean;
  stage: boolean;
}

export type ScreenSwitchResult = { ok: true; switches: ScreenSwitches } | { ok: false; message: string };
