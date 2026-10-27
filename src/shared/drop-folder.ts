/*
 * The drop folder (Session 28, decision 21): one folder, chosen in Pro Mode, where pictures, videos and (Session
 * 51) sounds put in it are imported by themselves, once each has held still for 5 seconds; the library only
 * ever gains from it (nothing is removed when a file goes, and the folder itself is never written to). It waits
 * while the stream is on air or recording, and carries on quietly in Simple Mode. Media lists what came from it.
 */

/** A file's size limit (2 GB); a larger one is listed, and Import anyway brings it in. */
export const DROP_MAX_BYTES = 2 * 1024 ** 3;
/** How long a file's size and time must hold still before it is taken (ms). */
export const DROP_SETTLE_MS = 5000;

/** A file in the drop folder that was not taken, and why. */
export interface DropNotTaken {
  name: string;
  reason: string;
  /** Too large: it can be imported anyway. */
  tooLarge: boolean;
}

export interface DropFolderView {
  folder: string | null;
  on: boolean;
  /**
   * 'off': not on, or no folder; 'watching': all is well; 'waiting': files that held still wait while the
   * stream is on air or recording; 'folder-gone': the folder is not there (it carries on when it is back).
   */
  state: 'off' | 'watching' | 'waiting' | 'folder-gone';
  /** Files waiting to hold still, or to be taken. */
  waiting: number;
  /** Kept in sync by a cloud service (its name), whose files can show before they are all there. */
  cloud: string | null;
  notTaken: DropNotTaken[];
  /** The last batch taken: when, and how many. */
  last: { at: number; taken: number } | null;
}

export type DropFolderResult = { ok: true; view: DropFolderView } | { ok: false; message: string };

/** What a refused look at the drop folder answers (Simple Mode): nothing. */
export const DROP_REFUSED_VIEW: DropFolderView = {
  folder: null,
  on: false,
  state: 'off',
  waiting: 0,
  cloud: null,
  notTaken: [],
  last: null,
};

/** Names a browser, an editor or a copy leaves while a file is still being written: never taken. */
export function droppedName(name: string): boolean {
  if (name.startsWith('.') || name.startsWith('~$')) return false;
  return !/\.(part|crdownload|download|tmp|partial)$/iu.test(name);
}

/** The cloud service keeping a folder in sync, from its path, or null. */
export function cloudOf(folder: string): string | null {
  const p = folder.replace(/\\/gu, '/').toLowerCase();
  if (p.includes('/onedrive')) return 'OneDrive';
  if (p.includes('/library/mobile documents/') || p.includes('/icloud drive') || p.includes('/iclouddrive'))
    return 'iCloud Drive';
  if (p.includes('/dropbox')) return 'Dropbox';
  if (p.includes('/google drive') || p.includes('/googledrive') || p.includes('/cloudstorage/google'))
    return 'Google Drive';
  if (p.includes('/library/cloudstorage/')) return 'a cloud service';
  return null;
}
