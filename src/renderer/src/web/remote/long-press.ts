import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';

/*
 * A long press on a phone or tablet (Session 55, Part 9), as the operator window's one right-click menu has it
 * (files/FileMenu.tsx fileMenuProps, Part 14): a finger held still on a row for a moment opens its menu, and its lift is
 * no tap on the row (which would put the row up). The same menu opens by a right-click (Android's own long press is
 * one too, said once), and from a tablet's keyboard by Shift+F10 or the Menu key.
 */

/** How long a finger held on a row opens its menu (as the window's). */
export const LONG_PRESS_MS = 550;
/** How far a finger may move and still be a long press (px): more, and it is a scroll. */
const SLOP = 10;

const press = {
  timer: null as ReturnType<typeof setTimeout> | null,
  /** The finger (or pen) held: another pointer (a mouse's hover, a second finger) never ends its press. */
  pointerId: -1,
  x: 0,
  y: 0,
  /** When a long press last opened a menu, and on what: its own lift (and the system's menu) are no tap there. */
  openedAt: 0,
  openedOn: null as EventTarget | null,
};

/** Whether this element's long press opened its menu within `ms`. */
const justOpened = (on: EventTarget, ms: number): boolean =>
  press.openedOn === on && Date.now() - press.openedAt < ms;

function stop(): void {
  if (press.timer !== null) clearTimeout(press.timer);
  press.timer = null;
}

/** The held finger lifted, cancelled or left: its press ends (another pointer's events are not its). */
function stopFor(e: PointerEvent<HTMLElement>): void {
  if (e.pointerId === press.pointerId) stop();
}

/** What a row spreads onto its element to have its menu. */
export function longPressProps(open: () => void) {
  return {
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      e.preventDefault();
      // The system's own long-press menu, just after ours opened: once is enough.
      if (justOpened(e.currentTarget, 1000)) return;
      open();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
      e.preventDefault();
      open();
    },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      stop();
      press.pointerId = e.pointerId;
      press.x = e.clientX;
      press.y = e.clientY;
      const on = e.currentTarget;
      press.timer = setTimeout(() => {
        press.timer = null;
        press.openedAt = Date.now();
        press.openedOn = on;
        open();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (press.timer === null || e.pointerId !== press.pointerId) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) stop();
    },
    onPointerUp: stopFor,
    onPointerCancel: stopFor,
    onPointerLeave: stopFor,
    // The finger lifting after a long press is no tap on the row.
    onClickCapture: (e: MouseEvent<HTMLElement>) => {
      if (justOpened(e.currentTarget, 800)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    'aria-keyshortcuts': 'Shift+F10',
  };
}
