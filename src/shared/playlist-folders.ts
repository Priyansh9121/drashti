import type { PlaylistItemInfo } from './playlists';

/*
 * A folder playlist's folders (Session 44). A folder imported as a playlist (a smart playlist following a
 * folder on the computer, or a Dropbox folder link) is one list in the folder's order, with a header before
 * each subfolder's part, named by its path ("Week 1 › Videos", shared/folder-order.ts). The operator window
 * shows it a folder at a time: the open folder's own items in the middle, its subfolders in the bottom left.
 * The folders are read from those headers and nothing else, so a playlist an earlier version made shows the
 * same way, and the playlist itself (what Next, Simple Mode and the phones follow) never changes.
 */

/** Between a path's folders, as the headers write it. */
export const FOLDER_SEPARATOR = ' › ';

/** One folder inside the top folder. */
export interface PlaylistFolder {
  /** Its path inside the top folder, as its header writes it ("Week 1 › Videos"). */
  path: string;
  /** Its own name ("Videos"). */
  name: string;
  /** Its parent's path ('' for a subfolder of the top folder). */
  parent: string;
  /** Items it holds itself, not in its subfolders. */
  own: number;
}

/** A header's folders, trimmed ("Week 1 ›  Videos" -> ["Week 1", "Videos"]); none for the top folder. */
export function pathParts(path: string): string[] {
  return path
    .split(FOLDER_SEPARATOR.trim())
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

const joined = (parts: readonly string[]): string => parts.join(FOLDER_SEPARATOR);

/** The folders' paths and names from the top folder down to `path`, the top folder first (as '' with `top`). */
export function folderCrumbs(path: string, top: string): { path: string; name: string }[] {
  const parts = pathParts(path);
  return [
    { path: '', name: top },
    ...parts.map((name, i) => ({ path: joined(parts.slice(0, i + 1)), name })),
  ];
}

/** The folders a playlist's headers name, and the folder each item is in ('' for the top folder's own). */
export interface FolderView {
  /** Every folder, each parent before its children, in the playlist's order. */
  folders: PlaylistFolder[];
  /** Each item's folder by its id (a header's is the folder it names). */
  folderOf: ReadonlyMap<string, string>;
}

export function playlistFolders(items: readonly PlaylistItemInfo[]): FolderView {
  const byPath = new Map<string, PlaylistFolder>();
  const folders: PlaylistFolder[] = [];
  const folderOf = new Map<string, string>();
  // A folder, and every folder above it that has no part of its own ("Sabha 2" for "Sabha 2 › Deep").
  const ensure = (parts: readonly string[]): void => {
    const path = joined(parts);
    if (parts.length === 0 || byPath.has(path)) return;
    ensure(parts.slice(0, -1));
    const folder = { path, name: parts.at(-1) ?? '', parent: joined(parts.slice(0, -1)), own: 0 };
    byPath.set(path, folder);
    folders.push(folder);
  };
  let current = '';
  for (const item of items) {
    if (item.kind === 'header') {
      const parts = pathParts(item.label);
      current = joined(parts);
      ensure(parts);
    } else {
      const folder = byPath.get(current);
      if (folder) folder.own++;
    }
    folderOf.set(item.id, current);
  }
  return { folders, folderOf };
}

/** The folders directly inside `path`, in the playlist's order. */
export function subfoldersOf(view: FolderView, path: string): PlaylistFolder[] {
  return view.folders.filter((f) => f.parent === path);
}

/** Whether `path` names a folder of the playlist ('' always does: the top folder). */
export function hasFolder(view: FolderView, path: string): boolean {
  return path === '' || view.folders.some((f) => f.path === path);
}

/**
 * Where something added to folder `path` goes in the whole playlist: at the end of its part (after its own
 * last item, before the next header). Null when the folder has no part of its own (a folder that only holds
 * folders): it needs a header first, before its first subfolder's (`headerAt`).
 */
export function folderEnd(
  items: readonly PlaylistItemInfo[],
  view: FolderView,
  path: string,
): { at: number } | { headerAt: number } {
  if (path === '') {
    const first = items.findIndex((i) => i.kind === 'header');
    return { at: first < 0 ? items.length : first };
  }
  // The last of its parts (a header can be repeated by hand): from its header to the next one.
  const start = items.findLastIndex((i) => i.kind === 'header' && view.folderOf.get(i.id) === path);
  if (start >= 0) {
    const next = items.findIndex((i, index) => index > start && i.kind === 'header');
    return { at: next < 0 ? items.length : next };
  }
  const inside = items.findIndex(
    (i) => i.kind === 'header' && (view.folderOf.get(i.id) ?? '').startsWith(`${path}${FOLDER_SEPARATOR}`),
  );
  return { headerAt: inside < 0 ? items.length : inside };
}
