import type { EngineCommand } from './engine/commands';
import type { EngineState } from './engine/state';

/*
 * Simple Mode and Pro Mode (PLAN.md section 3). Simple Mode (Session 55, Part 18: for a small sabha, or anywhere
 * with one projector) is Pro Mode's window with everything taken out but one playlist, bringing things into it (Add
 * files…, files dropped, From a Link…), the wallpapers, Next and Back, Clear all, Black-out, the Wallpaper and the time
 * bar, and a row's Rename and Delete; the main process refuses everything else while it is on (main/simple-mode.ts),
 * and a paired phone may do only what that window does (main/simple-mode-phones.ts, the owner's answer of 30 Oct
 * 2026). Leaving it takes a deliberate step with nothing to type (the owner's answer to question 12, changed on 29 Oct
 * 2026): a double-click on Pro Mode at the top of its window, or View › Switch to Pro Mode. Never a PIN (Session 54,
 * E5: roles and PINs are gone): it is a way of working, not a lock, but with Simple access (Part 19) it is all this
 * computer may use.
 */

export type OperatorMode = 'pro' | 'simple';

export const OPERATOR_MODES = ['pro', 'simple'] as const satisfies readonly OperatorMode[];

export type ModeResult = { ok: true; mode: OperatorMode } | { ok: false; message: string };

/** The way out of Simple Mode, as its refusals say it (on a phone too, so "the Drashti computer"). */
export const SIMPLE_MODE_WAY_OUT = 'On the Drashti computer, a double-click on Pro Mode leaves it.';

/** What a request that would change something gets while Simple Mode is on. */
export const SIMPLE_MODE_REFUSAL = `Simple Mode is on, so this cannot be changed. ${SIMPLE_MODE_WAY_OUT}`;

/**
 * A file Simple Mode's import leaves out (Session 55, Part 18): it brings in what its one playlist plays, nothing a
 * presentation, a playlist or the library's setup is made of (lyrics, the other program's files, a Shastra text, a
 * calendar).
 */
export const SIMPLE_IMPORT_LEFT_OUT =
  'Simple Mode brings in sounds, videos, pictures, PDFs and PowerPoint or Keynote decks, so this was left out.';

/**
 * The same while this computer's access is Simple Mode only (Session 55, the owner's decision of 29 Oct 2026): no way
 * to Pro Mode is offered, in words either.
 */
export const SIMPLE_ACCESS_LOCKED_REFUSAL =
  'Simple Mode is on, and this computer’s access is Simple Mode only, so this cannot be changed here.';

/** Leaving Simple Mode, asked with Simple access: refused, saying why and who can change it. */
export const SIMPLE_ACCESS_REFUSAL =
  'This computer’s access is Simple Mode only, so Pro Mode is not available here. The person who approves access can give it Pro access.';

/** Simple Mode's refusal, in words true for this computer's access. */
export const simpleRefusalText = (simpleOnly: boolean): string =>
  simpleOnly ? SIMPLE_ACCESS_LOCKED_REFUSAL : SIMPLE_MODE_REFUSAL;

/** How a phone's refusal starts while Drashti's computer is in Simple Mode (Session 55). */
export const SIMPLE_PHONE_REFUSAL_START = 'Simple Mode on Drashti’s computer';

/**
 * What a paired phone is told when it asks for what Simple Mode's window does not do (Session 55, the owner's answer
 * of 30 Oct 2026: a phone does only what that window does; main/simple-mode-phones.ts), naming Simple Mode's one
 * playlist when it has one, so the phone can choose it: with Pro access the window's own way out, word for word; with
 * Simple access (Part 19) that the access is Simple Mode only, and no way to Pro Mode. What the window is refused too
 * keeps the window's own words (simpleRefusalText).
 */
export function simplePhoneRefusalText(simpleOnly: boolean, playlist: string | null): string {
  const does = `a phone does only what Simple Mode does there (its playlist${playlist === null ? '' : ` “${playlist}”`}, Next and Back, Clear all, Black-out and the Wallpaper)`;
  return simpleOnly
    ? `${SIMPLE_PHONE_REFUSAL_START}, whose access is Simple Mode only: ${does}.`
    : `${SIMPLE_PHONE_REFUSAL_START}: ${does}. ${SIMPLE_MODE_WAY_OUT}`;
}

export const isOperatorMode = (value: unknown): value is OperatorMode =>
  value === 'pro' || value === 'simple';

/**
 * The mode Drashti starts in (Session 20). After an unexpected stop less than 3 hours before the start
 * (restart recovery's own limit, RECOVERY_MAX_AGE_MS): the mode it was in, so a volunteer in the middle
 * of a sabha carries on where they were. Otherwise, after a clean quit or a stop longer ago (Session 21):
 * Pro Mode.
 */
export function startingMode(last: { recentStop: boolean; wasIn: OperatorMode }): OperatorMode {
  return last.recentStop ? last.wasIn : 'pro';
}

/**
 * Engine commands Simple Mode refuses, wherever they come from (the window,
 * a phone, the API): a picture-in-picture box is set up, swapped and moved in Pro Mode only (Session 50; Take off and
 * Clear all still take one off); Simple Mode does not choose a video
 * input (Session 50: Pro Mode's Media puts one up; Simple Mode may clear it,
 * as any background); and Simple Mode shows the time bar but never moves what
 * plays (Session 54): neither the bar's move nor Back 15 s, Forward 15 s and
 * Last 10 s. The bar's Pause is refused too, but on the audio layer
 * (simpleModeRefuses), and its Play never is. The live zoom is Simple Mode's
 * too since Session 55 (Part 5: pinch, drag, a double tap to reset, from the
 * window and a phone); keeping it as the picture's own stays Pro Mode's.
 */
export const SIMPLE_MODE_REFUSED_COMMANDS: readonly string[] = [
  'showPip',
  'swapPip',
  'placePip',
  'showInput',
  // LIVE's one press for the chosen video input (Session 55), as showInput.
  'toggleInput',
  'moveTo',
  'skip',
];

/**
 * Whether Simple Mode refuses an engine command (the engine's refuse option, src/main/index.ts), with the show as it is
 * (`state`): those listed above, and the time bar's Pause (Session 54's review: Simple Mode shows the bar and moves
 * nothing), but an audio playlist's track's, which is Music's own (Simple Mode's Pause music). A single sound's is
 * refused too: Simple Mode's window could never play it on (its bar has no Play, its music strip only knows the
 * music). The bar's Play is never refused, so nothing paused can stay paused there.
 */
export function simpleModeRefuses(
  command: EngineCommand,
  state: Pick<EngineState, 'layers'> | null,
): boolean {
  if (SIMPLE_MODE_REFUSED_COMMANDS.includes(command.type)) return true;
  return (
    command.type === 'pausePlaying' &&
    (command.playing.layer !== 'audio' || state?.layers.audio?.music === undefined)
  );
}
