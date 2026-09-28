import { useEffect, useRef } from 'react';
import type { OperatorAction } from '../../../shared/keymap';
import { actionFor, PAGE_KEYMAP } from '../../../shared/keymap';

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Run operator actions from the keyboard. Ignores key repeats (a held key
 * never skips slides), typing in fields, and anything while a dialog is open.
 */
export function useKeymap(platform: string, run: (action: OperatorAction) => void): void {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || isTyping(event.target)) return;
      const action = actionFor(event, platform, PAGE_KEYMAP);
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
  }, [platform]);
}
