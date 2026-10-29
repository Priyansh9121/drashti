import { create } from 'zustand';
import { readPersisted, writePersisted } from '../ui/persist';

/*
 * A presentation's slides folded under its name in the playlist (Session 55, Part 4): by the playlist item, remembered
 * on this computer, so a long deck folded stays folded after a restart. A folded item's rows keep their numbers.
 */

const KEY = 'playlist.folded';
/** The most remembered: the oldest go first. */
const KEEP = 500;

const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export const useFolded = create<{ folded: string[] }>(() => ({
  folded: readPersisted<string[]>(KEY, [], isIds),
}));

/** Fold an item's slides under its name, or open them again. */
export function toggleFolded(itemId: string): void {
  const { folded } = useFolded.getState();
  const next = folded.includes(itemId)
    ? folded.filter((id) => id !== itemId)
    : [...folded, itemId].slice(-KEEP);
  useFolded.setState({ folded: next });
  writePersisted(KEY, next);
}

/** Open an item's slides (a jump to one of them). */
export function unfold(itemId: string): void {
  if (useFolded.getState().folded.includes(itemId)) toggleFolded(itemId);
}
