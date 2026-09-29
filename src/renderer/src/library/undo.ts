import { create } from 'zustand';

/*
 * Undo for removals: presentations from the library, playlists and folders,
 * and items from a playlist. Each removal knows how to bring itself back.
 */

export interface Removal {
  /** What the Undo bar says, for example "Removed “Song”". */
  text: string;
  restore: () => Promise<void>;
}

/** How many removals Undo remembers. */
const KEEP = 50;

export const useUndo = create<{ stack: Removal[] }>(() => ({ stack: [] }));

export function pushRemoval(removal: Removal): void {
  useUndo.setState((s) => ({ stack: [...s.stack.slice(1 - KEEP), removal] }));
}

/** Bring back the last removal. False when there is nothing to undo. */
export async function undoRemoval(): Promise<boolean> {
  const last = useUndo.getState().stack.at(-1);
  if (!last) return false;
  useUndo.setState((s) => ({ stack: s.stack.slice(0, -1) }));
  await last.restore();
  return true;
}

/** “Name” for one thing, or "3 presentations" for several. */
export function describeSome(names: readonly string[], count: number, noun: string): string {
  const [first] = names;
  if (count === 1 && first !== undefined) return `“${first}”`;
  return `${count.toLocaleString('en')} ${noun}${count === 1 ? '' : 's'}`;
}
