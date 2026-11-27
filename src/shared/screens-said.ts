import { SET_UP_STAGE } from './screen-switches';
import type { ScreensSaid } from './screens';

/*
 * The screens' one line's tooltips, in a module of its own: shared/screens.ts must not import screen-switches.ts (a
 * cycle through engine/state and stage-layouts.ts, which reads screens.ts as it loads).
 */

/**
 * Each part of the line's own tooltip (the release lead's alpha.25 item 40, done in saidwords): on keyboard focus both
 * buttons had shown the line's sentence. The words (and the icon) show the whole line; the action button says what it
 * does (none while mirroring); the X says Dismiss, with the line.
 */
export function saidTips(said: Pick<ScreensSaid, 'kind' | 'text'>): {
  words: string;
  action: string | null;
  dismiss: string;
} {
  const action =
    said.kind === 'no-stage'
      ? `${SET_UP_STAGE}: opens Screens, to give a display the Stage job`
      : said.kind === 'set'
        ? 'Change…: opens Screens at this display, to give it another job'
        : null;
  return { words: said.text, action, dismiss: `Dismiss: ${said.text}` };
}
