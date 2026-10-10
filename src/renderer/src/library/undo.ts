import { create } from 'zustand';

/*
 * Undo for removals and changes: presentations from the library, playlists
 * and folders, items added to, moved in or removed from a playlist, words
 * and themes. Each step knows how to bring itself back.
 */

export interface Removal {
  /** What the Undo bar says, for example "Removed “Song”" or "Moved “Song” up". */
  text: string;
  restore: () => Promise<void>;
}

/** How many removals Undo remembers. */
const KEEP = 50;

export const useUndo = create<{
  stack: Removal[];
  /** What was last done or undone, for a screen reader: said once, even when it repeats ("Moved … up" twice). */
  said: { text: string; count: number };
}>(() => ({ stack: [], said: { text: '', count: 0 } }));

const say = (text: string) => {
  useUndo.setState((s) => ({ said: { text, count: s.said.count + 1 } }));
};

export function pushRemoval(removal: Removal): void {
  useUndo.setState((s) => ({ stack: [...s.stack.slice(1 - KEEP), removal] }));
  say(removal.text);
}

/** Bring back the last removal. False when there is nothing to undo. */
export async function undoRemoval(): Promise<boolean> {
  const last = useUndo.getState().stack.at(-1);
  if (!last) return false;
  useUndo.setState((s) => ({ stack: s.stack.slice(0, -1) }));
  await last.restore();
  say(`Undone: ${last.text}`);
  return true;
}

/** “Name” for one thing, or "3 presentations" for several. */
export function describeSome(names: readonly string[], count: number, noun: string): string {
  const [first] = names;
  if (count === 1 && first !== undefined) return `“${first}”`;
  return `${count.toLocaleString('en')} ${noun}${count === 1 ? '' : 's'}`;
}
