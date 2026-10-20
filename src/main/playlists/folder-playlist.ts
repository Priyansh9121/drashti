import type { ImportItemReport } from '../../shared/import';
import type { NewItem } from '../../shared/playlists';
import { folderOf, kindRank, partsInFolderOrder, partTitle } from '../../shared/folder-order';
import type { PlaylistRepo } from '../db/playlists';

/*
 * A folder as one playlist (Session 26c; PLAN §7 "Media and playlists"): a
 * Dropbox folder link's import ends in a new playlist named after the folder
 * (" (2)" when taken), at the top of the list, in the folder's order
 * (shared/folder-order.ts): folder by folder, depth first, each folder's
 * videos then its decks, A→Z, with a header before each subfolder's part.
 * Its PDFs and pictures wait for one button; then each goes at the end of
 * its folder's part.
 */

/** A file the import was given: where it was (`path`), and where it is inside the saved folder. */
export interface FolderFile {
  path: string;
  /** "/"-separated, inside the saved folder. */
  relative: string;
}

/** Outcomes that leave something in the library for the file. */
const MADE = new Set(['imported', 'replaced', 'kept-both', 'skipped']);

/** What each file became in the library, by its path inside the folder (files that failed are left out). */
export function madeFrom(
  items: readonly ImportItemReport[],
  files: readonly FolderFile[],
): Map<string, NewItem> {
  const byPath = new Map<string, ImportItemReport>();
  for (const item of items) if (!byPath.has(item.sourcePath)) byPath.set(item.sourcePath, item);
  const out = new Map<string, NewItem>();
  for (const f of files) {
    const item = byPath.get(f.path);
    const target = item?.target;
    if (!item || !target || !MADE.has(item.outcome)) continue;
    if (target.kind === 'presentation')
      out.set(f.relative, { kind: 'presentation', presentationId: target.id });
    else if (target.kind === 'media') out.set(f.relative, { kind: 'media', mediaId: target.id });
  }
  return out;
}

/** "Name", or the first "Name (n)" no playlist has. */
export function freeName(repo: PlaylistRepo, name: string): string {
  const taken = new Set(repo.tree().map((n) => n.name.toLocaleLowerCase()));
  const base = name.trim() === '' ? 'Dropbox folder' : name.trim();
  if (!taken.has(base.toLocaleLowerCase())) return base;
  for (let n = 2; ; n++) {
    const next = `${base} (${String(n)})`;
    if (!taken.has(next.toLocaleLowerCase())) return next;
  }
}

/** The items for `made` in folder order, a header before each subfolder's part. */
export function folderItems(made: ReadonlyMap<string, NewItem>): NewItem[] {
  const parts = partsInFolderOrder([...made.keys()], (p) => p, kindRank);
  const out: NewItem[] = [];
  for (const part of parts) {
    if (part.title !== '') out.push({ kind: 'header', label: part.title });
    for (const relative of part.entries) {
      const item = made.get(relative);
      if (item) out.push(item);
    }
  }
  return out;
}

/**
 * Make the folder's playlist at the top of the list: its id and name, or null when the import made nothing
 * (no playlist is made then).
 */
export function makeFolderPlaylist(
  repo: PlaylistRepo,
  name: string,
  items: readonly ImportItemReport[],
  files: readonly FolderFile[],
): { id: string; name: string } | null {
  const ordered = folderItems(madeFrom(items, files));
  if (ordered.length === 0) return null;
  const free = freeName(repo, name);
  const id = repo.createAtTop(free);
  // Shown a folder at a time (Session 44): the playlist says it came from one.
  repo.markFromFolder(id);
  repo.addItems(id, null, ordered);
  return { id, name: free };
}

/**
 * Add files later (the PDFs and pictures, one button): each at the end of its folder's part, found by its
 * header ("Week 1 › Videos"); a folder that had no part gets one at the end, with its header. How many
 * went in.
 */
export function addToFolderParts(
  repo: PlaylistRepo,
  playlistId: string,
  items: readonly ImportItemReport[],
  files: readonly FolderFile[],
): number {
  const made = madeFrom(items, files);
  let added = 0;
  // In folder order, so each part's new ones keep their own order at its end.
  for (const part of partsInFolderOrder([...made.keys()], (p) => p, kindRank)) {
    const title = partTitle(part.folder);
    for (const relative of part.entries) {
      const item = made.get(relative);
      if (!item) continue;
      const now = repo.itemsOf(playlistId);
      // The part: from its header (the top folder's: from the start) to the next header.
      const start = title === '' ? 0 : now.findIndex((i) => i.kind === 'header' && i.label === title);
      if (start < 0) {
        // No part yet: a new one at the end.
        if (repo.addItems(playlistId, null, [{ kind: 'header', label: title }, item]).length > 0) added++;
        continue;
      }
      const from = title === '' ? 0 : start + 1;
      const next = now.findIndex((i, index) => index >= from && i.kind === 'header');
      if (repo.addItems(playlistId, next < 0 ? null : next, [item]).length > 0) added++;
    }
  }
  return added;
}

/** A path's folder as its part's header names it (for the dialog's list). */
export const partOf = (relative: string): string => partTitle(folderOf(relative));
