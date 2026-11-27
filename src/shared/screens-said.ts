import { SET_UP_STAGE } from './screen-switches';
import type { ScreensSaid } from './screens';

/*
 * The screens' one line's tooltips, in a module of its own: shared/screens.ts must not import screen-switches.ts (a
 * cycle through engine/state and stage-layouts.ts, which reads screens.ts as it loads).
 */

/** What each action button does, in words (its tooltip after its name, and its description). */
const DOES = {
  'no-stage': 'opens Screens, to give a display the Stage job',
  set: 'opens Screens at this display, to give it another job',
} as const;

/**
 * Each part of the line's own tooltip (the release lead's alpha.25 item 40, done in saidwords): on keyboard focus both
 * buttons had shown the line's sentence. The words (and the icon) show the whole line; the action button says what it
 * does (none while mirroring); the X says Dismiss, with the line. And what the action button does as its description
 * for screen readers (alpha.25 item 48, in alpha.24: lead 2's statusbar), its tooltip having reached the eye only:
 * "Opens Screens, to give a display the Stage job.", never its name again.
 */
export function saidTips(said: Pick<ScreensSaid, 'kind' | 'text'>): {
  words: string;
  action: string | null;
  described: string | null;
  dismiss: string;
} {
  const does = said.kind === 'mirroring' ? null : DOES[said.kind];
  const name = said.kind === 'no-stage' ? SET_UP_STAGE : 'Change…';
  return {
    words: said.text,
    action: does === null ? null : `${name}: ${does}`,
    described: does === null ? null : `${does.charAt(0).toUpperCase()}${does.slice(1)}.`,
    dismiss: `Dismiss: ${said.text}`,
  };
}
