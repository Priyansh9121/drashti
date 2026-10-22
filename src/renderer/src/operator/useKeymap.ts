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
 * anything while a dialog is open but Screens and Uncover the controls.
 */
export function keyListener(
  platform: string,
  keymap: readonly KeyBinding[],
  run: (action: OperatorAction) => void,
): (event: KeyPress) => void {
  return (event) => {
    if (event.repeat || event.isComposing || event.defaultPrevented || isTyping(event.target)) return;
    const action = actionFor(event, platform, keymap);
    if (!action) return;
    const dialogOpen = document.querySelector('[aria-modal="true"]') !== null;
    if (dialogOpen && action !== 'openScreens' && action !== 'uncoverControls') return;
    event.preventDefault();
    run(action);
  };
}

/**
 * Run operator actions from the keyboard (keyListener says which presses act). B, ., L and ? only while they
 * are on (Session 37: an admin can turn the single-letter keys off).
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
