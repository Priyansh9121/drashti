import { beforeEach, describe, expect, it } from 'vitest';
import { jumpKeyDown, setJumpRows, useJump, type JumpKey } from './jump';

/*
 * Jump by number (Session 55, Part 4, the owner's idea N): with no field chosen, typing a row's number and Enter puts
 * that row up; the number shows while it is typed, Esc takes it away, and so does any other key (which then does what
 * it always does). Nothing acts while a dialog or a menu is open, or with Cmd, Ctrl or Alt held.
 */

const went: number[] = [];

const key = (k: string, over: Partial<JumpKey> = {}): JumpKey & { taken: boolean } => {
  const e = {
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    typing: false,
    blocked: false,
    taken: false,
    ...over,
  };
  return e;
};

/** Press a key: whether the jump took it (its default and the rest of the window's keys kept from it). */
const press = (k: string, over: Partial<JumpKey> = {}): boolean => jumpKeyDown(key(k, over));

beforeEach(() => {
  went.length = 0;
  useJump.setState({ typed: '', missed: null });
  setJumpRows(
    [1, 2, 3, 12, 40].map((number) => ({
      number,
      go: () => {
        went.push(number);
      },
    })),
  );
});

describe('jump by number', () => {
  it('puts up the row whose number is typed, at Enter, showing the number as it is typed', () => {
    expect(press('1')).toBe(true);
    expect(useJump.getState().typed).toBe('1');
    expect(press('2')).toBe(true);
    expect(useJump.getState().typed).toBe('12');
    expect(press('Enter')).toBe(true);
    expect(went).toEqual([12]);
    expect(useJump.getState().typed).toBe('');
  });

  it('Esc takes the number away and puts nothing up; Backspace takes its last digit', () => {
    press('4');
    press('0');
    expect(press('Backspace')).toBe(true);
    expect(useJump.getState().typed).toBe('4');
    expect(press('Escape')).toBe(true);
    expect(useJump.getState().typed).toBe('');
    // With nothing typed, Enter, Esc and Backspace are the window's as always.
    expect(press('Enter')).toBe(false);
    expect(press('Escape')).toBe(false);
    expect(press('Backspace')).toBe(false);
    expect(went).toEqual([]);
  });

  it('a number with no row says so and puts nothing up', () => {
    press('9');
    press('Enter');
    expect(went).toEqual([]);
    expect(useJump.getState().missed).toBe(9);
  });

  it('any other key takes the number away and does what it always does', () => {
    press('3');
    expect(press('ArrowRight')).toBe(false);
    expect(useJump.getState().typed).toBe('');
    press('Enter');
    expect(went).toEqual([]);
  });

  it('never acts while typing in a field, under a dialog or a menu, on a held key, or with Cmd, Ctrl or Alt', () => {
    expect(press('1', { typing: true })).toBe(false);
    expect(press('1', { blocked: true })).toBe(false);
    expect(press('1', { repeat: true })).toBe(false);
    expect(press('1', { metaKey: true })).toBe(false);
    expect(press('1', { ctrlKey: true })).toBe(false);
    expect(press('1', { altKey: true })).toBe(false);
    expect(useJump.getState().typed).toBe('');
  });

  it('takes four digits at most', () => {
    for (const d of ['1', '2', '3', '4', '5']) press(d);
    expect(useJump.getState().typed).toBe('1234');
  });
});
