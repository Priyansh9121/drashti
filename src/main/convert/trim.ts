import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MediaInfo } from './plan';

/*
 * A video's part between its start and end, saved as an MP4 of its own
 * (Session 26e), by copying its streams as they are: no re-encoding, so
 * the picture and the sound are exactly the original's. A copy can only
 * begin at a clean frame (a keyframe), so it begins at the keyframe at or
 * before the start, which the timeline shows before saving. Rotation and
 * the file's details are kept, and it starts playing as it downloads
 * (+faststart). The file the video came from is never changed.
 */

/** Pictures an MP4 holds, as FFmpeg names them. */
const MP4_VIDEO = new Set(['h264', 'hevc', 'av1', 'vp9', 'mpeg4', 'mpeg2video', 'mpeg1video']);
/** Sounds an MP4 holds. */
const MP4_AUDIO = new Set(['aac', 'mp3', 'ac3', 'eac3', 'opus', 'alac', 'mp2']);

/** A codec as the operator might know it. */
const KNOWN: Record<string, string> = {
  vp8: 'VP8',
  prores: 'ProRes',
  dnxhd: 'DNxHD',
  wmv3: 'Windows Media Video',
  vc1: 'VC-1',
  theora: 'Theora',
  vorbis: 'Vorbis',
  wmav2: 'Windows Media Audio',
  pcm_s16le: 'uncompressed sound (PCM)',
  pcm_s24le: 'uncompressed sound (PCM)',
  flac: 'FLAC',
};
const named = (codec: string) => KNOWN[codec] ?? codec.toUpperCase();

/** Why a video cannot be saved as an MP4 by copying it (its picture or sound is a kind an MP4 cannot hold), or null. */
export function mp4Problem(info: MediaInfo): string | null {
  if (!info.video || info.video.still) return 'FFmpeg found no video in it to save.';
  if (!MP4_VIDEO.has(info.video.codec))
    return `Its picture is ${named(info.video.codec)}, which an MP4 cannot hold, so it cannot be saved as an MP4 without converting it. Convert it first (its Convert button), then save the part from the copy.`;
  if (info.audio && !MP4_AUDIO.has(info.audio.codec))
    return `Its sound is ${named(info.audio.codec)}, which an MP4 cannot hold, so it cannot be saved as an MP4 without converting it.`;
  return null;
}

/** Seconds, as FFmpeg reads them. */
const secs = (ms: number) => (Math.max(0, ms) / 1000).toFixed(3);

/**
 * FFmpeg's arguments to list a video's keyframes from the one at or before `atMs`: seeking without
 * dropping what comes before the time (as a copy's seek does), only keyframes decoded (quick), each written
 * by showinfo with its time. The first is the keyframe a copy from `atMs` begins at; the caller stops it
 * there.
 */
export function keyframeArgs(file: string, atMs: number): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-copyts',
    '-noaccurate_seek',
    '-ss',
    secs(atMs),
    '-skip_frame',
    'nokey',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-an',
    '-sn',
    '-vf',
    'showinfo',
    '-f',
    'null',
    '-',
  ];
}

/**
 * What the keyframe listing has said so far: the file's own start time (from "start: 1.400000", so times
 * count from its beginning, as -ss does), and each keyframe's time in ms from the beginning, in order.
 */
export function readKeyframes(text: string): { startMs: number; keys: number[] } {
  const start = /Duration: [^,]*, start: (-?\d+(?:\.\d+)?)/u.exec(text);
  const startMs = start ? Math.round(Number(start[1]) * 1000) : 0;
  const keys: number[] = [];
  for (const m of text.matchAll(/\bpts_time:\s*(-?\d+(?:\.\d+)?)[^\n]*?\biskey:1/gu))
    keys.push(Math.round(Number(m[1]) * 1000) - startMs);
  return { startMs, keys };
}

/** The keyframe at or before `atMs` among `keys`, or null. */
export function keyframeAtOrBefore(keys: readonly number[], atMs: number): number | null {
  let found: number | null = null;
  for (const k of keys) if (k <= atMs + 1 && (found === null || k > found)) found = k;
  return found;
}

/**
 * FFmpeg's arguments to save `input` from the keyframe `fromMs` to `toMs` as `output`, every picture and
 * sound stream copied as it is (progress on stderr). `readRate` (tests only): read no faster than it
 * plays, so a save is still going when a test quits.
 */
export function trimArgs(
  input: string,
  output: string,
  fromMs: number,
  toMs: number,
  readRate = false,
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostats',
    '-progress',
    'pipe:2',
    '-y',
    ...(readRate ? ['-readrate', '1'] : []),
    '-ss',
    secs(fromMs),
    '-i',
    input,
    '-t',
    secs(toMs - fromMs),
    // Every picture (not a cover picture) and every sound, as they are; the file's details too.
    '-map',
    '0:V?',
    '-map',
    '0:a?',
    '-c',
    'copy',
    '-map_metadata',
    '0',
    '-avoid_negative_ts',
    'make_zero',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    output,
  ];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A length as a saved file's name says it: "4m 00s", "1h 02m 05s", "0m 45s". */
export function lengthName(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${String(h)}h ${pad(m)}m ${pad(s % 60)}s` : `${String(m)}m ${pad(s % 60)}s`;
}

/** The name a saved part gets to begin with: "<name> (4m 00s).mp4", its name made safe for any disk. */
export function savedFileName(mediaName: string, lengthMs: number): string {
  const base =
    mediaName
      .replace(/\.[^.]*$/u, '')
      .replace(/[\\/:*?"<>|]/gu, '-')
      .trim() || 'Video';
  return `${base} (${lengthName(lengthMs)}).mp4`;
}

/** `name` in `dir`, or the first "name (2)" there is not: never over a file already there. */
export function freeFileName(
  dir: string,
  name: string,
  taken: (path: string) => boolean = existsSync,
): string {
  if (!taken(join(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) {
    const next = `${stem} (${String(n)})${ext}`;
    if (!taken(join(dir, next))) return next;
  }
}
