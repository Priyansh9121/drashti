import type { Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { testFfmpeg } from './stream-helpers';

/*
 * Test media, made while the test runs (nothing is committed): a PNG drawn
 * on a canvas, and short videos made by the bundled FFmpeg (a WebM, or an
 * MP4), optionally with a tone as their sound.
 */

/** Draw a flat-colour PNG in the page and save it. */
export async function makeTestImage(
  page: Page,
  file: string,
  options: { width?: number; height?: number; color?: string } = {},
): Promise<string> {
  const base64 = await page.evaluate(
    ({ width, height, color }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      return canvas.toDataURL('image/png').split(',')[1] ?? '';
    },
    { width: options.width ?? 64, height: options.height ?? 36, color: options.color ?? '#3a6ea5' },
  );
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

export interface TestVideoOptions {
  seconds: number;
  width?: number;
  height?: number;
  fps?: number;
  /** A tone in Hz for the sound track; no sound when left out. */
  tone?: number;
  /** Background colour hue, so two test videos look different. */
  hue?: number;
  /**
   * H.264 in an MP4 instead of VP8 in a WebM (Sessions 31–36): macOS and Windows decode it in the GPU process,
   * as they do the mandir's own videos. No sound.
   */
  h264?: boolean;
}

/**
 * How far past the length asked a test video may run: its sound's last frame, Opus's 20 ms ones counted from its
 * codec's own delay.
 */
const LONGER_MS = 250;

/** The test video's background, CSS's hsl(hue 60% 35%), as FFmpeg's 0xRRGGBB. */
function background(hue: number): string {
  const a = 0.6 * Math.min(0.35, 1 - 0.35);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (0.35 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `0x${[channel(0), channel(8), channel(4)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const run = promisify(execFile);

/**
 * A short test video, made by the bundled FFmpeg: a flat colour with a white bar that crosses it once over the clip,
 * a keyframe every 250 ms (so seeking a test video is quick), and a tone as its sound when asked. A WebM (VP8, and
 * Opus) written live, as a page's recorder writes one, with its duration written in; or, with `h264`, an MP4.
 * Recorded in the page in real time before, it came out short or long on a busy CI Mac in three of alpha.14's gates
 * (3–5 Nov 2026: a page held up records frames for only part of the time, five tries in a row); made by FFmpeg it is
 * the length asked whatever the page is doing. The page is no longer used: `_page` stays for the tests that pass it.
 */
export async function makeTestVideo(_page: Page, file: string, options: TestVideoOptions): Promise<string> {
  const ffmpeg = testFfmpeg();
  if (!ffmpeg) throw new Error('A test video needs the bundled FFmpeg (node scripts/fetch-ffmpeg.mjs).');
  const { seconds, width = 320, height = 180, fps = 30, tone = 0, hue = 210, h264 = false } = options;
  const sound = tone > 0 && !h264;
  const graph = [
    `color=c=${background(hue)}:s=${String(width)}x${String(height)}:r=${String(fps)}:d=${String(seconds)}[bg]`,
    `color=c=white:s=${String(Math.max(2, Math.round(width / 64)))}x${String(height)}:r=${String(fps)}:d=${String(seconds)}[bar]`,
    `[bg][bar]overlay=x=t*${String(width / seconds)}:y=0:shortest=1,format=yuv420p[v]`,
    // As the page's oscillator was: a sine at full scale, on both channels.
    ...(sound
      ? [
          `aevalsrc=exprs=sin(2*PI*${String(tone)}*t)|sin(2*PI*${String(tone)}*t):c=stereo:s=48000:d=${String(seconds)}[a]`,
        ]
      : []),
  ].join(';');
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-filter_complex', graph, '-map', '[v]'];
  const keyframes = ['-force_key_frames', 'expr:gte(t,n_forced*0.25)', '-b:v', '400k'];
  if (h264) {
    const mp4 = [
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-profile:v',
      'baseline',
      '-movflags',
      '+faststart',
    ];
    await run(ffmpeg, [...args, ...mp4, ...keyframes, '-y', file]);
    return file;
  }
  const vp8 = [
    '-c:v',
    'libvpx',
    '-deadline',
    'realtime',
    '-cpu-used',
    '8',
    '-auto-alt-ref',
    '0',
    '-lag-in-frames',
    '0',
  ];
  const opus = sound ? ['-map', '[a]', '-c:a', 'libopus', '-b:a', '128k'] : [];
  // To a pipe: written live, as a recorder writes it (no cues to point into it).
  const { stdout } = await run(
    ffmpeg,
    [...args, ...vp8, ...keyframes, ...opus, '-write_crc32', '0', '-f', 'webm', 'pipe:1'],
    {
      encoding: 'buffer',
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  // Its pictures run to its end, and nothing runs past it: made so every time, checked anyway.
  const askedMs = seconds * 1000;
  const last = Math.max(0, ...webmVideoFrameTimes(stdout));
  const longest = webmLastFrameMs(stdout);
  if (last < askedMs - (2 * 1000) / fps || longest > askedMs + LONGER_MS)
    throw new Error(
      `FFmpeg made a test video whose frames end at ${String(Math.round(last))} ms and run to ${String(Math.round(longest))} ms, ${String(askedMs)} ms asked.`,
    );
  writeFileSync(file, setWebmDuration(stdout, askedMs));
  return file;
}

// ---- WebM --------------------------------------------------------------------

const EBML_HEADER = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const SEEK_HEAD = 0x114d9b74;
const VOID = 0xec;
const CUES = 0x1c53bb6b;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;

interface Element {
  id: number;
  start: number;
  dataStart: number;
  /** Infinity for an element of unknown size (live WebM leaves the segment open). */
  end: number;
}

/** An EBML variable-length number: ids keep their length marker, sizes do not. */
function readVint(buf: Uint8Array, at: number, keepMarker: boolean): { value: number; length: number } {
  const first = buf[at] ?? 0;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8) throw new Error(`bad EBML number at ${at}`);
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const b = buf[at + i] ?? 0;
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { value: !keepMarker && allOnes ? Infinity : value, length };
}

function readElement(buf: Uint8Array, at: number): Element {
  const id = readVint(buf, at, true);
  const size = readVint(buf, at + id.length, false);
  const dataStart = at + id.length + size.length;
  return { id: id.value, start: at, dataStart, end: dataStart + size.value };
}

function children(buf: Uint8Array, parent: Element): Element[] {
  const out: Element[] = [];
  let at = parent.dataStart;
  const end = Math.min(parent.end, buf.length);
  while (at < end) {
    const e = readElement(buf, at);
    out.push(e);
    if (!Number.isFinite(e.end)) break;
    at = e.end;
  }
  return out;
}

const TRACK_ENTRY = 0xae;
const TRACK_NUMBER = 0xd7;
const TRACK_TYPE = 0x83;
const VIDEO_TRACK = 1;
const CLUSTER_TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const BLOCK = 0xa1;
/** Entered rather than skipped: Tracks, a TrackEntry, Info, a Cluster and a BlockGroup. */
const MASTERS = new Set([0x1654ae6b, TRACK_ENTRY, INFO, 0x1f43b675, 0xa0]);

/**
 * When each video frame of a WebM is shown (ms), in the file's order. Read element by element through the
 * segment, entering the elements that hold frames, so MediaRecorder's live clusters of unknown size read too.
 */
export function webmVideoFrameTimes(webm: Uint8Array): number[] {
  return frameTimes(webm, 'video');
}

/** When a WebM's last frame of any track, its pictures' or its sound's, is shown (ms): as far as it plays. */
export function webmLastFrameMs(webm: Uint8Array): number {
  return Math.max(0, ...frameTimes(webm, 'every'));
}

function frameTimes(webm: Uint8Array, tracks: 'video' | 'every'): number[] {
  const header = readElement(webm, 0);
  const segment = readElement(webm, header.end);
  const uint = (e: Element) => webm.subarray(e.dataStart, e.end).reduce((n, b) => n * 256 + b, 0);
  let scale = 1_000_000;
  let entry = { number: 0, type: 0 };
  let videoTrack = 0;
  let cluster = 0;
  const times: number[] = [];
  let at = segment.dataStart;
  while (at < webm.length) {
    const e = readElement(webm, at);
    if (MASTERS.has(e.id)) {
      if (e.id === TRACK_ENTRY) entry = { number: 0, type: 0 };
      at = e.dataStart;
      continue;
    }
    if (!Number.isFinite(e.end)) break;
    if (e.id === TIMECODE_SCALE) scale = uint(e);
    else if (e.id === TRACK_NUMBER || e.id === TRACK_TYPE) {
      entry = e.id === TRACK_NUMBER ? { ...entry, number: uint(e) } : { ...entry, type: uint(e) };
      if (entry.type === VIDEO_TRACK && entry.number > 0) videoTrack = entry.number;
    } else if (e.id === CLUSTER_TIMECODE) cluster = uint(e);
    else if (e.id === SIMPLE_BLOCK || e.id === BLOCK) {
      const track = readVint(webm, e.dataStart, false);
      // The frame's time from its cluster's, a signed 16-bit number.
      const hi = webm[e.dataStart + track.length] ?? 0;
      const relative = hi * 256 + (webm[e.dataStart + track.length + 1] ?? 0) - (hi & 0x80 ? 0x10000 : 0);
      if (tracks === 'every' || track.value === videoTrack)
        times.push(((cluster + relative) * scale) / 1_000_000);
    }
    at = e.end;
  }
  return times;
}

/** The duration written in a WebM's Info element (ms), or 0 when it has none. */
export function webmDurationMs(webm: Uint8Array): number {
  const header = readElement(webm, 0);
  const segment = readElement(webm, header.end);
  const info = children(webm, segment).find((e) => e.id === INFO);
  if (!info) return 0;
  let scale = 1_000_000;
  let duration = 0;
  for (const c of children(webm, info)) {
    const data = Buffer.from(webm.subarray(c.dataStart, c.end));
    if (c.id === TIMECODE_SCALE) scale = data.reduce((n, b) => n * 256 + b, 0);
    else if (c.id === DURATION) duration = data.length === 4 ? data.readFloatBE(0) : data.readDoubleBE(0);
  }
  return (duration * scale) / 1_000_000;
}

/** An element id and an 8-byte size, so the size never needs to fit a shorter field. */
function elementHeader(id: number[], size: number): Buffer {
  const out = Buffer.alloc(id.length + 8);
  out.set(id);
  out[id.length] = 0x01;
  let n = size;
  for (let i = 7; i >= 1; i--) {
    out[id.length + i] = n % 256;
    n = Math.floor(n / 256);
  }
  return out;
}

/**
 * MediaRecorder writes live WebM: no duration, so a player cannot tell how
 * long it is until it reaches the end. Write the duration into the Info
 * element, as a file made by an editor would have.
 */
export function setWebmDuration(webm: Uint8Array, durationMs: number): Buffer {
  const header = readElement(webm, 0);
  if (header.id !== EBML_HEADER) throw new Error('not a WebM file');
  const segment = readElement(webm, header.end);
  if (segment.id !== SEGMENT) throw new Error('no WebM segment');
  const top = children(webm, segment);
  // Cues would point to the wrong places once Info grows: a live WebM has none.
  if (top.some((e) => e.id === CUES)) throw new Error('WebM with cues is not supported');
  const info = top.find((e) => e.id === INFO);
  if (!info) throw new Error('WebM without an Info element');
  let scale = 1_000_000;
  const kept: Uint8Array[] = [];
  for (const c of children(webm, info)) {
    if (c.id === DURATION) continue;
    if (c.id === TIMECODE_SCALE) scale = webm.subarray(c.dataStart, c.end).reduce((n, b) => n * 256 + b, 0);
    kept.push(webm.subarray(c.start, c.end));
  }
  const duration = Buffer.alloc(8);
  duration.writeDoubleBE((durationMs * 1_000_000) / scale);
  kept.push(Buffer.concat([Buffer.from([0x44, 0x89, 0x88]), duration]));
  const infoData = Buffer.concat(kept);
  const newInfo = Buffer.concat([elementHeader([0x15, 0x49, 0xa9, 0x66], infoData.length), infoData]);
  // Before Info, a seek index (FFmpeg writes one, with room after it) is left out: its offsets would move, and nothing
  // needs it. MediaRecorder never writes one.
  const before = top.filter((e) => e.end <= info.start && e.id !== SEEK_HEAD && e.id !== VOID);
  const leftOut = info.start - segment.dataStart - before.reduce((n, e) => n + e.end - e.start, 0);
  const grow = newInfo.length - (info.end - info.start) - leftOut;
  const segmentHeader = Number.isFinite(segment.end)
    ? elementHeader([0x18, 0x53, 0x80, 0x67], segment.end - segment.dataStart + grow)
    : webm.subarray(segment.start, segment.dataStart);
  return Buffer.concat([
    webm.subarray(0, header.end),
    segmentHeader,
    ...before.map((e) => webm.subarray(e.start, e.end)),
    newInfo,
    webm.subarray(info.end),
  ]);
}

/** A WAV file of a soft sine tone (placeholder sound only): 16-bit mono PCM, which Chromium plays. */
export function makeTestTone(file: string, options: { seconds: number; hz?: number; rate?: number }): string {
  const rate = options.rate ?? 8000;
  const samples = Math.round(options.seconds * rate);
  const data = Buffer.alloc(samples * 2);
  const hz = options.hz ?? 440;
  for (let i = 0; i < samples; i++)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 3000), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
  return file;
}
