import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import type * as LongPress from './long-press';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let press: typeof LongPress;
const row = () => ({}) as HTMLElement;
const pointer = (target: HTMLElement, id: number, type = 'touch', x = 0): PointerEvent<HTMLElement> =>
  ({
    currentTarget: target,
    pointerId: id,
    pointerType: type,
    clientX: x,
    clientY: 0,
  }) as PointerEvent<HTMLElement>;
const click = (target: HTMLElement) => {
  const preventDefault = vi.fn<() => void>();
  const stopPropagation = vi.fn<() => void>();
  // A partial React event: the real handler uses only these properties. Keep the spies separately typed.
  const event = {
    currentTarget: target,
    preventDefault,
    stopPropagation,
  } as unknown as MouseEvent<HTMLElement>;
  return { event, preventDefault, stopPropagation };
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  press = await import('./long-press');
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('a phone row’s long press', () => {
  it('opens after holding, suppresses its own lift click, and then lets a fresh tap through', () => {
    const target = row();
    const open = vi.fn();
    const props = press.longPressProps(open);
    props.onPointerDown(pointer(target, 1));
    vi.advanceTimersByTime(press.LONG_PRESS_MS - 1);
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledOnce();
    props.onPointerUp(pointer(target, 1));
    const lift = click(target);
    props.onClickCapture(lift.event);
    expect(lift.preventDefault).toHaveBeenCalledOnce();
    expect(lift.stopPropagation).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(801);
    const fresh = click(target);
    props.onClickCapture(fresh.event);
    expect(fresh.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores a mouse hover and another pointer’s move, lift, cancel or leave while its own finger is held', () => {
    const target = row();
    const open = vi.fn();
    const props = press.longPressProps(open);
    props.onPointerDown(pointer(target, 1));
    props.onPointerMove(pointer(target, 2, 'mouse', 100));
    props.onPointerUp(pointer(target, 2));
    props.onPointerCancel(pointer(target, 2));
    props.onPointerLeave(pointer(target, 2));
    vi.advanceTimersByTime(press.LONG_PRESS_MS);
    expect(open).toHaveBeenCalledOnce();
  });

  it('never suppresses the next click on another row', () => {
    const first = row();
    const other = row();
    const props = press.longPressProps(vi.fn());
    props.onPointerDown(pointer(first, 1));
    vi.advanceTimersByTime(press.LONG_PRESS_MS);
    const next = click(other);
    press.longPressProps(vi.fn()).onClickCapture(next.event);
    expect(next.preventDefault).not.toHaveBeenCalled();
    expect(next.stopPropagation).not.toHaveBeenCalled();
  });

  it('does not open after its own finger scrolls or lifts early, and ignores a mouse press', () => {
    const target = row();
    const open = vi.fn();
    const props = press.longPressProps(open);
    props.onPointerDown(pointer(target, 1));
    props.onPointerMove(pointer(target, 1, 'touch', 40));
    vi.advanceTimersByTime(press.LONG_PRESS_MS);
    props.onPointerDown(pointer(target, 2));
    props.onPointerUp(pointer(target, 2));
    vi.advanceTimersByTime(press.LONG_PRESS_MS);
    props.onPointerDown(pointer(target, 3, 'mouse'));
    vi.advanceTimersByTime(press.LONG_PRESS_MS);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the system menu once after a long press, while another row still gets its own menu', () => {
    const target = row();
    const open = vi.fn();
    const props = press.longPressProps(open);
    props.onPointerDown(pointer(target, 1));
    vi.advanceTimersByTime(press.LONG_PRESS_MS);
    props.onContextMenu(click(target).event);
    expect(open).toHaveBeenCalledOnce();
    const otherOpen = vi.fn();
    press.longPressProps(otherOpen).onContextMenu(click(row()).event);
    expect(otherOpen).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });

  it('offers Shift+F10 and the Menu key without consuming other keys', () => {
    const open = vi.fn();
    const props = press.longPressProps(open);
    const key = (value: string, shiftKey = false) => {
      const preventDefault = vi.fn<() => void>();
      const event = { key: value, shiftKey, preventDefault } as unknown as KeyboardEvent<HTMLElement>;
      return { event, preventDefault };
    };
    props.onKeyDown(key('F10', true).event);
    props.onKeyDown(key('ContextMenu').event);
    const letter = key('a');
    props.onKeyDown(letter.event);
    expect(open).toHaveBeenCalledTimes(2);
    expect(letter.preventDefault).not.toHaveBeenCalled();
  });
});
