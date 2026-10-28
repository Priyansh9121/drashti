import type { PipCorner, PipPlace, PipSize } from './engine/state';
import type { Movement } from './looks';

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

/** How long the box takes going out, and each half of a swap, by a group's Movement (ms; render/pip.ts). */
export const PIP_OUT_MS: Record<Movement, number> = { calm: 250, bold: 300 };

/**
 * How long a swap runs on the slowest of these groups' screens (Session 51): out, then in again, by each one's
 * Movement, Calm for a group the Look does not name. The engine takes no other Swap meanwhile.
 */
export const pipSwapMs = (movements: readonly Movement[]): number =>
  2 * Math.max(PIP_OUT_MS.calm, ...movements.map((m) => PIP_OUT_MS[m]));

/** The box's corners in words, as Picture in Picture… and a phone's sheet name them (Session 54: the phone too). */
export const PIP_CORNER_NAMES: Record<PipCorner, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

/** The box's sizes in words, with how wide each is. */
export const PIP_SIZE_NAMES: Record<PipSize, { label: string; hint: string }> = {
  small: { label: 'Small', hint: 'A quarter of the width' },
  medium: { label: 'Medium', hint: 'A third of the width' },
  large: { label: 'Large', hint: 'Two fifths of the width' },
};
