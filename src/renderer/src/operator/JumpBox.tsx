import { useEffect } from 'react';
import { usePractice } from '../practice/practice-store';
import { Kbd } from '../ui/Kbd';
import { clearJump, jumpKeyDown, useJump } from './jump';
import { isTyping } from './useKeymap';

/*
 * Jump by number's keys and its box (Session 55, Part 4): the number typed shows over the middle's top while it is
 * typed, with Enter and Esc; a number with no row says so for a moment. The keys are heard before the window's own
 * (a row with the keyboard would take Enter as a click, and Esc and Backspace have their own work).
 */

export function JumpBox() {
  const typed = useJump((s) => s.typed);
  const missed = useJump((s) => s.missed);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const blocked =
        usePractice.getState().on || document.querySelector('[aria-modal="true"], [role="menu"]') !== null;
      const took = jumpKeyDown({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        repeat: e.repeat,
        isComposing: e.isComposing,
        typing: isTyping(e.target),
        blocked,
      });
      if (!took) return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Heard first, on the way down: before a row's own keys and the window's.
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      clearJump();
    };
  }, []);
  // A number with no row is said for a moment.
  useEffect(() => {
    if (missed === null) return;
    const t = setTimeout(() => {
      useJump.setState({ missed: null });
    }, 3000);
    return () => {
      clearTimeout(t);
    };
  }, [missed]);
  if (typed === '' && missed === null) return null;
  return (
    <div
      role="status"
      data-testid="jump-box"
      className="pointer-events-none fixed top-20 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-line-strong bg-panel-2 px-4 py-2 text-sm shadow-overlay"
    >
      {typed !== '' ? (
        <span className="flex items-center gap-2">
          <span className="text-muted">Row</span>
          <span className="text-2xl font-bold tabular-nums" data-testid="jump-number">
            {typed}
          </span>
          <span className="text-muted">
            <Kbd>Enter</Kbd> puts it up · <Kbd>Esc</Kbd> cancels
          </span>
        </span>
      ) : (
        <span data-testid="jump-missed">No row {missed} here.</span>
      )}
    </div>
  );
}
