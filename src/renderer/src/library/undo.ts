import { create } from 'zustand';
import type { OperatorMode } from '../../../shared/mode';
import { useMode } from '../operator/mode-store';

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

interface UndoStep extends Removal {
  /** Pro changes stay in history but are never offered or consumed by Simple Mode. */
  mode: OperatorMode;
}

/** How many removals Undo remembers. */
const KEEP = 50;

export const useUndo = create<{
  stack: UndoStep[];
  /** What was last done or undone, for a screen reader: said once, even when it repeats ("Moved … up" twice). */
  said: { text: string; count: number; mode: OperatorMode | null };
}>(() => ({ stack: [], said: { text: '', count: 0, mode: null } }));

const say = (text: string, mode: OperatorMode) => {
  useUndo.setState((s) => ({ said: { text, count: s.said.count + 1, mode } }));
};

export function pushRemoval(removal: Removal): void {
  const mode = useMode.getState().mode ?? 'pro';
  useUndo.setState((s) => ({ stack: [...s.stack.slice(1 - KEEP), { ...removal, mode }] }));
  say(removal.text, mode);
}

/** The last step this mode can undo; Pro Mode can undo steps made in either mode. */
export function lastRemoval(stack: readonly UndoStep[], mode: OperatorMode | null): UndoStep | undefined {
  return stack.findLast((step) => mode !== 'simple' || step.mode === 'simple');
}

/** Bring back the last change available in this mode, leaving other history intact. */
export async function undoRemoval(mode: OperatorMode = useMode.getState().mode ?? 'pro'): Promise<boolean> {
  const last = lastRemoval(useUndo.getState().stack, mode);
  if (!last) return false;
  useUndo.setState((s) => ({ stack: s.stack.filter((step) => step !== last) }));
  await last.restore();
  say(`Undone: ${last.text}`, mode);
  return true;
}

/** “Name” for one thing, or "3 presentations" for several. */
export function describeSome(names: readonly string[], count: number, noun: string): string {
  const [first] = names;
  if (count === 1 && first !== undefined) return `“${first}”`;
  return `${count.toLocaleString('en')} ${noun}${count === 1 ? '' : 's'}`;
}
