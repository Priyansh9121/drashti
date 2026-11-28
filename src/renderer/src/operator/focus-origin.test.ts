import { describe, expect, it } from 'vitest';
import { focusOrigin } from './focus-origin';

/*
 * How the focus came to what has it (a25 item 1, the release lead's B as lead 2 scoped it): by the keyboard (Tab or
 * Shift+Tab, or a move the page made from a focus the keyboard gave), or not (a pointer's press, or a move the page made
 * from one). Recorded as the focus lands, never read from :focus-visible at a key press (Chromium turns that on for a
 * clicked button at the next key pressed). The window's events are stood in for: `endTask` is the end of the browser's
 * task that the key or the press came in (its default action, Tab's move, in it).
 */

function origin() {
  const tasks: (() => void)[] = [];
  const o = focusOrigin((fn) => tasks.push(fn));
  const endTask = () => {
    for (let fn = tasks.shift(); fn; fn = tasks.shift()) fn();
  };
  return { o, endTask };
}

const el = (name: string) => ({ name });

describe('where the focus came from', () => {
  it('is the keyboard’s after Tab or Shift+Tab, as the focus lands with its ring', () => {
    const { o, endTask } = origin();
    const ask = el('What is this? Stream');
    o.keyDown('Tab');
    o.focusIn(ask, true);
    endTask();
    expect(o.byKeyboard(ask)).toBe(true);
    const back = el('Help');
    o.keyDown('Tab'); // Shift+Tab is Tab's key too
    o.focusIn(back, true);
    endTask();
    expect(o.byKeyboard(back)).toBe(true);
    expect(o.byKeyboard(ask)).toBe(false);
  });

  it('is never the keyboard’s after a pointer’s press, even when a key goes down later on it', () => {
    const { o, endTask } = origin();
    const blackout = el('Black-out');
    o.pointerDown();
    o.focusIn(blackout, false);
    endTask();
    expect(o.byKeyboard(blackout)).toBe(false);
    // → after the click: Chromium shows the ring now, but the focus is still the pointer's.
    o.keyDown('ArrowRight');
    endTask();
    o.keyDown(' ');
    expect(o.byKeyboard(blackout)).toBe(false);
  });

  it('stops being the keyboard’s when a pointer is pressed, wherever, though the focus stays', () => {
    const { o, endTask } = origin();
    const ask = el('What is this? LIVE');
    o.keyDown('Tab');
    o.focusIn(ask, true);
    endTask();
    o.pointerDown(); // on the same button (no new focus), or on the page
    endTask();
    expect(o.byKeyboard(ask)).toBe(false);
  });

  it('follows a move the page makes: the keyboard’s from a keyboard focus, the pointer’s from a pointer’s', () => {
    const { o, endTask } = origin();
    // The keyboard opens a "?" card: its Got it takes the focus (autoFocus), then gives it back to the ?.
    const ask = el('?');
    const gotIt = el('Got it');
    o.keyDown('Tab');
    o.focusIn(ask, true);
    endTask();
    o.keyDown(' ');
    endTask();
    o.focusIn(gotIt, true);
    expect(o.byKeyboard(gotIt)).toBe(true);
    o.keyDown(' ');
    endTask();
    o.focusIn(ask, true);
    expect(o.byKeyboard(ask)).toBe(true);
    // The pointer opens one: its Got it, then the ? again, are the pointer's.
    o.pointerDown();
    o.focusIn(ask, false);
    endTask();
    o.focusIn(gotIt, true);
    expect(o.byKeyboard(gotIt)).toBe(false);
    o.focusIn(ask, false);
    expect(o.byKeyboard(ask)).toBe(false);
  });

  it('keeps its origin when Esc closes a dialog and the focus goes back to what opened it', () => {
    // Opened by a click (what-is-this.spec's Open the manual): after Esc, Space is the show's again.
    const clicked = origin();
    const opener = el('Open the manual');
    clicked.o.pointerDown();
    clicked.o.focusIn(opener, false);
    clicked.endTask();
    clicked.o.focusIn(el('the manual'), true);
    clicked.o.keyDown('Escape');
    clicked.o.focusIn(opener, true);
    clicked.endTask();
    expect(clicked.o.byKeyboard(opener)).toBe(false);
    // Opened from the keyboard: still the keyboard's.
    const typed = origin();
    typed.o.keyDown('Tab');
    typed.o.focusIn(opener, true);
    typed.endTask();
    typed.o.focusIn(el('the manual'), true);
    typed.o.keyDown('Escape');
    typed.o.focusIn(opener, true);
    typed.endTask();
    expect(typed.o.byKeyboard(opener)).toBe(true);
  });

  it('is not the keyboard’s for a focus the page gives before any Tab (Playwright’s focus(), a start)', () => {
    const { o } = origin();
    const heading = el('Messages');
    o.focusIn(heading, true);
    expect(o.byKeyboard(heading)).toBe(false);
  });

  it('is not the keyboard’s for a focus that lands without its ring', () => {
    const { o, endTask } = origin();
    const row = el('row');
    o.keyDown('Tab');
    o.focusIn(row, false);
    endTask();
    expect(o.byKeyboard(row)).toBe(false);
    expect(o.byKeyboard(null)).toBe(false);
  });
});
