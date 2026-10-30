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
  x: 0,
  y: 0,
  openedAt: 0,
};

function stop(): void {
  if (press.timer !== null) clearTimeout(press.timer);
  press.timer = null;
}

/** What a row spreads onto its element to have its menu. */
export function longPressProps(open: () => void) {
  return {
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      e.preventDefault();
      // The system's own long-press menu, just after ours opened: once is enough.
      if (Date.now() - press.openedAt < 1000) return;
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
      press.x = e.clientX;
      press.y = e.clientY;
      press.timer = setTimeout(() => {
        press.timer = null;
        press.openedAt = Date.now();
        open();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (press.timer === null) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) stop();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    // The finger lifting after a long press is no tap on the row.
    onClickCapture: (e: MouseEvent<HTMLElement>) => {
      if (Date.now() - press.openedAt < 800) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    'aria-keyshortcuts': 'Shift+F10',
  };
}
