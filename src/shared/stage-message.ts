import { z } from 'zod';
import { contrastRatio, WORDS_CONTRAST_MIN } from './contrast';
import type { StageLayout } from './stage-layouts';

/*
 * The stage message (Session 55, Part 15), as the old program had its own: typed in the Stage screen panel (or on a
 * phone), Show puts it on every stage screen for the speaker or the anchor and Hide takes it off; never in the hall,
 * on the stream or in a phone's live picture. It shows whatever the layout: in a layout's message box, else as a
 * banner over the top of the stage screen (a layout with no message box, the Standard stage screen's own place, and
 * Stage off's audience picture). Each has its own size and, if asked, a slow flash as it comes up; the last few are a
 * tap away. The words stay the engine's `stageMessage` (an older state reads whole); the rest is `stageCall`.
 *
 * Its colours (the owner, 24 Nov 2026): the box's and the words', chosen in the Stage screen panel, travel in the call
 * (`boxColor`, `textColor`, each left out for amber and black, as it always was: a phone, Simple Mode, the API and OSC
 * send none). They are only added to the call, so the engine's state keeps its version: a node or a page of the
 * version before reads the call whole and draws its own amber and black, as it always did.
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

/**
 * How the message up was shown: its size, whether it flashes, when it went up (the engine's clock) and, if chosen,
 * its box's and its words' colours (#rrggbb; left out: amber and black).
 */
export interface StageCall {
  size: StageMessageSize;
  flash: boolean;
  shownAt: number;
  boxColor?: string;
  textColor?: string;
}

/** The stage message's colours as it always was: an amber box with black words. */
export const STAGE_BOX_COLOR = '#f5a524';
export const STAGE_TEXT_COLOR = '#000000';
/** The flash's other colour: white (amber for a box white would hardly show on). */
export const STAGE_FLASH_COLOR = '#ffffff';

/** A colour the stage message is given: #rrggbb. */
export const stageColorSchema = z.string().regex(/^#[0-9a-f]{6}$/iu, 'a colour as #rrggbb');

/** A few colours that read well from the stage (each pair 4.5 to 1 or more), the first as it always was. */
export const STAGE_COLOR_PRESETS = [
  { id: 'amber', name: 'Amber, black words', box: STAGE_BOX_COLOR, text: STAGE_TEXT_COLOR },
  { id: 'white', name: 'White, black words', box: '#ffffff', text: '#000000' },
  { id: 'black', name: 'Black, white words', box: '#000000', text: '#ffffff' },
  { id: 'red', name: 'Red, white words', box: '#b91c1c', text: '#ffffff' },
  { id: 'blue', name: 'Blue, white words', box: '#1d4ed8', text: '#ffffff' },
  { id: 'green', name: 'Green, black words', box: '#22c55e', text: '#000000' },
] as const;

/** Whether words in `text` read on `box` from the stage: 4.5 to 1 or more (shared/contrast.ts's rule for words). */
export const stageColorsRead = (box: string, text: string): boolean =>
  contrastRatio(box, text) >= WORDS_CONTRAST_MIN;

/** Words that read on `background`: `text` where it does, else black or white, whichever reads better. */
export function readableOn(text: string, background: string): string {
  if (stageColorsRead(background, text)) return text;
  return contrastRatio('#000000', background) >= contrastRatio('#ffffff', background) ? '#000000' : '#ffffff';
}

/**
 * The flash's other colour for a box: white, or amber where the box is so light white would hardly show on it
 * (less than 1.5 to 1 apart: a white box).
 */
export const stageFlashColor = (box: string): string =>
  contrastRatio(box, STAGE_FLASH_COLOR) < 1.5 ? STAGE_BOX_COLOR : STAGE_FLASH_COLOR;

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
 * The message's box and words colours at `now`: its call's (left out, amber; and black words, or `words`, a layout
 * box's own), and while it flashes, its flash colour (stageFlashColor) with words that read on it: the chosen words'
 * colour where it does, else black or white. A message with no colours flashes white with its words as they were.
 */
export function stageMessageLook(
  call: StageCall | null | undefined,
  now: number,
  words: string = STAGE_TEXT_COLOR,
): { background: string; color: string } {
  const box = call?.boxColor ?? STAGE_BOX_COLOR;
  const text = call?.textColor ?? words;
  if (!stageFlashOn(call, now)) return { background: box, color: text };
  const flash = stageFlashColor(box);
  return { background: flash, color: call?.textColor === undefined ? text : readableOn(text, flash) };
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
