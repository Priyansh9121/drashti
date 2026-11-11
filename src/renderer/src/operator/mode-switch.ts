import { useRef } from 'react';
import type { MouseEvent } from 'react';
import { useNotice } from './actions';

/** How soon the second press of Enter must come to count as the switch's double-click (ms). */
export const AGAIN_MS = 2000;

/**
 * A mode's switch (the owner, 11 Nov 2026: a double-click goes to Simple Mode and a double-click goes back to Pro Mode,
 * with nothing else): one click says to double-click it, and a double-click switches, with nothing asked or typed.
 * From the keyboard (Enter; Space is Next everywhere in the window), Enter twice, the second within two seconds, the
 * first saying to press it again. `name` is the button's words, which are also the mode it goes to.
 */
export function useDoubleClickSwitch(
  name: string,
  go: () => void,
): { onClick: (e: MouseEvent<HTMLButtonElement>) => void; onDoubleClick: () => void } {
  const pressedAt = useRef(-Infinity);
  const onDoubleClick = () => {
    pressedAt.current = -Infinity;
    useNotice.setState({ text: null });
    go();
  };
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    // A double-click's first click says what to do; its second waits for the double-click itself.
    if (e.detail === 1) useNotice.setState({ text: `Double-click ${name} to switch to ${name}.` });
    if (e.detail !== 0) return;
    const now = performance.now();
    if (now - pressedAt.current <= AGAIN_MS) {
      onDoubleClick();
      return;
    }
    pressedAt.current = now;
    useNotice.setState({ text: `Press Enter again to switch to ${name}.` });
  };
  return { onClick, onDoubleClick };
}
