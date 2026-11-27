import { describe, expect, it, vi } from 'vitest';
import { NodeQuit } from './node-quit';

/** An Electron event, as before-quit's and a window's close's listeners see it. */
const quitEvent = () => {
  const event = {
    defaultPrevented: false,
    preventDefault: () => {
      event.defaultPrevented = true;
    },
  };
  return event;
};

/** A node with this many screens showing, answering "Quit Drashti?" in turn (true: Quit Drashti). */
const node = (answers: boolean[], showing = 2, noConfirm = false) => {
  const manager = { quitting: vi.fn(), cancelQuitting: vi.fn() };
  const asked: number[] = [];
  const quit = new NodeQuit({
    showing: () => showing,
    noConfirm: () => noConfirm,
    ask: (n) => {
      asked.push(n);
      return answers.shift() ?? false;
    },
    manager,
  });
  return { quit, manager, asked };
};

describe('a node’s “Quit Drashti?” (review S2)', () => {
  it('Keep showing as the quit begins (Cmd+Q, the Dock, File › Quit) stops it before any window closes', () => {
    const { quit, manager, asked } = node([false]);
    const event = quitEvent();
    quit.beforeQuit(event);
    expect(asked).toEqual([2]);
    expect(event.defaultPrevented).toBe(true);
    expect(manager.quitting).not.toHaveBeenCalled();
  });

  it('Quit Drashti as the quit begins: no screen opens again, and the node window closing in it is not asked again', () => {
    const { quit, manager, asked } = node([true]);
    const event = quitEvent();
    quit.beforeQuit(event);
    expect(event.defaultPrevented).toBe(false);
    expect(manager.quitting).toHaveBeenCalledOnce();
    const close = quitEvent();
    quit.windowClose(close);
    expect(close.defaultPrevented).toBe(false);
    expect(asked).toEqual([2]);
  });

  it('the node window’s own close asks there, and the quit it starts is not asked again', () => {
    const { quit, manager, asked } = node([true]);
    const close = quitEvent();
    quit.windowClose(close);
    expect(close.defaultPrevented).toBe(false);
    const event = quitEvent();
    quit.beforeQuit(event);
    expect(event.defaultPrevented).toBe(false);
    expect(manager.quitting).toHaveBeenCalledOnce();
    expect(asked).toEqual([2]);
  });

  it('after Keep showing, the next quit asks again', async () => {
    const { quit, asked } = node([false, true]);
    quit.beforeQuit(quitEvent());
    await Promise.resolve();
    const event = quitEvent();
    quit.beforeQuit(event);
    expect(event.defaultPrevented).toBe(false);
    expect(asked).toEqual([2, 2]);
  });

  it('a quit refused after Quit Drashti (by a later listener) lets the screens open again, and the next quit asks again', async () => {
    const { quit, manager, asked } = node([true, true]);
    const event = quitEvent();
    quit.beforeQuit(event);
    event.preventDefault();
    await Promise.resolve();
    expect(manager.cancelQuitting).toHaveBeenCalledOnce();
    quit.beforeQuit(quitEvent());
    expect(asked).toEqual([2, 2]);
  });

  it('nothing showing, or the tests’ DRASHTI_NO_QUIT_CONFIRM: never asked, the quit goes ahead', () => {
    for (const { showing, noConfirm } of [
      { showing: 0, noConfirm: false },
      { showing: 2, noConfirm: true },
    ]) {
      const { quit, manager, asked } = node([false], showing, noConfirm);
      const event = quitEvent();
      quit.beforeQuit(event);
      const close = quitEvent();
      quit.windowClose(close);
      expect(event.defaultPrevented).toBe(false);
      expect(close.defaultPrevented).toBe(false);
      expect(manager.quitting).toHaveBeenCalledOnce();
      expect(asked).toEqual([]);
    }
  });
});
