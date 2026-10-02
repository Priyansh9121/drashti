import type { Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/*
 * Test media, made while the test runs (nothing is committed): a PNG drawn
 * on a canvas, and short WebM videos recorded from a canvas with
 * MediaRecorder, optionally with a tone as their sound.
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
}

/** Record a short WebM in the page (in real time) and save it, with its duration written in. */
export async function makeTestVideo(page: Page, file: string, options: TestVideoOptions): Promise<string> {
  // A page that draws nothing for a while (a busy machine) records nothing: then it records again.
  for (let attempt = 1; ; attempt++) {
    const recorded = await recordWebm(page, options);
    const bytes = Buffer.from(recorded.base64, 'base64');
    if (bytes.length >= 4 && bytes.readUInt32BE(0) === EBML_HEADER) {
      writeFileSync(file, setWebmDuration(bytes, recorded.ms));
      return file;
    }
    if (attempt === 3) throw new Error(`The page recorded no video in three tries (${bytes.length} bytes).`);
  }
}

/** A WebM of a canvas recorded in the page, in real time, and how long the recording ran. */
function recordWebm(page: Page, options: TestVideoOptions): Promise<{ base64: string; ms: number }> {
  return page.evaluate(
    async ({ seconds, width, height, fps, tone, hue }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      const stream = canvas.captureStream(fps);
      let audio: AudioContext | null = null;
      if (tone > 0) {
        audio = new AudioContext();
        const osc = audio.createOscillator();
        osc.frequency.value = tone;
        const dest = audio.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        const track = dest.stream.getAudioTracks()[0];
        if (track) stream.addTrack(track);
      }
      const mimeType = tone > 0 ? 'video/webm;codecs=vp8,opus' : 'video/webm;codecs=vp8';
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 400_000,
        // Frequent key frames, so seeking a test video is quick.
        videoKeyFrameIntervalDuration: 250,
      } as MediaRecorderOptions);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      const stopped = new Promise((resolve) => (recorder.onstop = resolve));
      const draw = (t: number) => {
        ctx.fillStyle = `hsl(${hue} 60% 35%)`;
        ctx.fillRect(0, 0, width, height);
        // A bar that crosses the frame once over the clip, and the time.
        ctx.fillStyle = '#fff';
        ctx.fillRect((t / seconds) * width, 0, Math.max(2, width / 64), height);
        ctx.font = `${Math.round(height / 5)}px sans-serif`;
        ctx.fillText(t.toFixed(2), width / 20, height / 3);
      };
      draw(0);
      recorder.start(100);
      const start = performance.now();
      while (performance.now() - start < seconds * 1000) {
        draw((performance.now() - start) / 1000);
        await new Promise((resolve) => setTimeout(resolve, 1000 / fps));
      }
      const ms = performance.now() - start;
      recorder.stop();
      await stopped;
      await audio?.close();
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { base64: btoa(binary), ms };
    },
    { width: 320, height: 180, fps: 30, tone: 0, hue: 210, ...options },
  );
}

// ---- WebM --------------------------------------------------------------------

const EBML_HEADER = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const SEEK_HEAD = 0x114d9b74;
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
  // Offsets in a seek index would move; MediaRecorder never writes one.
  if (top.some((e) => e.id === SEEK_HEAD)) throw new Error('WebM with a seek index is not supported');
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
  const grow = newInfo.length - (info.end - info.start);
  const segmentHeader = Number.isFinite(segment.end)
    ? elementHeader([0x18, 0x53, 0x80, 0x67], segment.end - segment.dataStart + grow)
    : webm.subarray(segment.start, segment.dataStart);
  return Buffer.concat([
    webm.subarray(0, header.end),
    segmentHeader,
    webm.subarray(segment.dataStart, info.start),
    newInfo,
    webm.subarray(info.end),
  ]);
}
