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
 * YouTube (Session 25c): one video, as MP4 (video) or MP3 (sound only), at
 * the quality chosen, never above the admin's highest video quality, after
 * a person confirms each time that it is the mandir's own or used with its
 * owner's permission. Drashti runs yt-dlp for it (and yt-dlp runs Deno for
 * YouTube's player JavaScript); Drashti never signs in to YouTube. A
 * downloaded file holds only the video: YouTube sends its ads apart.
 */

export type LinkKind = 'youtube' | 'dropbox';

/** A file, or a folder (which comes as one zip); a YouTube video. */
export type LinkShape = 'file' | 'folder' | 'video';

export type LinkCheck = { ok: true; url: string; shape: LinkShape } | { ok: false; message: string };

/** A pasted link longer than this is not a link someone copied from Dropbox or YouTube. */
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

/** YouTube's own addresses for a video page (YouTube Music's Share gives music.youtube.com). */
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

/** A YouTube video's id: eleven letters, digits, - or _. */
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/u;

const NOT_A_VIDEO =
  'That YouTube page is not a video. Open the video, use Share, then Copy, and paste that here.';

/**
 * Check a pasted YouTube link: https, YouTube's own addresses, and only the shapes its Share button
 * gives for one video (youtu.be/…, youtube.com/watch?v=…, /shorts/…, /live/…). Whatever else the link
 * names (a playlist it was played from, a time, a share code) is left out: the link Drashti asks about
 * is the video's own page.
 */
function checkYouTube(text: string): LinkCheck {
  const url = parse(text);
  if (!url) return { ok: false, message: 'That is not a link. Paste the link YouTube’s Share button gives.' };
  if (url.protocol !== 'https:')
    return { ok: false, message: 'Paste a link that starts with https://, as YouTube’s own links do.' };
  const host = url.hostname.toLowerCase();
  if (DROPBOX_HOSTS.has(host)) return { ok: false, message: 'That is a Dropbox link, not a YouTube link.' };
  if (!isYouTubeHost(host) || url.username !== '' || url.password !== '' || url.port !== '')
    return {
      ok: false,
      message: 'That is not a YouTube link. On YouTube, use Share, then Copy, and paste that here.',
    };
  const parts = url.pathname.split('/').filter((p) => p !== '');
  let id: string | null;
  if (host === 'youtu.be') id = parts.length === 1 ? (parts[0] ?? null) : null;
  else if (!YOUTUBE_HOSTS.has(host)) return { ok: false, message: NOT_A_VIDEO };
  else if (parts.length === 1 && parts[0] === 'watch') id = url.searchParams.get('v');
  else if (parts.length === 2 && (parts[0] === 'shorts' || parts[0] === 'live')) id = parts[1] ?? null;
  else if (parts[0] === 'playlist')
    return {
      ok: false,
      message:
        'That is a playlist. Drashti downloads one video at a time: open a video in it, use Share, and paste that link here.',
    };
  else return { ok: false, message: NOT_A_VIDEO };
  if (id === null || !YOUTUBE_ID.test(id))
    return {
      ok: false,
      message:
        'That YouTube link does not name a video. Open the video, use Share, then Copy, and paste that here.',
    };
  return { ok: true, url: `https://www.youtube.com/watch?v=${id}`, shape: 'video' };
}

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
  if (text.length > MAX_LINK)
    return {
      ok: false,
      message: `That link is too long to be one from ${kind === 'youtube' ? 'YouTube' : 'Dropbox'}.`,
    };
  return kind === 'youtube' ? checkYouTube(text) : checkDropbox(text);
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

/** A YouTube video, as yt-dlp describes it before the download (Session 25c). */
export interface VideoDetails {
  title: string;
  /** In seconds, when YouTube says. */
  duration: number | null;
  /** The heights it offers, tallest first, each with about how big its MP4 would be (null: not said). */
  heights: { height: number; bytes: number | null }[];
  /** About how big its MP3 would be (the best sound). */
  soundBytes: number | null;
}

/** What a link holds, as Dropbox (or YouTube, through yt-dlp) describes it before the download. */
export interface LinkLook {
  shape: LinkShape;
  /** Its name (a folder's, without ".zip"; a video's title). */
  name: string;
  /** Its size in bytes, when Dropbox says (a folder's zip usually has none until it arrives). */
  size: number | null;
  /** A YouTube video's details. */
  video?: VideoDetails;
}

/** MP4 (the video) or MP3 (its sound only). */
export type YouTubeType = 'mp4' | 'mp3';

/** What a YouTube download is to be: asked for with each download. */
export interface YouTubeChoice {
  type: YouTubeType;
  /** The height (MP4 only; MP3 takes the best sound). */
  height: number | null;
  /** The permission tick, ticked this time. */
  permission: boolean;
}

/**
 * The height an MP4 download asks for: the one picked, while the video offers it and the setting allows
 * it; else the tallest the setting allows (the video's heights are tallest first); none when every one is
 * above the setting.
 */
export function chosenHeight(video: VideoDetails, maxHeight: number, picked: number | null): number | null {
  if (picked !== null && picked <= maxHeight && video.heights.some((h) => h.height === picked)) return picked;
  return video.heights.find((h) => h.height <= maxHeight)?.height ?? null;
}

/** The permission tick's words: each time, before Download wakes (PLAN §7). */
export const PERMISSION_WORDS = 'This video is the mandir’s own, or its owner allows us to use it';

/** Why a quality above the setting cannot be picked, and where an admin changes it. */
export const aboveTheSetting = (maxHeight: number): string =>
  `Above ${heightLabel(maxHeight)}, the highest video quality an admin allows. An admin can change it under Highest video quality, above.`;

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
  /** A video above the highest quality being made that tall before it is imported (Session 25b step 4). */
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
  /** Videos above the highest quality whose copy that tall was imported (the originals stay in the folder). */
  fitted: string[];
  /** The admin's highest video quality, for YouTube and Dropbox. */
  maxHeight: LinkHeight;
  /** The import run of what was saved, once it started (its report). */
  runId: string | null;
  /** A YouTube download's type and height, once it starts. */
  choice: { type: YouTubeType; height: number | null } | null;
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

/**
 * The admin's "Highest video quality" (Session 25c, PLAN §7), one setting for YouTube and Dropbox both:
 * a Dropbox video taller than it is made that tall before it is imported, and a YouTube quality above
 * it is shown but cannot be picked. Kept with the library's settings, so a backup keeps it.
 */
export const LINK_HEIGHTS = [1080, 1440, 2160, 4320] as const;
export type LinkHeight = (typeof LINK_HEIGHTS)[number];
/** To begin with (PLAN §7). */
export const DEFAULT_LINK_MAX_HEIGHT: LinkHeight = 1080;
export const isLinkHeight = (value: unknown): value is LinkHeight => LINK_HEIGHTS.some((h) => h === value);

/** A height as people say it: 1080p, 1440p, 2160p (4K), 4320p (8K). */
export function heightLabel(height: number): string {
  if (height === 2160) return '2160p (4K)';
  if (height === 4320) return '4320p (8K)';
  return `${String(height)}p`;
}

/** Why a saved file is not imported. */
export const NOT_TAKEN_REASON = 'Not a PowerPoint file (.pptx) or an MP4 video, so it was not imported.';
