import { useEffect, useRef } from 'react';
import type { KeyBinding, KeyInput, OperatorAction } from '../../../shared/keymap';
import { actionFor, PAGE_KEYMAP } from '../../../shared/keymap';
import { useKeymapNow } from './single-keys-store';

export function isTyping(target: unknown): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
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
  run: (action: OperatorAction) => void,
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
      run(action);
    } else if (keymap.some((b) => b.action === action && b.shownInMenu === true)) event.preventDefault();
  };
}

/**
 * Run operator actions from the keyboard (keyListener says which presses act). B, ., L and ? only while they
 * are on (Session 37: the single-letter keys can be turned off, in the keys sheet).
 */
export function useKeymap(
  platform: string,
  run: (action: OperatorAction) => void,
  keymap: readonly KeyBinding[] = PAGE_KEYMAP,
): void {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const keys = useKeymapNow(keymap);
  useEffect(() => {
    const onKey = keyListener(platform, keys, (action) => {
      runRef.current(action);
    });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [platform, keys]);
}
