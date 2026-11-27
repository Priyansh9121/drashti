import { useEffect, useRef } from 'react';
import type { KeyBinding, KeyInput, OperatorAction } from '../../../shared/keymap';
import { actionFor, latinKey, PAGE_KEYMAP, quickSlotFor } from '../../../shared/keymap';
import { useKeymapNow } from './single-keys-store';

export function isTyping(target: unknown): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** What shortcutKey reads of a press: a KeyboardEvent's parts, or React's (its native event says if an IME composes). */
export interface ShortcutPress {
  key: string;
  code?: string;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
  target?: unknown;
}

/**
 * The key a window's own shortcut reads, outside the keymap (alpha.24, hunt S3-3: the slide editor's Save, Find, Undo
 * and Redo, the Access List's Find, Adjust the picture's Undo, a list's Select all): the press's own key; or, with a
 * keyboard layout of another script (a Gujarati or Hindi layout's Ctrl with the S key says "સ"), the Latin letter,
 * digit or "." in its place on the keyboard, as the keymap reads it (latinKey: only another script's single letter,
 * mark, digit or stop on a letter, digit or full stop key). Never while typing in a field or an editable box, nor
 * during an IME's composition. A Latin layout's press is always its own key, nothing else asked of it.
 */
export function shortcutKey(e: ShortcutPress): string {
  const latin = latinKey(e);
  if (latin === e.key) return e.key;
  const composing = e.isComposing === true || e.nativeEvent?.isComposing === true;
  const typing = e.target !== undefined && e.target !== null && isTyping(e.target);
  return composing || typing ? e.key : latin;
}

/** What the window's listener reads of a key press: a KeyboardEvent's parts (a test's stand-in has only these). */
export interface KeyPress extends KeyInput {
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
  target: unknown;
  preventDefault(): void;
}

/**
 * The window's keydown listener: a press runs its action once, and is taken (its default prevented) when it
 * does. Ignores key repeats (a held key never skips slides), typing in fields, keys a control has used itself
 * (the arrows between tabs or through a menu: Session 15, they also moved the slide on the screens), and
 * anything while a dialog is open but Screens and Uncover the controls. A key the application menu shows (the
 * keymap's shownInMenu: ⌘1 and ⌘2, Session 51) is taken even when it is let go by, so the Mac's menu, which acts
 * on any key it shows that the page leaves alone, never acts on it as well.
 */
export function keyListener(
  platform: string,
  keymap: readonly KeyBinding[],
  run: (action: OperatorAction, slot?: number) => void,
): (event: KeyPress) => void {
  return (event) => {
    if (event.defaultPrevented) return;
    const action = actionFor(event, platform, keymap);
    if (!action) return;
    const dialogOpen = () => document.querySelector('[aria-modal="true"]') !== null;
    const letGo =
      event.repeat ||
      event.isComposing ||
      isTyping(event.target) ||
      (action !== 'openScreens' && action !== 'uncoverControls' && dialogOpen());
    if (!letGo) {
      event.preventDefault();
      // The quick bar's keys (Session 55, Part 8) say which pin: Alt+1 the first.
      if (action === 'quickBar') {
        const slot = quickSlotFor(event);
        if (slot !== null) run(action, slot);
      } else run(action);
    } else if (keymap.some((b) => b.action === action && b.shownInMenu === true)) event.preventDefault();
  };
}

/**
 * Run operator actions from the keyboard (keyListener says which presses act). B, . and ? only while they
 * are on (Session 37: the single-letter keys can be turned off, in the keys sheet).
 */
export function useKeymap(
  platform: string,
  run: (action: OperatorAction, slot?: number) => void,
  keymap: readonly KeyBinding[] = PAGE_KEYMAP,
): void {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const keys = useKeymapNow(keymap);
  useEffect(() => {
    const onKey = keyListener(platform, keys, (action, slot) => {
      runRef.current(action, slot);
    });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [platform, keys]);
}
