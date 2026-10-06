import type { KeyboardEvent } from 'react';

/*
 * A group of buttons with role="radio" (Session 15, accessibility): one Tab
 * stop, as a radio group has, and the arrow keys (and Home and End) move the
 * choice and the focus together. Only inside dialogs, where the show's own
 * arrow keys do nothing.
 */

/** The group's onKeyDown: choose the next or previous choice with the arrows, and focus it. */
export function radioKeys<T>(
  choices: readonly T[],
  current: T,
  choose: (choice: T) => void,
): (e: KeyboardEvent<HTMLElement>) => void {
  return (e) => {
    const i = Math.max(0, choices.indexOf(current));
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % choices.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + choices.length) % choices.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = choices.length - 1;
    const choice = choices[next];
    if (next < 0 || choice === undefined) return;
    e.preventDefault();
    choose(choice);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
}

/** Each choice's tabIndex: the chosen one is the group's Tab stop (the first when none is). */
export const radioTabIndex = (checked: boolean, index: number, anyChecked: boolean): 0 | -1 =>
  checked || (!anyChecked && index === 0) ? 0 : -1;
