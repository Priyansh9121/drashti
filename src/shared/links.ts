/*
 * Import from a Link (Session 25b, PLAN §7): File › Import from a Link…
 * asks which kind of link (YouTube or Dropbox), saves what it holds in a
 * folder the admin chooses, and then imports the saved files through the
 * normal import. Nothing goes straight into Drashti, and Drashti never moves
 * or deletes what it saved.
 *
 * Dropbox: a shared link to a file, or to a folder (Dropbox sends a folder
 * as one zip). Its PowerPoint files (.pptx) and MP4 videos are imported;
 * everything else stays in the folder, listed as not taken.
 *
 * YouTube waits for a decision (Session 25b's report): yt-dlp now runs
 * YouTube's own JavaScript to download, which the session's brief said to
 * stop at. The dialog shows the choice, but it cannot be picked yet.
 */

export type LinkKind = 'youtube' | 'dropbox';

/** A file, or a folder (which comes as one zip). */
export type LinkShape = 'file' | 'folder';

export type LinkCheck = { ok: true; url: string; shape: LinkShape } | { ok: false; message: string };

/** Why YouTube cannot be picked yet, in the dialog's words. */
export const YOUTUBE_NOT_YET =
  'Not in this version of Drashti yet. For the mandir’s own videos, download them in YouTube Studio, then import the file.';

/** A pasted link longer than this is not a link someone copied from Dropbox. */
const MAX_LINK = 2000;

const DROPBOX_HOSTS = new Set(['dropbox.com', 'www.dropbox.com']);

/** Shared-link paths: /scl/fi/… and /s/… are files; /scl/fo/… and /sh/… are folders. */
function dropboxShape(path: string): LinkShape | null {
  const parts = path.split('/').filter((p) => p !== '');
  if (parts[0] === 'scl' && parts.length >= 4) {
    if (parts[1] === 'fi') return 'file';
    if (parts[1] === 'fo') return 'folder';
    return null;
  }
  if (parts[0] === 's' && parts.length >= 3) return 'file';
  if (parts[0] === 'sh' && parts.length >= 3) return 'folder';
  return null;
}

function parse(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

const isYouTubeHost = (host: string) =>
  host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');

/** Check a pasted Dropbox link, and make it one that downloads (dl=1). */
function checkDropbox(text: string): LinkCheck {
  const url = parse(text);
  if (!url) return { ok: false, message: 'That is not a link. Paste the link Dropbox gave you.' };
  if (url.protocol !== 'https:')
    return { ok: false, message: 'Paste a link that starts with https://, as Dropbox’s own links do.' };
  const host = url.hostname.toLowerCase();
  if (isYouTubeHost(host)) return { ok: false, message: 'That is a YouTube link, not a Dropbox link.' };
  if (!DROPBOX_HOSTS.has(host) || url.username !== '' || url.password !== '' || url.port !== '')
    return {
      ok: false,
      message: 'That is not a Dropbox link. In Dropbox, use Share, then Copy link, and paste that here.',
    };
  const shape = dropboxShape(url.pathname);
  if (!shape)
    return {
      ok: false,
      message:
        'That Dropbox page is not a shared file or folder. In Dropbox, use Share, then Copy link, and paste that here.',
    };
  // Dropbox's help: dl=1 downloads the file (a folder as a zip); raw=1 would show it instead.
  url.searchParams.delete('raw');
  url.searchParams.set('dl', '1');
  url.hash = '';
  return { ok: true, url: url.toString(), shape };
}

/** Check a pasted link for the kind chosen. */
export function checkLink(kind: LinkKind, raw: string): LinkCheck {
  const text = raw.trim();
  if (text === '') return { ok: false, message: 'Paste a link first.' };
  if (text.length > MAX_LINK) return { ok: false, message: 'That link is too long to be one from Dropbox.' };
  if (kind === 'youtube') return { ok: false, message: `YouTube links: ${YOUTUBE_NOT_YET}` };
  return checkDropbox(text);
}

/**
 * May a download go on to this address (Dropbox sends the file from another
 * of its addresses)? Only https, and only Dropbox's own.
 */
export function downloadHostAllowed(raw: string): boolean {
  const url = parse(raw);
  if (url?.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase();
  return (
    DROPBOX_HOSTS.has(host) ||
    host.endsWith('.dropbox.com') ||
    host === 'dropboxusercontent.com' ||
    host.endsWith('.dropboxusercontent.com')
  );
}

/** What a link holds, as Dropbox describes it before the download. */
export interface LinkLook {
  shape: LinkShape;
  /** Its name (a folder's, without ".zip"). */
  name: string;
  /** Its size in bytes, when Dropbox says (a folder's zip usually has none until it arrives). */
  size: number | null;
}

export type LinkPhase =
  /** Nothing yet: choose a kind, paste a link. */
  | 'idle'
  | 'looking'
  /** The link was looked at: choose where to save, then Download. */
  | 'looked'
  /** Waiting to download (the stream is on air or recording). */
  | 'waiting'
  | 'downloading'
  | 'unpacking'
  /** A video above 1080p being made 1080p before it is imported (Session 25b step 4). */
  | 'converting'
  | 'importing'
  | 'done'
  | 'failed'
  | 'stopped';

/** A file saved and left out of the import, with why. */
export interface NotTaken {
  /** Its path inside the saved folder (or its name). */
  name: string;
  reason: string;
}

export interface LinkView {
  phase: LinkPhase;
  kind: LinkKind | null;
  /** The link as checked (for the dialog only: it is never logged). */
  link: string | null;
  look: LinkLook | null;
  /** Where files are saved: the admin's last choice, else "Drashti downloads" in Movies or Videos. */
  folder: string;
  progress: { done: number; total: number | null } | null;
  /** Why it waits, in words. */
  waitingFor: string | null;
  /** What went wrong, or how it stopped, in words. */
  message: string | null;
  /** What was saved: the folder, and the files in it (paths inside it). */
  saved: { folder: string; files: string[] } | null;
  /** Files saved but not imported, with why. */
  notTaken: NotTaken[];
  /** Videos above 1080p whose 1080p copy was imported (the originals stay in the folder). */
  fitted: string[];
  /** The import run of what was saved, once it started (its report). */
  runId: string | null;
}

/** A refusal from Simple Mode or the admin lock carries no view; the service's own refusals do. */
export type LinkResult = { ok: true; view: LinkView } | { ok: false; message: string; view?: LinkView };

/** Kept free on the disk the files are saved on, as the import and conversions do. */
export const LINK_KEEP_FREE_BYTES = 2 * 1024 ** 3;

/** Dropbox's own limits for a folder downloaded as a zip (its help pages, read 11 Oct 2026). */
export const MAX_ZIP_FILES = 10_000;
export const MAX_ZIP_BYTES = 250 * 1024 ** 3;

/** What is imported from a Dropbox link: PowerPoint files and MP4 videos (PLAN §7). */
export function takenKind(name: string): 'powerpoint' | 'video' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pptx')) return 'powerpoint';
  if (lower.endsWith('.mp4')) return 'video';
  return null;
}

/** The tallest video taken from a Dropbox link (PLAN §7): taller ones are made this tall first. */
export const LINK_MAX_HEIGHT = 1080;

/** Why a saved file is not imported. */
export const NOT_TAKEN_REASON = 'Not a PowerPoint file (.pptx) or an MP4 video, so it was not imported.';
