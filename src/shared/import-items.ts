import type { ImportItemReport, ItemOutcome } from './import';
import type { NewItem } from './playlists';
import { kindRank, partsInFolderOrder } from './folder-order';

/*
 * What an import made, as playlist items (Session 26a): files dropped on a
 * playlist, and Add to playlist after an import, add everything the import
 * made, in the order the files were given; a folder's in its folders'
 * order (Session 26c).
 */

/** Outcomes that leave something in the library for the file (skipped: it was there already, unchanged). */
const MADE: ReadonlySet<ItemOutcome> = new Set(['imported', 'replaced', 'kept-both', 'skipped']);

/** Whether a report item came from `path`: the file itself, a file in the folder, or a file in the bundle. */
function from(item: ImportItemReport, path: string): boolean {
  const source = item.sourcePath;
  if (source === path) return true;
  const inside = source.startsWith(path) ? source.slice(path.length) : null;
  return inside !== null && (inside.startsWith('/') || inside.startsWith('\\') || inside.startsWith('!/'));
}

/** What a report item made, as a playlist item (null for anything else, or nothing made). */
function itemOf(item: ImportItemReport): NewItem | null {
  const target = item.target;
  if (!target || !MADE.has(item.outcome)) return null;
  if (target.kind === 'presentation') return { kind: 'presentation', presentationId: target.id };
  if (target.kind === 'media') return { kind: 'media', mediaId: target.id };
  return null;
}

/** The path of `source` inside the folder `root`, "/"-separated; null when it is not inside it as a folder. */
function insideFolder(source: string, root: string): string | null {
  if (!source.startsWith(root)) return null;
  const rest = source.slice(root.length);
  if (!rest.startsWith('/') && !rest.startsWith('\\')) return null;
  return rest.slice(1).split(/[\\/]/u).join('/');
}

/**
 * The presentations and media an import made from `paths`, in the order of `paths`, each once. A folder's
 * come in its folders' order (Session 26c, shared/folder-order.ts): folder by folder, depth first, each
 * folder's videos, then its decks, then the rest, A→Z, with a header before each subfolder's part.
 */
export function itemsMadeBy(items: readonly ImportItemReport[], paths: readonly string[]): NewItem[] {
  const out: NewItem[] = [];
  const seen = new Set<string>();
  const taken = new Set<ImportItemReport>();
  const push = (made: NewItem | null) => {
    if (!made) return;
    if (made.kind === 'presentation' || made.kind === 'media') {
      const key = made.kind === 'presentation' ? `p:${made.presentationId}` : `m:${made.mediaId}`;
      if (seen.has(key)) return;
      seen.add(key);
    }
    out.push(made);
  };
  for (const path of paths) {
    const mine = items.filter((item) => !taken.has(item) && from(item, path));
    for (const item of mine) taken.add(item);
    const inFolder = mine.flatMap((item) => {
      const relative = insideFolder(item.sourcePath, path);
      return relative === null ? [] : [{ item, relative }];
    });
    if (inFolder.length === 0) {
      for (const item of mine) push(itemOf(item));
      continue;
    }
    // A folder: its files in folder order (a bundle's or the file's own items, if any, first).
    for (const item of mine) if (insideFolder(item.sourcePath, path) === null) push(itemOf(item));
    for (const part of partsInFolderOrder(inFolder, (e) => e.relative, kindRank)) {
      const made = part.entries.map((e) => itemOf(e.item)).filter((m): m is NewItem => m !== null);
      if (made.length === 0) continue;
      if (part.title !== '') out.push({ kind: 'header', label: part.title });
      for (const m of made) push(m);
    }
  }
  return out;
}
