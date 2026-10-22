import type { PipPlace } from './engine/state';

/*
 * Picture in picture (Session 50): where the box sits and how it looks, remembered in the library for next time.
 * The box itself is the engine's pip layer (shared/engine/state.ts PipLayer).
 */

/** Where a new box goes until the operator moves it: bottom right, Medium, with a border and rounded corners. */
export const DEFAULT_PIP_PLACE: PipPlace = {
  corner: 'bottom-right',
  x: 0,
  y: 0,
  size: 'medium',
  border: true,
  rounded: true,
  motion: 'fade',
};

export type PipSettingsResult = { ok: true; place: PipPlace } | { ok: false; message: string };
