import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperatorMode } from '../../../shared/mode';

/*
 * The Undo line at the left column's foot (QA23-UNDOLINE-1, the owner: "if i deleted something, it should not keep
 * saying deleted "" under wallpapers for more than a minute. it just doesnt go away"): it goes by itself a minute after
 * the last change, and a new change has a minute of its own. Until then its Undo brings the change back as before;
 * after it has gone, Edit > Undo and its key (Cmd/Ctrl+Z) still do, for the last 50 changes, as before. The clock is
 * held here (the timers and performance.now). Placeholder names only.
 */

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
});

afterEach(() => {
  vi.useRealTimers();
});

async function undoLine() {
  const undo = await import('./undo');
  const { useMode } = await import('../operator/mode-store');
  useMode.setState({ mode: 'pro' });
  /** What the line says now, or null with no line. */
  const line = (mode: OperatorMode = 'pro') => undo.lineRemoval(undo.useUndo.getState(), mode)?.text ?? null;
  const brought: string[] = [];
  const remove = (name: string) => {
    undo.pushRemoval({
      text: `Deleted the wallpaper “${name}”`,
      restore: () => {
        brought.push(name);
        return Promise.resolve();
      },
    });
  };
  return { ...undo, line, brought, remove };
}

describe('the Undo line', () => {
  it('is there at 59 s and gone by 60 s; Edit > Undo still brings the change back after it has gone', async () => {
    const { line, remove, brought, undoRemoval, useUndo } = await undoLine();
    remove('Placeholder darshan blue');
    expect(line()).toBe('Deleted the wallpaper “Placeholder darshan blue”');
    vi.advanceTimersByTime(59_000);
    expect(line()).toBe('Deleted the wallpaper “Placeholder darshan blue”');
    vi.advanceTimersByTime(1_000);
    expect(line()).toBeNull();
    // The change is still there to undo (Edit > Undo, Cmd/Ctrl+Z): the line going takes nothing out of it.
    expect(useUndo.getState().stack.map((s) => s.text)).toEqual(['Deleted the wallpaper “Placeholder darshan blue”']);
    expect(await undoRemoval()).toBe(true);
    expect(brought).toEqual(['Placeholder darshan blue']);
    expect(line()).toBeNull();
  });

  it('keeps its Undo working until then, the line then saying the change before it', async () => {
    const { line, remove, brought, undoRemoval, useUndo } = await undoLine();
    remove('Placeholder darshan green');
    remove('Placeholder darshan blue');
    vi.advanceTimersByTime(59_000);
    expect(line()).toBe('Deleted the wallpaper “Placeholder darshan blue”');
    expect(await undoRemoval()).toBe(true);
    expect(brought).toEqual(['Placeholder darshan blue']);
    // The change before it, with its Undo, till the minute of the last change is up.
    expect(line()).toBe('Deleted the wallpaper “Placeholder darshan green”');
    vi.advanceTimersByTime(999);
    expect(line()).toBe('Deleted the wallpaper “Placeholder darshan green”');
    vi.advanceTimersByTime(1);
    expect(line()).toBeNull();
    expect(useUndo.getState().stack).toHaveLength(1);
  });

  it('has a minute again from a second change', async () => {
    const { line, remove, brought, undoRemoval } = await undoLine();
    remove('Placeholder darshan green');
    vi.advanceTimersByTime(40_000);
    remove('Placeholder darshan blue');
    // 99 s after the first change, 59 s after the second: there, saying the second.
    vi.advanceTimersByTime(59_000);
    expect(line()).toBe('Deleted the wallpaper “Placeholder darshan blue”');
    vi.advanceTimersByTime(1_000);
    expect(line()).toBeNull();
    // A change after the line has gone has its own minute.
    remove('Placeholder sunrise');
    expect(line()).toBe('Deleted the wallpaper “Placeholder sunrise”');
    vi.advanceTimersByTime(59_999);
    expect(line()).toBe('Deleted the wallpaper “Placeholder sunrise”');
    vi.advanceTimersByTime(1);
    expect(line()).toBeNull();
    // Every change is still there to undo, last first.
    expect(await undoRemoval()).toBe(true);
    expect(await undoRemoval()).toBe(true);
    expect(await undoRemoval()).toBe(true);
    expect(brought).toEqual(['Placeholder sunrise', 'Placeholder darshan blue', 'Placeholder darshan green']);
    expect(await undoRemoval()).toBe(false);
  });

  it('in Simple Mode, says only Simple Mode’s changes, for the same minute', async () => {
    const { line, pushRemoval } = await undoLine();
    const { useMode } = await import('../operator/mode-store');
    useMode.setState({ mode: 'simple' });
    pushRemoval({ text: 'Moved “Placeholder row” up', restore: () => Promise.resolve() });
    useMode.setState({ mode: 'pro' });
    pushRemoval({ text: 'Deleted playlist “Placeholder Pro playlist”', restore: () => Promise.resolve() });
    expect(line('simple')).toBe('Moved “Placeholder row” up');
    expect(line('pro')).toBe('Deleted playlist “Placeholder Pro playlist”');
    vi.advanceTimersByTime(60_000);
    expect(line('simple')).toBeNull();
    expect(line('pro')).toBeNull();
  });
});
