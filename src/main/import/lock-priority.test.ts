import { constants } from 'node:os';
import { describe, expect, it } from 'vitest';
import { lockPriority } from './lock-priority';

/*
 * The import worker runs at the lowest priority, so the show's processes always come first (import/worker.ts). While it
 * holds the library's write lock it runs at normal priority on Windows (Session 58, h-stall2): there, on two busy
 * cores, it was given no processor for 1-9 s at a time while it held the lock and a write of the main process waited.
 * macOS never lets a program raise its own priority again, and its scheduler gives a low one its turn: unchanged there.
 */
describe('the import worker’s priority while it holds the write lock', () => {
  it('on Windows: normal while it holds the lock, the lowest again once it lets go', () => {
    const set: number[] = [];
    const holding = lockPriority('win32', (p) => set.push(p));
    expect(holding).toBeDefined();
    holding?.(true);
    holding?.(false);
    expect(set).toEqual([constants.priority.PRIORITY_NORMAL, constants.priority.PRIORITY_LOW]);
  });

  it('a priority the system refuses to change leaves it as it was, never an error in the import', () => {
    const holding = lockPriority('win32', () => {
      throw new Error('Placeholder: not allowed');
    });
    expect(() => {
      holding?.(true);
      holding?.(false);
    }).not.toThrow();
  });

  it('elsewhere nothing changes', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const set: number[] = [];
      expect(lockPriority(platform, (p) => set.push(p))).toBeUndefined();
      expect(set).toEqual([]);
    }
  });
});
