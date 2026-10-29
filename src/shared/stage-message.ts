import { z } from 'zod';
import type { StageLayout } from './stage-layouts';

/*
 * The stage message (Session 55, Part 15), as the old program had its own: typed in the Stage screen panel (or on a
 * phone), Show puts it on every stage screen for the speaker or the anchor and Hide takes it off; never in the hall,
 * on the stream or in a phone's live picture. It shows whatever the layout: in a layout's message box, else as a
 * banner over the top of the stage screen (a layout with no message box, the Standard stage screen's own place, and
 * Stage off's audience picture). Each has its own size and, if asked, a slow flash as it comes up; the last few are a
 * tap away. The words stay the engine's `stageMessage` (an older state reads whole); the rest is `stageCall`.
 */

export type StageMessageSize = 'small' | 'standard' | 'large' | 'huge';
export const STAGE_MESSAGE_SIZES = [
  'small',
  'standard',
  'large',
  'huge',
] as const satisfies readonly StageMessageSize[];
export const STAGE_SIZE_NAMES: Record<StageMessageSize, string> = {
  small: 'Small',
  standard: 'Standard',
  large: 'Large',
  huge: 'Very large',
};
/** Each size against the standard's. */
export const STAGE_SIZE_FACTOR: Record<StageMessageSize, number> = {
  small: 0.75,
  standard: 1,
  large: 1.4,
  huge: 2,
};

/** The standard size of the banner's words on a 1080-high stage screen (the Standard stage screen's message). */
export const STAGE_MESSAGE_PX = 64;

/** How the message up was shown: its size, whether it flashes, and when it went up (the engine's clock). */
export interface StageCall {
  size: StageMessageSize;
  flash: boolean;
  shownAt: number;
}

/** How many of the last messages stay a tap away. */
export const STAGE_RECENT = 5;

/** The last messages with this one first, each once (the same words again move to the front). */
export function withRecent(recent: readonly string[] | undefined, text: string): string[] {
  return [text, ...(recent ?? []).filter((t) => t !== text)].slice(0, STAGE_RECENT);
}

/** How long a flashing stage message flashes from when it went up, and each step (one swing of light a second). */
export const STAGE_FLASH_MS = 6000;
export const STAGE_FLASH_STEP_MS = 1000;

/**
 * Whether a flashing stage message is in its other colour at `now`: for six seconds from the first whole second of
 * the engine's clock at or after it went up, on that clock's odd seconds (three times, a second each), so every
 * stage screen flashes together and the light changes at most once a second (shared/flash.ts's rules).
 */
export function stageFlashOn(call: StageCall | null | undefined, now: number): boolean {
  if (!call?.flash) return false;
  const from = Math.ceil(call.shownAt / STAGE_FLASH_STEP_MS) * STAGE_FLASH_STEP_MS;
  return now >= from && now < from + STAGE_FLASH_MS && Math.floor(now / STAGE_FLASH_STEP_MS) % 2 === 1;
}

/**
 * Whether a stage screen shows the message as a banner over it: always, but where its layout has a message box,
 * which shows it there instead.
 */
export const stageBanner = (layout: Pick<StageLayout, 'boxes'> | null | undefined): boolean =>
  !layout?.boxes.some((b) => b.kind === 'stageMessage');

/** The size and flash a stage message is asked to show with, as a window, a phone or the API sends them. */
export const stageCallSchema = z
  .object({
    size: z.enum(STAGE_MESSAGE_SIZES).optional(),
    flash: z.boolean().optional(),
  })
  .strict();
