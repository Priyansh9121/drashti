import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineState } from '../../../shared/engine/state';

/*
 * Simple Mode's Undo (Edit › Undo and its key; Session 55, Part 18): Simple Mode deletes, renames and drags its one
 * playlist's rows now, each a step of the Undo bar, and still has Clear all's Put it back. Undo puts back what Clear all
 * took down while Put it back is offered (right after it), and otherwise brings back the Undo bar's last step. The
 * main process is stood in for by a bridge that records what the window sends.
 */

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.resetModules();
});

describe('Simple Mode’s Undo', () => {
  it('puts back what Clear all took down while Put it back is offered, and else undoes the Undo bar’s last step', async () => {
    vi.resetModules();
    const sent: unknown[] = [];
    (globalThis as { window?: unknown }).window = {
      drashti: {
        engine: {
          dispatch: (command: unknown) => {
            sent.push(command);
            return Promise.resolve({ ok: true, changed: true });
          },
        },
      },
    };
    const { useEngine } = await import('../engine/engine-store');
    const { pushRemoval, useUndo } = await import('../library/undo');
    const { undoSimple } = await import('./actions');
    const { useMode } = await import('./mode-store');
    useMode.setState({ mode: 'simple' });
    let restored = 0;
    pushRemoval({
      text: 'Moved “Placeholder row” up',
      restore: () => {
        restored += 1;
        return Promise.resolve();
      },
    });
    // Right after Clear all: Put it back, and the row's move stays to undo.
    useEngine.setState({ state: { canPutBack: true } as unknown as EngineState });
    await undoSimple();
    expect(sent).toEqual([{ type: 'putBack' }]);
    expect(restored).toBe(0);
    // Put it back no longer offered: the Undo bar's last step.
    useEngine.setState({ state: { canPutBack: false } as unknown as EngineState });
    await undoSimple();
    expect(restored).toBe(1);
    expect(useUndo.getState().stack).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it('keeps a Pro change undoable in Pro after Simple Undo, with and without Put it back', async () => {
    const sent: unknown[] = [];
    (globalThis as { window?: unknown }).window = {
      drashti: {
        engine: {
          dispatch: (command: unknown) => {
            sent.push(command);
            return Promise.resolve({ ok: true, changed: true });
          },
        },
      },
    };
    const { useEngine } = await import('../engine/engine-store');
    const { pushRemoval, undoRemoval, useUndo } = await import('../library/undo');
    const { undoSimple } = await import('./actions');
    const { useMode } = await import('./mode-store');
    useMode.setState({ mode: 'pro' });
    const restore = vi.fn().mockResolvedValue(undefined);
    pushRemoval({ text: 'Deleted playlist “Placeholder Pro playlist”', restore });
    useMode.setState({ mode: 'simple' });
    useEngine.setState({ state: { canPutBack: true } as unknown as EngineState });
    await undoSimple();
    expect(sent).toEqual([{ type: 'putBack' }]);
    useEngine.setState({ state: { canPutBack: false } as unknown as EngineState });
    await undoSimple();
    expect(restore).not.toHaveBeenCalled();
    expect(useUndo.getState().stack).toHaveLength(1);
    useMode.setState({ mode: 'pro' });
    expect(await undoRemoval()).toBe(true);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(useUndo.getState().stack).toEqual([]);
  });

  it('undoes Simple changes without consuming a newer Pro change', async () => {
    const { useEngine } = await import('../engine/engine-store');
    const { pushRemoval, undoRemoval, useUndo } = await import('../library/undo');
    const { undoSimple } = await import('./actions');
    const { useMode } = await import('./mode-store');
    const simpleRestore = vi.fn().mockResolvedValue(undefined);
    const proRestore = vi.fn().mockResolvedValue(undefined);
    useMode.setState({ mode: 'simple' });
    pushRemoval({ text: 'Renamed “Placeholder row”', restore: simpleRestore });
    useMode.setState({ mode: 'pro' });
    pushRemoval({ text: 'Deleted playlist “Placeholder Pro playlist”', restore: proRestore });
    useMode.setState({ mode: 'simple' });
    useEngine.setState({ state: { canPutBack: false } as unknown as EngineState });
    await undoSimple();
    expect(simpleRestore).toHaveBeenCalledTimes(1);
    expect(proRestore).not.toHaveBeenCalled();
    expect(useUndo.getState().stack).toHaveLength(1);
    useMode.setState({ mode: 'pro' });
    expect(await undoRemoval()).toBe(true);
    expect(proRestore).toHaveBeenCalledTimes(1);
    expect(useUndo.getState().stack).toEqual([]);
  });
});
