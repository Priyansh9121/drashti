import { useEffect, useRef } from 'react';
import type { KeyBinding, OperatorAction } from '../../../shared/keymap';
import { actionFor, PAGE_KEYMAP } from '../../../shared/keymap';
import { useKeymapNow } from './single-keys-store';

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Run operator actions from the keyboard. Ignores key repeats (a held key
 * never skips slides), typing in fields, keys a control has used itself (the
 * arrows between tabs or through a menu: Session 15, they also moved the
 * slide on the screens), and anything while a dialog is open. B, ., L and ? only while they are on
 * (Session 37: an admin can turn the single-letter keys off).
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
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.defaultPrevented || isTyping(event.target)) return;
      const action = actionFor(event, platform, keys);
      if (!action) return;
      const dialogOpen = document.querySelector('[aria-modal="true"]') !== null;
      if (dialogOpen && action !== 'openScreens' && action !== 'uncoverControls') return;
      event.preventDefault();
      runRef.current(action);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [platform, keys]);
}
