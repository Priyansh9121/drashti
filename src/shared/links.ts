/*
 * Import from a Link (Session 25b, PLAN §7): File › Import from a Link…
 * detects YouTube or Dropbox from a pasted link and saves it in the usual
 * downloads folder before importing it. Drashti keeps the saved files.
 *
 * Dropbox: a shared link to a file, or to a folder (Dropbox sends a folder
 * as one zip). Its PowerPoint files (.pptx) and MP4 videos are imported;
 * everything else stays in the folder, listed as not taken.
 *
 * YouTube (Session 25c): one video, as MP4 (video) or MP3 (sound only), at
 * the best quality up to 1080p (the best sound), or since alpha.24 the
 * Quality chosen in the window once the link is checked (no permission tick
 * since alpha.16: the owner, 6 Nov 2026, the sanstha approves
 * Drashti). Drashti runs yt-dlp for it (and yt-dlp runs Deno for
 * YouTube's player JavaScript); Drashti never signs in to YouTube. A
 * downloaded file holds only the video: YouTube sends its ads apart.
 */

import { IMAGE_EXTENSIONS } from './media';

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

/** The service named by a pasted address, before that service's shared-link checks. */
export function linkKind(raw: string): LinkKind | null {
  const host = parse(raw.trim())?.hostname.toLowerCase();
  if (host === undefined) return null;
  if (DROPBOX_HOSTS.has(host)) return 'dropbox';
  return isYouTubeHost(host) ? 'youtube' : null;
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

/** A caption language selected from yt-dlp’s metadata; source is its exact lookup code. */
export interface LinkCaptionTrack {
  language: string;
  source: string;
  kind: 'creator' | 'automatic';
}

export interface LinkCaptionPreferences {
  enabled: boolean;
  /** Null follows the downloads folder, in Captions; an explicit folder is never recreated if missing. */
  folder: string | null;
}

export interface LinkSavedCaptions {
  files: string[];
  failed: string[];
  learningSkipped: boolean;
  learningFolder: string | null;
}

/** A YouTube video, as yt-dlp describes it before the download (Session 25c). */
export interface VideoDetails {
  title: string;
  id?: string | null;
  channel?: string | null;
  uploadDate?: string | null;
  language?: string | null;
  captions?: LinkCaptionTrack[];
  /** In seconds, when YouTube says. */
  duration: number | null;
  /**
   * The heights it offers, best first, each with about how big its MP4 would be (null: not said). An upright video's
   * (a phone's, a Short: alpha.24, hunt S3-2) also says the short side of its picture, its width (`side`: 1080 for
   * 1080 × 1920, YouTube's own 1080p), by which it is named, begun with and judged; a download asks for its height.
   */
  heights: { height: number; side?: number; bytes: number | null }[];
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

/** Choices made in the link window; the media extension is supplied by Drashti. */
export interface LinkDownloadOptions {
  name?: string;
  captions?: boolean;
  /**
   * A YouTube video's **Quality** (alpha.24, the owner: "in video/audio download, we can select quality"), chosen
   * once the link is checked: a height the video offers for an MP4, or an MP3's bitrate in kbps (0: the best sound).
   * None: the usual, the best up to 1080p (an MP3: the best sound).
   */
  quality?: number;
}

/** What a YouTube download is to be: asked for with each download. */
export interface YouTubeChoice {
  type: YouTubeType;
  /** The height (MP4 only; MP3 takes the best sound). */
  height: number | null;
  /** An MP3's bitrate, when one was chosen under Quality (alpha.24); none: the best sound. */
  kbps?: number;
}

/** The MP3 bitrates the window offers after the best sound (kbps; alpha.24). */
export const MP3_BITRATES = [192, 128] as const;

/** One of the window's Quality choices: a height (MP4) or a bitrate (MP3; 0: the best sound), in words, about how big. */
export interface LinkQuality {
  value: number;
  label: string;
  bytes: number | null;
}

/** About how big an MP3 at this bitrate is, for a video this long (null: its length is not known). */
const mp3Bytes = (kbps: number, duration: number | null): number | null =>
  duration === null ? null : Math.round((kbps * 1000 * duration) / 8);

/**
 * The window's Quality choices for a checked YouTube video (alpha.24), and the one chosen to begin with. An MP4: every
 * height the video offers, best first, each with about how big its file is, the best up to 1080p to begin with (as
 * a Download with no choice takes; the smallest when every one is taller). Each is named by the short side of its
 * picture (hunt S3-2: an upright 1080 × 1920 is "1080p"), its value the height a download asks for. None when the
 * video lists no heights: no choice is shown, and a Download says what it says today. An MP3: the best sound to begin
 * with, then each bitrate.
 */
export function linkQualities(
  video: VideoDetails,
  audio: boolean,
): { options: LinkQuality[]; initial: number | null } {
  if (audio)
    return {
      options: [
        { value: 0, label: 'Best', bytes: video.soundBytes },
        ...MP3_BITRATES.map((kbps) => ({
          value: kbps,
          label: `${String(kbps)} kbps`,
          bytes: mp3Bytes(kbps, video.duration),
        })),
      ],
      initial: 0,
    };
  const options = video.heights.map((h) => ({
    value: h.height,
    label: heightLabel(sideOf(h)),
    bytes: h.bytes,
  }));
  return {
    options,
    initial: chosenHeight(video, DEFAULT_LINK_MAX_HEIGHT, null) ?? options.at(-1)?.value ?? null,
  };
}

/** A Download with no choice, when the video has no height at 1080p or below (as before alpha.24). */
const NONE_UP_TO_1080 = 'This video has no quality at or below 1080p. Paste another YouTube link.';

/**
 * What a Download takes (alpha.24): the Quality chosen, while the video offers it (above 1080p too, as the operator
 * chose it); with none chosen, the usual (the best up to 1080p, or the best sound). Anything else is refused in words.
 */
export function qualityChoice(
  video: VideoDetails,
  audio: boolean,
  picked: number | null | undefined,
): { ok: true; choice: YouTubeChoice } | { ok: false; message: string } {
  if (audio) {
    if (picked === undefined || picked === null || picked === 0)
      return { ok: true, choice: { type: 'mp3', height: null } };
    const kbps = MP3_BITRATES.find((offered) => offered === picked);
    return kbps === undefined
      ? {
          ok: false,
          message: `Choose Best, ${MP3_BITRATES.map((k) => `${String(k)} kbps`).join(' or ')} for the sound.`,
        }
      : { ok: true, choice: { type: 'mp3', height: null, kbps } };
  }
  if (picked === undefined || picked === null) {
    const height = chosenHeight(video, DEFAULT_LINK_MAX_HEIGHT, null);
    return height === null
      ? { ok: false, message: NONE_UP_TO_1080 }
      : { ok: true, choice: { type: 'mp4', height } };
  }
  return video.heights.some((h) => h.height === picked)
    ? { ok: true, choice: { type: 'mp4', height: picked } }
    : { ok: false, message: 'That quality is not offered by this video. Choose another under Quality.' };
}

/** About how big a download of this choice is: the MP4's height, the best sound's MP3, or an MP3 at its bitrate. */
export function choiceBytes(video: VideoDetails, choice: YouTubeChoice): number | null {
  if (choice.type === 'mp3') return choice.kbps ? mp3Bytes(choice.kbps, video.duration) : video.soundBytes;
  return video.heights.find((h) => h.height === choice.height)?.bytes ?? null;
}

/**
 * A choice in the status bar's words: "720p", "2160p (4K)", "MP3" or "MP3 at 128 kbps". With the video, an upright
 * one's height by the short side of its picture, as its Quality names it (1920 is "1080p" for 1080 × 1920).
 */
export const qualityWords = (choice: YouTubeChoice, video?: VideoDetails): string => {
  if (choice.type === 'mp3') return choice.kbps ? `MP3 at ${String(choice.kbps)} kbps` : 'MP3';
  const offered = video?.heights.find((h) => h.height === choice.height);
  return heightLabel(offered ? sideOf(offered) : (choice.height ?? 0));
};

/**
 * The short side of a quality's picture (alpha.24, hunt S3-2), by which it is named, begun with and judged against
 * 1080p: its height, or an upright video's width (1080 for YouTube's 1080 × 1920); its height when yt-dlp gave no
 * width.
 */
export const sideOf = (h: { height: number; side?: number }): number => h.side ?? h.height;

/** Is this MP4 Quality above the 1080p a Download begins with, by the short side of its picture (alpha.24)? */
export function aboveTheUsual(video: VideoDetails, height: number): boolean {
  const offered = video.heights.find((h) => h.height === height);
  return (offered ? sideOf(offered) : height) > DEFAULT_LINK_MAX_HEIGHT;
}

/**
 * The height an MP4 download asks for: the one picked, while the video offers it and the setting allows
 * it; else the best the setting allows (the video's heights are best first); none when every one is
 * above the setting. The setting is judged by the short side of the picture (alpha.24, hunt S3-2): an
 * upright 1080 × 1920 is 1080p.
 */
export function chosenHeight(video: VideoDetails, maxHeight: number, picked: number | null): number | null {
  if (picked !== null && video.heights.some((h) => h.height === picked && sideOf(h) <= maxHeight))
    return picked;
  return video.heights.find((h) => sideOf(h) <= maxHeight)?.height ?? null;
}

/** Why a quality above the setting cannot be picked, and where it is changed. */
export const aboveTheSetting = (maxHeight: number): string =>
  `Above ${heightLabel(maxHeight)}, the highest video quality allowed. Change it under Highest video quality, above.`;

export type LinkPhase =
  /** Ready for a link. */
  | 'idle'
  | 'looking'
  /** The link was looked at; ready for the download. */
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
  /** The previous folder was unavailable, so this request uses the usual downloads folder. */
  folderFallback?: boolean;
  /** A safe title without the extension, for the editable Name field. */
  suggestedName?: string;
  downloadCaptions?: boolean;
  captionsFolder?: string;
  captions?: LinkSavedCaptions | null;
  progress: { done: number; total: number | null } | null;
  /** Why it waits, in words. */
  waitingFor: string | null;
  /** What went wrong, or how it stopped, in words. */
  message: string | null;
  /** A failed lookup or download may succeed on another attempt. */
  retryable?: boolean;
  /** What was saved: the folder, and the files in it (paths inside it). */
  saved: { folder: string; files: string[] } | null;
  /** Files saved but not imported, with why. */
  notTaken: NotTaken[];
  /** Videos above the highest quality whose copy that tall was imported (the originals stay in the folder). */
  fitted: string[];
  /** The highest video quality for this download. */
  maxHeight: LinkHeight;
  /** The import run of what was saved, once it started (its report). */
  runId: string | null;
  /** A YouTube download's type and height (an MP3's bitrate, when one was chosen), once it starts. */
  choice: YouTubeChoice | null;
  /** A Dropbox folder's own playlist (Session 26c), made when its import ended; opened as it is made. */
  playlist: { id: string; name: string } | null;
  /** The relative path of each file in a folder imported into an existing playlist. */
  folderFiles?: { path: string; relative: string }[];
  /** A folder's PDFs and pictures, saved but not added yet (paths inside it): one button adds them. */
  waiting: string[];
  /** How many of those the button added, once it has. */
  waitingAdded: number | null;
  /**
   * The playlist the last download went into (Session 54, F1), which the dialog offers first; null before any.
   * Kept with the library's settings, as every person's.
   */
  lastPlaylist: string | null;
}

/** A refusal from Simple Mode carries no view; the service's own refusals do. */
export type LinkResult = { ok: true; view: LinkView } | { ok: false; message: string; view?: LinkView };

/** Kept free on the disk the files are saved on, as the import and conversions do. */
export const LINK_KEEP_FREE_BYTES = 2 * 1024 ** 3;

/** Dropbox's own limits for a folder downloaded as a zip (its help pages, read 11 Oct 2026). */
export const MAX_ZIP_FILES = 10_000;
export const MAX_ZIP_BYTES = 250 * 1024 ** 3;

/**
 * A Dropbox folder's PDFs and pictures (Session 26c, PLAN §7): saved, then added with one button, not by
 * themselves. Every picture the import takes (Session 55, Part 5: one list, in shared/media.ts).
 */
export function waitingKind(name: string): boolean {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return ext === 'pdf' || IMAGE_EXTENSIONS.includes(ext);
}

/**
 * What is imported from a Dropbox link: PowerPoint files and MP4 videos (PLAN §7), and sounds (Session 44: a
 * folder's sounds also show in Audio, music/folder-audios.ts).
 */
export function takenKind(name: string): 'powerpoint' | 'video' | 'sound' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pptx')) return 'powerpoint';
  if (lower.endsWith('.mp4')) return 'video';
  if (/\.(mp3|m4a|aac|wav|aiff?|flac|ogg|opus)$/u.test(lower)) return 'sound';
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
export const NOT_TAKEN_REASON =
  'Not a PowerPoint file (.pptx), an MP4 video or a sound, so it was not imported.';
