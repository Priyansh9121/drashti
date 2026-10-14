import type { ImportItemReport, ItemOutcome } from './import';
import type { NewItem } from './playlists';

/*
 * What an import made, as playlist items (Session 26a): files dropped on a
 * playlist, and Add to playlist after an import, add everything the import
 * made, in the order the files were given. A folder's files come in the
 * import's own order for that folder.
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

/**
 * The presentations and media an import made from `paths`, in the order of `paths` (each folder's in
 * the report's order), each once.
 */
export function itemsMadeBy(items: readonly ImportItemReport[], paths: readonly string[]): NewItem[] {
  const out: NewItem[] = [];
  const seen = new Set<string>();
  const taken = new Set<ImportItemReport>();
  const add = (item: ImportItemReport) => {
    taken.add(item);
    const target = item.target;
    if (!target || !MADE.has(item.outcome)) return;
    if (target.kind !== 'presentation' && target.kind !== 'media') return;
    const key = `${target.kind}:${target.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(
      target.kind === 'presentation'
        ? { kind: 'presentation', presentationId: target.id }
        : { kind: 'media', mediaId: target.id },
    );
  };
  for (const path of paths) for (const item of items) if (!taken.has(item) && from(item, path)) add(item);
  return out;
}
