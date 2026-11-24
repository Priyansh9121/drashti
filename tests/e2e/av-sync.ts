import { spawnSync } from 'node:child_process';

/*
 * Picture against sound, read back from what the stream's encoder wrote (a22-review-x86 M2 and S6): a recording's
 * frames by their times and brightness, its sound by its samples, both on the file's own clock (the bundled FFmpeg's
 * showinfo and ashowinfo, with -copyts, so neither is moved to start at 0 by itself). Generated media only.
 */

/** One frame of a recording: its time (s) and its mean brightness (0-255). */
export interface Frame {
  t: number;
  luma: number;
}

/** A recording's sound, mono: the time (s) of its first sample, its rate and its samples. */
export interface Sound {
  start: number;
  rate: number;
  samples: Float32Array;
}

const PTS_TIME = /\bpts_time:(-?\d+(?:\.\d+)?(?:e-?\d+)?)/u;

/** Each frame's time and mean brightness from FFmpeg's showinfo lines (one plane: gray). */
export function framesFrom(log: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of log.split(/\r?\n/u)) {
    if (!line.includes('Parsed_showinfo')) continue;
    const t = PTS_TIME.exec(line)?.[1];
    const luma = /\bmean:\[\s*(\d+(?:\.\d+)?)/u.exec(line)?.[1];
    if (t !== undefined && luma !== undefined) frames.push({ t: Number(t), luma: Number(luma) });
  }
  return frames.sort((a, b) => a.t - b.t);
}

/** The time (s) of the first sound frame FFmpeg's ashowinfo saw, or null. */
export function firstSoundTime(log: string): number | null {
  for (const line of log.split(/\r?\n/u)) {
    if (!line.includes('Parsed_ashowinfo')) continue;
    const t = PTS_TIME.exec(line)?.[1];
    if (t !== undefined) return Number(t);
  }
  return null;
}

/** A recording's frames, by the file's own times. */
export function readFrames(ffmpeg: string, file: string): Frame[] {
  const read = spawnSync(
    ffmpeg,
    [
      ...['-hide_banner', '-nostdin', '-copyts', '-i', file, '-an'],
      ...['-vf', 'scale=32:18,format=gray,showinfo', '-f', 'null', '-'],
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000, windowsHide: true },
  );
  if (read.status !== 0) throw new Error('The generated recording’s picture could not be read back');
  return framesFrom(read.stderr);
}

/** A recording's sound, mono at 48 kHz, by the file's own times. */
export function readSound(ffmpeg: string, file: string): Sound {
  const rate = 48_000;
  const read = spawnSync(
    ffmpeg,
    [
      ...['-hide_banner', '-nostdin', '-copyts', '-i', file, '-vn'],
      ...['-af', 'ashowinfo', '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'],
    ],
    { maxBuffer: 256 * 1024 * 1024, timeout: 120_000, windowsHide: true },
  );
  const start = firstSoundTime(read.stderr.toString());
  if (read.status !== 0 || start === null)
    throw new Error('The generated recording’s sound could not be read back');
  // Copied to a buffer of its own: the output's bytes need not start on a four-byte boundary.
  const bytes = new Uint8Array(read.stdout.length - (read.stdout.length % 4));
  bytes.set(read.stdout.subarray(0, bytes.length));
  return { start, rate, samples: new Float32Array(bytes.buffer) };
}

/**
 * When the picture turns bright (s): each frame past halfway from its dark to its bright frames, after one that was
 * not. None when the picture never changes that much (a frozen or empty recording).
 */
export function flashTimes(frames: readonly Frame[]): number[] {
  const lumas = frames.map((f) => f.luma).sort((a, b) => a - b);
  const dark = lumas[Math.floor(lumas.length * 0.02)] ?? 0;
  const bright = lumas[Math.min(lumas.length - 1, Math.floor(lumas.length * 0.98))] ?? 0;
  if (bright - dark < 64) return [];
  const half = (dark + bright) / 2;
  const times: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const before = frames[i - 1],
      frame = frames[i];
    if (before && frame && before.luma < half && frame.luma >= half) times.push(frame.t);
  }
  return times;
}

/** Each millisecond's loudest sample. */
function envelope(sound: Sound): Float32Array {
  const step = Math.max(1, Math.round(sound.rate / 1000));
  const out = new Float32Array(Math.floor(sound.samples.length / step));
  for (let w = 0; w < out.length; w++) {
    let peak = 0;
    for (let i = w * step; i < (w + 1) * step; i++) peak = Math.max(peak, Math.abs(sound.samples[i] ?? 0));
    out[w] = peak;
  }
  return out;
}

/**
 * When each beep starts (s), to the sample: the first sample at least a quarter as loud as the loudest (and never
 * below `floor`), after at least `quietS` quieter than that. None in a silent recording.
 */
export function beepTimes(sound: Sound, quietS = 0.3, floor = 0.02): number[] {
  const env = envelope(sound);
  const loudest = env.reduce((a, b) => Math.max(a, b), 0);
  const level = Math.max(floor, loudest / 4);
  if (loudest < level) return [];
  const step = Math.max(1, Math.round(sound.rate / 1000));
  const quiet = Math.round(quietS * 1000);
  const times: number[] = [];
  let lastLoud = -Infinity;
  for (let w = 0; w < env.length; w++) {
    if ((env[w] ?? 0) < level) continue;
    if (w - lastLoud > quiet) {
      let at = w * step;
      while (at < (w + 1) * step && Math.abs(sound.samples[at] ?? 0) < level) at++;
      times.push(sound.start + at / sound.rate);
    }
    lastLoud = w;
  }
  return times;
}

/** How far each flash's beep comes after it (s; + the sound later than the picture): the nearest, within `within`. */
export function beepAfterFlash(flashes: readonly number[], beeps: readonly number[], within = 0.4): number[] {
  const offsets: number[] = [];
  for (const flash of flashes) {
    let best: number | null = null;
    for (const beep of beeps)
      if (best === null || Math.abs(beep - flash) < Math.abs(best)) best = beep - flash;
    if (best !== null && Math.abs(best) <= within) offsets.push(best);
  }
  return offsets;
}

/** The middle value (the mean of the two middle ones for an even count), or null for none. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** How many of a recording's sound windows (each `windowS` long) between two times (s) hold a sample this loud. */
export function loudWindows(sound: Sound, from: number, to: number, level: number, windowS = 0.05): number {
  const size = Math.max(1, Math.round(windowS * sound.rate));
  const first = Math.max(0, Math.round((from - sound.start) * sound.rate));
  const last = Math.min(sound.samples.length, Math.round((to - sound.start) * sound.rate));
  let count = 0;
  for (let at = first; at + size <= last; at += size) {
    let peak = 0;
    for (let i = at; i < at + size; i++) peak = Math.max(peak, Math.abs(sound.samples[i] ?? 0));
    if (peak >= level) count++;
  }
  return count;
}

/** How long the recording's sound lasts (s), from its first sample. */
export const soundSeconds = (sound: Sound): number => sound.samples.length / sound.rate;
