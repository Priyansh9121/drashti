import type { Input } from 'electron';
import { actionFor, KEYMAP } from '../shared/keymap';

/*
 * ⌘1 and ⌘2 beside View › Audience and Stage (Session 51) are the operator window's keys, and it takes every press
 * of them itself. A Mac menu acts on any key it shows that a page leaves alone (registerAccelerator, which keeps
 * Windows' menu from binding them, is not the Mac's). So away from the operator window: Window for Zoom…, whose
 * page has no keys, stops them before its page and the menu see them (isShownMenuKey, for its before-input-event);
 * and under one of the system's own boxes (a question, a file dialog), where the Mac's menu still answers them, a
 * choice of the same item within REPEAT_CHOICE_MS of the last is a held key repeating, and goes by (choiceGuard).
 * Wherever a press comes from, it acts once.
 */

/** The keymap's keys an application menu shows and leaves to the operator window. */
const SHOWN = KEYMAP.filter((b) => b.shownInMenu === true);

/** Whether a key press, as before-input-event gives it, is one of those keys going down (held or not). */
export function isShownMenuKey(
  input: Pick<Input, 'type' | 'key' | 'meta' | 'control' | 'alt' | 'shift'>,
  platform: string,
): boolean {
  if (input.type !== 'keyDown') return false;
  const press = {
    key: input.key,
    metaKey: input.meta,
    ctrlKey: input.control,
    altKey: input.alt,
    shiftKey: input.shift,
  };
  return actionFor(press, platform, SHOWN) !== null;
}

/** How soon the same menu item chosen again is a held key repeating: no one chooses a menu item twice so fast. */
export const REPEAT_CHOICE_MS = 700;

/**
 * A menu item's choices told from a held key's repeats: true for a choice to act on, false for one within `gapMs`
 * of the choice before it, acted on or not, so a key held however long acts once.
 */
export function choiceGuard(gapMs: number, now: () => number = () => Date.now()): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const at = now();
    const acts = at - last >= gapMs;
    last = at;
    return acts;
  };
}
