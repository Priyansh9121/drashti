/*
 * The media rows taken up by their bytes in this run (a22-review-combine2 last look, L-S1). MediaStore hands an
 * existing row back to whoever brings the same bytes (a deck's preparation keeping a video as an editable document
 * object, Edit Video's copy), and whoever took it may name it only later (the slide editor on Save, the edit's record),
 * so for a while nothing in the library names it. A row taken in this run is never removed during it as a leftover
 * (discardUnlisted); only the next start's sweep may, and only if nothing uses it then. Kept in memory only: each run
 * of Drashti (each process: the import worker keeps its own, unseen here) starts with none.
 */
const taken = new Set<string>();

/** These rows were handed out by their bytes in this run. */
export function markTaken(...ids: readonly (string | null | undefined)[]): void {
  for (const id of ids) if (id) taken.add(id);
}

/** Whether this row was handed out by its bytes in this run. */
export function isTaken(id: string): boolean {
  return taken.has(id);
}

/** A new run, for tests: Drashti starts each run with none. */
export function forgetTaken(): void {
  taken.clear();
}
