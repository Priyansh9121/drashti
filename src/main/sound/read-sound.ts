import { type ChildProcess, spawn } from 'node:child_process';
import { constants, setPriority } from 'node:os';
import type { Loudness } from '../../shared/sound';
import { parseFfmpegInfo } from '../convert/plan';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';

/*
 * Reading a video's or sound's sound with the bundled FFmpeg (Session 55, Part 7), at the lowest priority, on one
 * core, never changing the file:
 *
 * - its loudness (EBU R128's integrated loudness and true peak: FFmpeg's ebur128 meter) and its length, decoding only
 *   its sound (P3: a stage layout's time left and the last 10 seconds know a file's length before it has played);
 * - the black and silence at its start and end (FFmpeg's blackdetect and silencedetect), within EDGE_S of each,
 *   for a video's start and end points (a From a Link… video, or its menu's Trim black and silence).
 */

/** How far into a video's start, and back from its end, black and silence are looked for (seconds). */
export const EDGE_S = 60;
/** Black and silence shorter than this at an end are left (seconds): a cut that small is not worth a point. */
export const LEAST_TRIM_S = 0.1;
/** What is left after the black and silence must be at least this long (seconds), or nothing is trimmed. */
export const LEAST_LEFT_S = 1;
/** A stretch counts as at the start when it begins this close to it (seconds). */
const AT_START_S = 0.05;
/**
 * A stretch counts as at the end when it ends this close to it (seconds): blackdetect ends a stretch at its last
 * frame's start, a whole frame before the end (a fifth of a second at 5 frames a second).
 */
const AT_END_S = 0.25;

/** What FFmpeg said, and how it ended. */
export interface FfmpegRun {
  text: string;
  code: number | null;
  timedOut: boolean;
}

/** Run FFmpeg on a file at the lowest priority, with the stream's clean environment, within `timeoutMs`. */
export function runFfmpeg(
  ffmpeg: string,
  args: readonly string[],
  timeoutMs: number,
  onSpawn?: (child: ChildProcess) => void,
): Promise<FfmpegRun> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, [...args], { windowsHide: true, env: ffmpegEnv() });
    try {
      if (child.pid !== undefined) setPriority(child.pid, constants.priority.PRIORITY_LOW);
    } catch {
      // Not allowed here: it runs at normal priority, on one core.
    }
    onSpawn?.(child);
    let text = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stderr.on('data', (d: Buffer) => {
      // What is said last matters (the meter's summary): a long run's earlier lines are let go.
      text = (text + d.toString()).slice(-200_000);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ text, code: null, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ text, code, timedOut });
    });
  });
}

/** A number FFmpeg printed: -inf (silence's peak) and anything unreadable are null. */
function numberOf(word: string | undefined): number | null {
  if (word === undefined) return null;
  const n = Number(word);
  return Number.isFinite(n) ? n : null;
}

/**
 * The ebur128 meter's summary: integrated loudness (I, LUFS) and true peak (dBTP; FFmpeg prints it as dBFS). Null when
 * no summary came (nothing was measured). A file of silence reads I −70 LUFS and a peak of −inf.
 */
export function parseLoudness(text: string): Loudness | null {
  const at = text.lastIndexOf('Summary:');
  if (at < 0) return null;
  const summary = text.slice(at);
  const i = /^\s*I:\s+(\S+)\s+LUFS/mu.exec(summary)?.[1];
  if (i === undefined) return null;
  const peak = /^\s*Peak:\s+(\S+)\s+dBFS/mu.exec(summary)?.[1];
  return { lufs: numberOf(i), peak: numberOf(peak) };
}

/** How long FFmpeg found the file to be: its container's Duration, else how far it decoded (the last time=). */
export function parseLength(text: string): number | null {
  const stated = parseFfmpegInfo(text).durationMs;
  if (stated !== null && stated > 0) return stated;
  let last: number | null = null;
  for (const m of text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/gu))
    last = Math.round(((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000);
  return last !== null && last > 0 ? last : null;
}

/** What a file's sound is: its length, whether it has a sound track, and its loudness (null: could not be read). */
export interface SoundRead {
  lengthMs: number | null;
  audio: boolean;
  loudness: Loudness | null;
  /** FFmpeg took longer than it may (a busy computer): read again another time. */
  timedOut?: true;
}

/** The time a file's sound may take to read: two minutes, and twice its length (a slow computer at low priority). */
export const readMsFor = (lengthMs: number | null): number => 120_000 + 2 * (lengthMs ?? 0);

/**
 * Measure a file's sound (its first sound track only, decoded on one core). A file with no sound track reads as no
 * sound (lufs null); one whose sound could not be read, or that took too long, as null loudness.
 */
export async function readSound(
  ffmpeg: string,
  file: string,
  options: { knownMs?: number | null; onSpawn?: (child: ChildProcess) => void; timeoutMs?: number } = {},
): Promise<SoundRead> {
  const run = await runFfmpeg(
    ffmpeg,
    [
      '-hide_banner',
      '-nostats',
      '-threads',
      '1',
      '-protocol_whitelist',
      'file',
      '-i',
      file,
      '-map',
      '0:a:0?',
      '-vn',
      '-filter_threads',
      '1',
      '-af',
      'ebur128=peak=true:framelog=verbose',
      '-f',
      'null',
      '-',
    ],
    options.timeoutMs ?? readMsFor(options.knownMs ?? null),
    options.onSpawn,
  );
  const info = parseFfmpegInfo(run.text);
  const lengthMs = run.timedOut ? info.durationMs : parseLength(run.text);
  const audio = info.audio !== null;
  if (run.timedOut) return { lengthMs, audio, loudness: null, timedOut: true };
  // No sound track: nothing to measure, and no sound.
  if (!audio) return { lengthMs, audio, loudness: info.container ? { lufs: null, peak: null } : null };
  const loudness = parseLoudness(run.text);
  return { lengthMs, audio, loudness };
}

/** A stretch of black or silence (seconds into the file). */
export interface Stretch {
  start: number;
  end: number;
}

/** The black and silence FFmpeg's blackdetect and silencedetect found, `offset` seconds into the file. */
export function parseEdges(
  text: string,
  offset = 0,
  spanEnd?: number,
): { black: Stretch[]; silence: Stretch[] } {
  const black: Stretch[] = [];
  for (const m of text.matchAll(/black_start:\s*(-?[\d.]+)\s+black_end:\s*(-?[\d.]+)/gu)) {
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (Number.isFinite(start) && Number.isFinite(end))
      black.push({ start: start + offset, end: end + offset });
  }
  const silence: Stretch[] = [];
  let open: number | null = null;
  for (const m of text.matchAll(/silence_(start|end):\s*(-?[\d.]+)/gu)) {
    const at = Number(m[2]);
    if (!Number.isFinite(at)) continue;
    if (m[1] === 'start') open = at;
    else if (open !== null) {
      silence.push({ start: open + offset, end: at + offset });
      open = null;
    }
  }
  // Silent to the end of what was read.
  if (open !== null && spanEnd !== undefined) silence.push({ start: open + offset, end: spanEnd });
  return { black, silence };
}

/**
 * A video's start and end points past the black and silence at its start and end (seconds), or null when there is
 * none worth a point, or nothing would be left. A stretch counts at the start only where the picture is black AND the
 * sound silent (a video with no sound track: where it is black), so nothing seen or heard is ever cut; the same at
 * the end.
 */
export function edgePoints(
  found: { black: Stretch[]; silence: Stretch[] },
  lengthS: number,
  audio: boolean,
): { startMs: number; endMs: number | null } | null {
  if (!Number.isFinite(lengthS) || lengthS <= 0) return null;
  const leading = (spans: Stretch[]) => spans.find((s) => s.start <= AT_START_S && s.end > s.start)?.end ?? 0;
  const trailing = (spans: Stretch[]) =>
    spans.findLast((s) => s.end >= lengthS - AT_END_S && s.end > s.start)?.start ?? lengthS;
  const start = Math.min(leading(found.black), audio ? leading(found.silence) : Number.POSITIVE_INFINITY);
  const end = Math.max(trailing(found.black), audio ? trailing(found.silence) : Number.NEGATIVE_INFINITY);
  const from = start >= LEAST_TRIM_S ? start : 0;
  const to = end <= lengthS - LEAST_TRIM_S ? end : lengthS;
  if (from === 0 && to === lengthS) return null;
  if (to - from < LEAST_LEFT_S) return null;
  return {
    startMs: Math.round(from * 1000),
    endMs: to === lengthS ? null : Math.round(to * 1000),
  };
}

/** blackdetect and silencedetect over what a run reads: its first picture and its first sound track. */
function edgeArgs(file: string, audio: boolean, window: { fromEnd?: number; first?: number }): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-threads',
    '1',
    '-protocol_whitelist',
    'file',
    ...(window.fromEnd !== undefined ? ['-sseof', `-${String(window.fromEnd)}`] : []),
    '-i',
    file,
    ...(window.first !== undefined ? ['-t', String(window.first)] : []),
    '-filter_threads',
    '1',
    '-map',
    '0:v:0',
    '-vf',
    'blackdetect=d=0.05:pic_th=0.98:pix_th=0.10',
    ...(audio ? ['-map', '0:a:0', '-af', 'silencedetect=n=-50dB:d=0.05'] : []),
    '-f',
    'null',
    '-',
  ];
}

/**
 * Find a video's black and silence at its start and end (within EDGE_S of each: the whole of a short one), at the
 * lowest priority on one core: its start and end points past them, or null for none (or when it could not be read).
 */
export async function findEdges(
  ffmpeg: string,
  file: string,
  lengthMs: number,
  audio: boolean,
  options: { onSpawn?: (child: ChildProcess) => void; timeoutMs?: number } = {},
): Promise<{ startMs: number; endMs: number | null } | null> {
  const lengthS = lengthMs / 1000;
  const timeout = options.timeoutMs ?? readMsFor(Math.min(lengthMs, 2 * EDGE_S * 1000));
  const runs =
    lengthS <= 2 * EDGE_S
      ? [{ args: edgeArgs(file, audio, {}), offset: 0 }]
      : [
          { args: edgeArgs(file, audio, { first: EDGE_S }), offset: 0 },
          { args: edgeArgs(file, audio, { fromEnd: EDGE_S }), offset: lengthS - EDGE_S },
        ];
  const black: Stretch[] = [];
  const silence: Stretch[] = [];
  for (const run of runs) {
    const done = await runFfmpeg(ffmpeg, run.args, timeout, options.onSpawn);
    if (done.timedOut || (done.code !== 0 && !/black_|silence_/u.test(done.text))) return null;
    const spanEnd = run.offset + (runs.length === 1 ? lengthS : EDGE_S);
    const found = parseEdges(done.text, run.offset, Math.min(spanEnd, lengthS));
    black.push(...found.black);
    silence.push(...found.silence);
  }
  return edgePoints({ black, silence }, lengthS, audio);
}
