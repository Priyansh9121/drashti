import { useEffect } from 'react';
import { create } from 'zustand';
import type { PresentationDoc } from '../../../shared/library';
import { isRepeatId } from '../../../shared/repeat';
import { isPassageId } from '../../../shared/shastra';

/*
 * The slides of the presentations the middle shows as rows (Session 55, Part 4): the open playlist's presentations and
 * passages, a Repeat Slides playlist's steps, and the library's chosen presentation. Each read once, by its id, and read
 * again when the library changes (an import, a save in Edit slides, a passage's text loaded again, a playlist changed
 * for a Repeat Slides playlist's steps). Null: it could not be read (the rows say so, with Try again).
 */

interface DocsView {
  docs: Record<string, PresentationDoc | null>;
}

export const useDocs = create<DocsView>(() => ({ docs: {} }));

/** Ids asked for and not answered yet: never asked twice at once. */
const asking = new Set<string>();
let watching = false;

async function read(id: string): Promise<void> {
  if (asking.has(id)) return;
  asking.add(id);
  let doc: PresentationDoc | null;
  try {
    doc = await window.drashti.library.getPresentation(id);
  } catch {
    doc = null;
  } finally {
    asking.delete(id);
  }
  useDocs.setState((s) => ({ docs: { ...s.docs, [id]: doc } }));
}

/** Read again what the library changed: every presentation, a passage's text, or a Repeat Slides playlist's steps. */
function forget(which: (id: string) => boolean): void {
  const known = Object.keys(useDocs.getState().docs).filter(which);
  for (const id of known) void read(id);
}

function watch(): void {
  if (watching) return;
  watching = true;
  window.drashti.library.onChanged((what) => {
    if (what === 'presentations') forget((id) => !isPassageId(id));
    else if (what === 'shastra') forget(isPassageId);
  });
  // A Repeat Slides playlist's steps are its items: read again when the playlists change.
  window.drashti.playlists.onChanged(() => {
    forget(isRepeatId);
  });
}

/** Read these presentations' slides (each once, until the library changes). */
export function wantDocs(ids: readonly string[]): void {
  watch();
  const { docs } = useDocs.getState();
  for (const id of new Set(ids)) if (!(id in docs)) void read(id);
}

/** Read one again (Try again). */
export function readDocAgain(id: string): Promise<void> {
  return read(id);
}

/** The slides of these presentations, asked for as the list shows them (joined into one key, so it asks once). */
export function useWantDocs(ids: readonly string[]): void {
  const key = [...new Set(ids)].sort().join(' ');
  useEffect(() => {
    if (key !== '') wantDocs(key.split(' '));
  }, [key]);
}
