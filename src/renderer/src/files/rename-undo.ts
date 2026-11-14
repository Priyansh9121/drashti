import { cleanRenameName, type RenameAnswer } from '../../../shared/rename-name';

/*
 * Rename… kept, and its Undo, the operator window's and a phone's alike (Session 58, X3). Drashti keeps a name cleaned
 * (shared/rename-name.ts), so Undo says the name as it was kept; a rename that keeps the old name again changed nothing
 * and offers no Undo; and Undo, a rename back to the old name (cleaned again as it is kept, as any name given), says
 * why when Drashti refuses it, in the window as on a phone.
 */

/** How a page keeps a name, offers Undo and says why not: the window's, or a phone's. */
export interface RenameWays {
  /** Ask Drashti to keep this name. */
  keep(name: string): Promise<RenameAnswer>;
  /** Offer Undo: its words, and what it does. */
  offerUndo(text: string, undo: () => Promise<void>): void;
  /** Say why Undo could not put the old name back. */
  say(text: string): void;
}

/** Keep `typed` as the new name of what is called `old` now: null once kept, else why not (the question says so). */
export async function renameWithUndo(old: string, typed: string, ways: RenameWays): Promise<string | null> {
  const answer = await ways.keep(typed);
  if (!answer.ok) return answer.message;
  const kept = cleanRenameName(typed);
  if (kept !== old)
    ways.offerUndo(`Renamed “${old}” to “${kept}”`, async () => {
      const back = await ways.keep(old);
      if (!back.ok) ways.say(back.message);
    });
  return null;
}
