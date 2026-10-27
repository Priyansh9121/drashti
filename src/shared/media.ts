/*
 * How Drashti's windows load library media. They are sandboxed and never see
 * file paths: they ask the main process for a media item by id, through the
 * drashti-media:// scheme (src/main/media/media-protocol.ts).
 */

export const MEDIA_SCHEME = 'drashti-media';

/** A media id as the library stores it (a UUID); nothing else can name a file. */
export const MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The videos Drashti takes, by extension, wherever it takes media: Import…, a drop, the drop folder, a
 * folder playlist (src/main/import/scan.ts). Session 50 added the common ones FFmpeg reads; what Drashti's
 * player cannot play is converted by itself at import (src/main/convert/plan.ts says which).
 */
export const VIDEO_EXTENSIONS: string[] = [
  'mp4',
  'm4v',
  'mov',
  'qt',
  'avi',
  'wmv',
  'mkv',
  'mpg',
  'mpeg',
  'webm',
  'mts',
  'm2ts',
  // Session 50.
  '3gp',
  '3g2',
  'flv',
  'f4v',
  'ogv',
  'ts',
  'm2t',
  'vob',
  'mxf',
  'dv',
  'asf',
  'divx',
  'rm',
  'rmvb',
];

/** The sounds Drashti takes (Audio's Import offers just these, Session 44), as the videos are. */
export const SOUND_EXTENSIONS: string[] = [
  'mp3',
  'wav',
  'aif',
  'aiff',
  'm4a',
  'aac',
  'flac',
  'ogg',
  'oga',
  'opus',
  'wma',
  // Session 50.
  'mka',
  'ac3',
  'eac3',
  'dts',
  'caf',
  'amr',
  'ape',
  'wv',
  'mp2',
  'au',
  'aifc',
  'm4b',
  'weba',
  'm4r',
  'mpa',
  'ra',
];

/**
 * The URL that loads a media item's file. A later try (a node's copy that landed after the first
 * load failed) gets a URL of its own: Chromium fails a URL that failed a moment ago at once, without
 * asking for it again, for up to 30 s or more. The main process reads only the path.
 */
export function mediaUrl(mediaId: string, attempt = 0): string {
  return `${MEDIA_SCHEME}://media/${mediaId}${attempt > 0 ? `?try=${attempt}` : ''}`;
}

/**
 * The URL of a small JPEG of an image or video (a still frame), for
 * thumbnails. `version` changes the URL once a still has just been made.
 */
export function stillUrl(mediaId: string, version = 0): string {
  return `${MEDIA_SCHEME}://still/${mediaId}${version > 0 ? `?v=${version}` : ''}`;
}

/**
 * The URL of a picture's sharpened copy (Session 26f), made once at the sharpness `step` of its look (5 to
 * 100): the screens draw it in place of the picture, so none of them draws a filter. A later try gets a URL of
 * its own, as mediaUrl's does. The main process reads only the path.
 */
export function sharpenedUrl(mediaId: string, step: number, attempt = 0): string {
  return `${MEDIA_SCHEME}://sharp/${mediaId}/${String(step)}${attempt > 0 ? `?try=${attempt}` : ''}`;
}

/**
 * A sharpened copy as one more file of its own (a node copies it as it copies media, a phone's preview is
 * made from it): the picture's id and the step. Never a library id: those are UUIDs, without "_".
 */
export const copyMediaId = (mediaId: string, step: number): string => `${mediaId}_s${String(step)}`;

/** The picture and step a copy's id names, or null for any other id. */
export function copyOfId(id: string): { mediaId: string; step: number } | null {
  const m = /^([A-Za-z0-9-]{1,100})_s(\d{1,3})$/u.exec(id);
  const step = Number(m?.[2]);
  return m?.[1] && step >= 5 && step <= 100 && step % 5 === 0 ? { mediaId: m[1], step } : null;
}

/** Stills are at most this wide (thumbnails are smaller), and this many bytes. */
export const STILL_WIDTH = 480;
export const STILL_MAX_BYTES = 1024 * 1024;

/** A start and an end point a file plays between (Session 14; ms into the file). */
export interface PlaybackClip {
  startMs: number;
  endMs: number | null;
}

/** A jump (to a marker): at `at` (ms since the epoch) the playback was at `toMs` into the file. */
export interface PlaybackSeek {
  at: number;
  toMs: number;
  /**
   * Paused there from `at` (Session 54: the time bar's Pause): it waits at `toMs`, on every screen alike, until Play
   * plays it on from there, as a new jump. Left out while it plays.
   */
  paused?: boolean;
  /**
   * Not played yet (Session 54, C2): a deck's video or sound before its click, waiting at its start point with its
   * poster shown (or hidden, when its deck says so). Always paused too; Play or a move from the time bar plays it or
   * moves it, as any pause, and it is no longer waiting.
   */
  waiting?: boolean;
}

export interface PlaybackClock {
  startedAt: number;
  loop: boolean;
  clip?: PlaybackClip;
  seek?: PlaybackSeek;
}

/** Where a file plays between, in seconds (the whole file when it has no start and end points). */
export function playbackBounds(
  clip: PlaybackClip | undefined,
  duration: number,
): { start: number; end: number } {
  if (!Number.isFinite(duration) || duration <= 0) return { start: 0, end: 0 };
  const start = Math.min(duration, Math.max(0, (clip?.startMs ?? 0) / 1000));
  const end = clip?.endMs != null ? Math.min(duration, Math.max(start, clip.endMs / 1000)) : duration;
  return { start, end };
}

/**
 * Where a playback that started at `startedAt` (ms since the epoch) is at
 * `now`, in seconds: looping files wrap (between their start and end points,
 * when they have them), others stop at the end; after a jump, it goes on from
 * where the jump took it (paused there, Session 54, it waits). Files that do not
 * say how long they are start from the top.
 */
export function playbackPosition(playback: PlaybackClock, duration: number, now: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const { start, end } = playbackBounds(playback.clip, duration);
  const seek = playback.seek;
  const from = seek ? Math.min(end, Math.max(start, seek.toMs / 1000)) : start;
  const elapsed = seek?.paused ? 0 : Math.max(0, (now - (seek ? seek.at : playback.startedAt)) / 1000);
  const span = end - start;
  if (playback.loop && span > 0) return start + ((from - start + elapsed) % span);
  return Math.min(from + elapsed, end);
}

/** Where a file plays between, in ms (Session 50): playbackBounds in whole milliseconds, for the engine. */
export function playbackSpanMs(
  clip: PlaybackClip | undefined,
  durationMs: number,
): { start: number; end: number } {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return { start: 0, end: 0 };
  const start = Math.min(durationMs, Math.max(0, clip?.startMs ?? 0));
  const end = clip?.endMs != null ? Math.min(durationMs, Math.max(start, clip.endMs)) : durationMs;
  return { start, end };
}

/**
 * Where a file is at `now`, in ms into it (Session 50), as playbackPosition has it on every screen; an audio
 * playlist's track that is paused (`pausedAtMs`, played since its start point) waits where it is, as anything paused
 * by the time bar (Session 54, its seek's `paused`) does.
 */
export function playbackAtMs(
  playback: PlaybackClock & { pausedAtMs?: number },
  durationMs: number,
  now: number,
): number {
  const { start, end } = playbackSpanMs(playback.clip, durationMs);
  const span = end - start;
  /** `into` ms since the start point: round again when it loops, else held at the end. */
  const at = (into: number) =>
    playback.loop && span > 0 ? start + (into % span) : Math.min(start + into, end);
  if (playback.pausedAtMs !== undefined) return at(Math.max(0, playback.pausedAtMs));
  const seek = playback.seek;
  const from = seek ? Math.min(end, Math.max(start, seek.toMs)) : start;
  return at(from - start + (seek?.paused ? 0 : Math.max(0, now - (seek ? seek.at : playback.startedAt))));
}

/** How long a file has left at `now` (ms, Session 50): to its end point, or to the end of this time round. */
export function playbackLeftMs(
  playback: PlaybackClock & { pausedAtMs?: number },
  durationMs: number,
  now: number,
): number {
  return Math.max(0, playbackSpanMs(playback.clip, durationMs).end - playbackAtMs(playback, durationMs, now));
}

/**
 * How far a playing file is from where the shared clock says it should be,
 * in seconds (+ ahead, - behind). Across a loop's end, 3.9 s and 0.1 s of a
 * 4 s loop are 0.2 s apart, not 3.8 s (`span`: the loop's length, the whole
 * file or between its start and end points).
 */
export function playbackOffset(current: number, expected: number, span: number, loop: boolean): number {
  const d = current - expected;
  if (!loop || !Number.isFinite(span) || span <= 0) return d;
  return ((((d + span / 2) % span) + span) % span) - span / 2;
}

export type PlaybackCorrection = { seek: true } | { seek: false; rate: number };

export interface CorrectionLimits {
  /** Further out than this (seconds), jump. */
  jumpOver: number;
  /** The most the speed may change to catch up (0.05 is 5%). */
  maxRateChange: number;
}

/** Pictures jump sooner and change speed more than sound, where a skip or a pitch change is heard. */
export const PICTURE_LIMITS: CorrectionLimits = { jumpOver: 0.25, maxRateChange: 0.05 };
export const SOUND_LIMITS: CorrectionLimits = { jumpOver: 0.5, maxRateChange: 0.02 };

/**
 * How to bring a playing file back in step. Far out (a stall, a reload):
 * jump to the right place. A little out: play slightly faster or slower
 * until it is back, which nobody sees (and, within a few percent, nobody
 * hears). In step: normal speed.
 */
export function playbackCorrection(
  offset: number,
  limits: CorrectionLimits = PICTURE_LIMITS,
): PlaybackCorrection {
  if (Math.abs(offset) > limits.jumpOver) return { seek: true };
  if (Math.abs(offset) < 0.012) return { seek: false, rate: 1 };
  const change = Math.max(-limits.maxRateChange, Math.min(limits.maxRateChange, -offset * 2));
  return { seek: false, rate: 1 + change };
}

export type SaveStillResult = { ok: true } | { ok: false; message: string };
