/*
 * How the focus came to what has it (a25 item 1, in alpha.24 by the owner's 48-item list: the release lead's B, as
 * lead 2 scoped it): by the keyboard, or not. The keyboard's: a focus Tab or Shift+Tab gave, or a move the page made
 * from one (a "?" card's Got it, the ? again when it closes, a dialog's focus and the one it gives back after Esc). Not
 * the keyboard's: a focus a pointer's press gave (mouse, pen or touch), a move the page made from one, or one the page
 * gave before any Tab. A pointer pressed anywhere ends the keyboard's, though the focus stays where it is.
 *
 * Recorded as the focus lands, with its ring (:focus-visible) as it lands, and never read from :focus-visible at a key
 * press: Chromium turns :focus-visible on for a clicked button at the next key that goes down, Space itself too, so
 * asking then would let Space press a Black-out clicked a moment before (the risk of the item's design A).
 * useKeymap.ts reads it: Space presses a button the keyboard put the focus on, except a show control's.
 */

export interface FocusOrigin {
  /** A key went down (its `key`), before the page or the browser has acted on it. */
  keyDown(key: string): void;
  /** A pointer was pressed, anywhere. */
  pointerDown(): void;
  /** The focus landed on `el`; `ringed`: it shows its focus ring (:focus-visible) as it lands. */
  focusIn(el: unknown, ringed: boolean): void;
  /** Whether `el` has a focus the keyboard gave. */
  byKeyboard(el: unknown): boolean;
}

/**
 * A record of where the focus came from. `later` runs a function once the browser's task in hand is over: Tab moves
 * the focus in its key's own task (its default action), and a click in its press's, so a focus landing in that task
 * is theirs; one landing after is a move the page made, and takes the origin of the focus it moved from.
 */
export function focusOrigin(later: (fn: () => void) => void): FocusOrigin {
  /** What has a focus the keyboard gave (or had it last: a focus moved by the page from there is the keyboard's too). */
  let owned: unknown = null;
  let tabbing = false;
  let pointing = false;
  return {
    keyDown(key) {
      if (key !== 'Tab' || tabbing) return;
      tabbing = true;
      later(() => {
        tabbing = false;
      });
    },
    pointerDown() {
      owned = null;
      if (pointing) return;
      pointing = true;
      later(() => {
        pointing = false;
      });
    },
    focusIn(el, ringed) {
      const keyboard = !pointing && (tabbing || owned !== null);
      owned = keyboard && ringed && el !== null ? el : null;
    },
    byKeyboard(el) {
      return el !== null && el === owned;
    },
  };
}

const record = focusOrigin((fn) => {
  setTimeout(fn, 0);
});
let connections = 0;
let disconnect: (() => void) | null = null;

/**
 * Listen to the window for it (from the operator window's keys, useKeymap): its keys, pointer presses and focus
 * changes, each before anything on the page hears them (capture). Once for any number of callers; the returned
 * function ends this caller's.
 */
export function connectFocusOrigin(win: Window): () => void {
  connections++;
  if (connections === 1) {
    const onKey = (e: KeyboardEvent) => {
      record.keyDown(e.key);
    };
    const onPointer = () => {
      record.pointerDown();
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target;
      record.focusIn(el, el instanceof Element && el.matches(':focus-visible'));
    };
    win.addEventListener('keydown', onKey, true);
    win.addEventListener('pointerdown', onPointer, true);
    win.addEventListener('mousedown', onPointer, true);
    win.addEventListener('focusin', onFocus, true);
    disconnect = () => {
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('pointerdown', onPointer, true);
      win.removeEventListener('mousedown', onPointer, true);
      win.removeEventListener('focusin', onFocus, true);
    };
  }
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    connections--;
    if (connections === 0) {
      disconnect?.();
      disconnect = null;
    }
  };
}

/** Whether `el` has a focus the keyboard gave, in the window connected. */
export function isKeyboardFocused(el: unknown): boolean {
  return record.byKeyboard(el);
}
