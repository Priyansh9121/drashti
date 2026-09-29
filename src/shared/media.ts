/*
 * How Drashti's windows load library media. They are sandboxed and never see
 * file paths: they ask the main process for a media item by id, through the
 * drashti-media:// scheme (src/main/media/media-protocol.ts).
 */

export const MEDIA_SCHEME = 'drashti-media';

/** A media id as the library stores it (a UUID); nothing else can name a file. */
export const MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** The URL that loads a media item's file. */
export function mediaUrl(mediaId: string): string {
  return `${MEDIA_SCHEME}://media/${mediaId}`;
}

/**
 * The URL of a small JPEG of an image or video (a still frame), for
 * thumbnails. `version` changes the URL once a still has just been made.
 */
export function stillUrl(mediaId: string, version = 0): string {
  return `${MEDIA_SCHEME}://still/${mediaId}${version > 0 ? `?v=${version}` : ''}`;
}

/** Stills are at most this wide (thumbnails are smaller), and this many bytes. */
export const STILL_WIDTH = 480;
export const STILL_MAX_BYTES = 1024 * 1024;

/**
 * Where a playback that started at `startedAt` (ms since the epoch) is at
 * `now`, in seconds: looping videos wrap, others stop at the end. Files that
 * do not say how long they are start from the top.
 */
export function playbackPosition(
  playback: { startedAt: number; loop: boolean },
  duration: number,
  now: number,
): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const elapsed = Math.max(0, (now - playback.startedAt) / 1000);
  return playback.loop ? elapsed % duration : Math.min(elapsed, duration);
}

/**
 * How far a playing file is from where the shared clock says it should be,
 * in seconds (+ ahead, - behind). Across a loop's end, 3.9 s and 0.1 s of a
 * 4 s file are 0.2 s apart, not 3.8 s.
 */
export function playbackOffset(current: number, expected: number, duration: number, loop: boolean): number {
  const d = current - expected;
  if (!loop || !Number.isFinite(duration) || duration <= 0) return d;
  return ((((d + duration / 2) % duration) + duration) % duration) - duration / 2;
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
