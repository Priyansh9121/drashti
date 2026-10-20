import { basename, dirname } from 'node:path';
import { pathParts } from '../../shared/playlist-folders';

/*
 * Which playlists came from a folder (Session 44), so the operator window shows them a folder at a time
 * (shared/playlist-folders.ts). A smart playlist always did: it follows its folder. From this session a
 * Dropbox folder link's playlist is marked as it is made (`{"fromFolder":true}` in its settings). One an
 * earlier version made from a link was marked by nothing, and its files tell instead: every part's files lie
 * in the folder its header names, all inside one top folder, the top folder's own files in it directly. A
 * playlist whose headers are the operator's own ("Kirtans", "Katha") does not match: its files lie wherever
 * they were imported from, never in folders named by its headers.
 */

/** One item's file (where it was imported from), and the header of the part it is in ('' for the top folder's own). */
export interface PartFile {
  part: string;
  file: string;
}

/** The path functions the check uses: this computer's (Windows' or POSIX), or a test's. */
export interface PathNames {
  dirname: (path: string) => string;
  basename: (path: string) => string;
}

const here: PathNames = { dirname, basename };

/** Whether the files fit the folders their headers name, under one top folder, with at least one subfolder's file. */
export function filesFitFolders(files: readonly PartFile[], names: PathNames = here): boolean {
  if (!files.some((f) => pathParts(f.part).length > 0)) return false;
  let top: string | null = null;
  for (const { part, file } of files) {
    let folder = names.dirname(file);
    for (const name of pathParts(part).reverse()) {
      if (names.basename(folder) !== name) return false;
      folder = names.dirname(folder);
    }
    if (top === null) top = folder;
    else if (top !== folder) return false;
  }
  return true;
}

/** Settings that mark a playlist as made from a folder (a plain playlist's settings say nothing else). */
export const FROM_FOLDER_SETTINGS = JSON.stringify({ fromFolder: true });

/** Whether a plain playlist's settings mark it as made from a folder. */
export function markedFromFolder(settings: string | null): boolean {
  if (settings === null) return false;
  try {
    const parsed: unknown = JSON.parse(settings);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { fromFolder?: unknown }).fromFolder === true
    );
  } catch {
    return false;
  }
}
