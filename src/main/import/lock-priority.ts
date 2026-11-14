import { constants } from 'node:os';

/*
 * The import worker's priority while it holds the library's write lock (Session 58, h-stall2). The worker runs at the
 * lowest priority (worker.ts), so whenever the computer is busy the show's processes come first. But on two busy cores
 * (Windows, streaming, no graphics chip) that meant it was given no processor for seconds at a time while it held the
 * lock, 1-9 s with 100-500 ms of its own work, and any write of the main process (which carries every slide change)
 * waited for it all that time. So while it holds the lock it runs at normal priority, and at the lowest again once it
 * lets go: the same work, done at once instead of whenever Windows lets a starved program run. macOS never lets a
 * program raise its own priority again, and its scheduler gives a low one its turn: unchanged there.
 */

/** The worker's own hook for its writes (BatchWriter's `holding`), or none where nothing changes. */
export function lockPriority(
  platform: NodeJS.Platform,
  set: (priority: number) => void,
): ((holding: boolean) => void) | undefined {
  if (platform !== 'win32') return undefined;
  return (holding) => {
    try {
      set(holding ? constants.priority.PRIORITY_NORMAL : constants.priority.PRIORITY_LOW);
    } catch {
      // Not allowed here: it stays as it was.
    }
  };
}
