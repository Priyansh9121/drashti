/*
 * The cost spec's position code (QA23-FADE-9, the owner: "Read it from the recording (Rec.)"). Each generated video's
 * sound carries a quiet sweep beside its tone: a sine whose frequency rises steadily with the media position, so the
 * frequency heard at any moment says which moment of the file is playing then (the pitch is kept whatever the stream's
 * speed correction does). Read back from the stream's recording after the run, it gives each sound's heard position
 * every 20 ms, with no page thread in the way (CI's two-core Windows starved the sound page's 50 ms sampler for
 * 0.77-0.81 s at a fade's start: a22-fadeprep-1125-084705-80663).
 *
 * Pure functions on numbers (unit tests: src/main/testing/sweep-position.test.ts); the spec passes the clocks.
 */

/** A position sweep: its frequency at the file's 0 s, and how much it rises each second of the file (Hz). */
export interface Sweep {
  from: number;
  perSecond: number;
}

/** The frequency a sweep has at a media position (s). */
export function sweepHz(sweep: Sweep, position: number): number {
  return sweep.from + sweep.perSecond * position;
}

/** The media position (s) a sweep's frequency says. */
export function sweepPosition(sweep: Sweep, hz: number): number {
  return (hz - sweep.from) / sweep.perSecond;
}

/** Where to look for each sweep (Hz): its whole band, a little wider. */
export interface Band {
  lo: number;
  hi: number;
}

/** One window of a recording: its middle (s from the first sample), and each band's loudest frequency and level. */
export interface Reading {
  t: number;
  bands: { hz: number; level: number }[];
}

/**
 * Each band's loudest frequency, every `hop` seconds of the samples (mono), between `from` and `to` (s). The level is
 * that sine's amplitude (1 for a full-scale sine).
 */
export function readSweeps(
  samples: Float32Array,
  rate: number,
  bands: readonly Band[],
  options: { hop?: number; from?: number; to?: number } = {},
): Reading[] {
  const half = SIZE / 2;
  const first = Math.max(half, Math.round((options.from ?? 0) * rate));
  const last = Math.min(samples.length - half, Math.round((options.to ?? samples.length / rate) * rate));
  const step = Math.max(1, Math.round((options.hop ?? 0.02) * rate));
  const w = hann();
  const sumW = w.reduce((a, b) => a + b, 0);
  const x = new Float64Array(SIZE),
    re = new Float64Array(SIZE),
    im = new Float64Array(SIZE);
  const df = rate / SIZE;
  const out: Reading[] = [];
  for (let c = first; c <= last; c += step) {
    for (let n = 0; n < SIZE; n++) {
      const v = (samples[c - half + n] ?? 0) * (w[n] ?? 0);
      x[n] = v;
      re[n] = v;
      im[n] = 0;
    }
    fft(re, im);
    const read = bands.map(({ lo, hi }) => {
      const k0 = Math.max(1, Math.ceil(lo / df)),
        k1 = Math.min(half - 1, Math.floor(hi / df));
      let best = k0,
        most = -1;
      for (let k = k0; k <= k1; k++) {
        const p = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
        if (p > most) {
          most = p;
          best = k;
        }
      }
      // Between the spectrum's lines: a parabola through the log levels either side, closer each time.
      let hz = best * df,
        d = df;
      for (let i = 0; i < 5; i++) {
        const a = Math.log(power(x, hz - d, rate) + 1e-30),
          b = Math.log(power(x, hz, rate) + 1e-30),
          g = Math.log(power(x, hz + d, rate) + 1e-30);
        const curve = a - 2 * b + g;
        if (curve < 0) hz += Math.max(-d, Math.min(d, ((0.5 * (a - g)) / curve) * d));
        d /= 3;
      }
      hz = Math.min(hi, Math.max(lo, hz));
      return { hz, level: (2 * Math.sqrt(power(x, hz, rate))) / sumW };
    });
    out.push({ t: c / rate, bands: read });
  }
  return out;
}

/** The window each reading is taken over: 2048 samples (43 ms at 48 kHz), Hann. */
const SIZE = 2048;
let shape: Float64Array | null = null;
function hann(): Float64Array {
  if (shape) return shape;
  shape = new Float64Array(SIZE);
  for (let n = 0; n < SIZE; n++) shape[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / SIZE);
  return shape;
}

/** The squared level of one frequency in a window (Goertzel's, at any frequency). */
function power(x: Float64Array, hz: number, rate: number): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * hz) / rate);
  let one = 0,
    two = 0;
  for (const v of x) {
    const next = v + coefficient * one - two;
    two = one;
    one = next;
  }
  return Math.max(0, one * one + two * two - coefficient * one * two);
}

/** An in-place radix-2 FFT (the window's size is a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
      [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k,
          b = a + len / 2;
        const br = (re[b] ?? 0) * cr - (im[b] ?? 0) * ci,
          bi = (re[b] ?? 0) * ci + (im[b] ?? 0) * cr;
        re[b] = (re[a] ?? 0) - br;
        im[b] = (im[a] ?? 0) - bi;
        re[a] = (re[a] ?? 0) + br;
        im[a] = (im[a] ?? 0) + bi;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/** One of a fade's two sounds, as the spec knows it. */
export interface FadeSound {
  role: 'out' | 'in';
  key: string;
  /** Which of the recording's bands carries its sweep, and the sweep. */
  band: number;
  sweep: Sweep;
  /** How far a heard position (s) is from where its clock says it should be at an engine moment (ms; + ahead). */
  offset: (heard: number, engineMs: number) => number;
}

export interface FadeInput {
  askedAt: number;
  at: number;
  durationMs: number;
  sounds: FadeSound[];
  /**
   * The outgoing sound's own median offset in its settled seconds, as the page's sampler read it (ms), or null when
   * it read none: the recording's clock is anchored so the heard sound matches it there.
   */
  settledMs: number | null;
}

export interface HeardSound {
  role: 'out' | 'in';
  key: string;
  /** Each reading from the ask to the fade's end where its gain is at least the floor's: ms into the fade, offset. */
  readings: { t: number; ms: number; gain: number }[];
}

export interface HeardFade {
  at: number;
  durationMs: number;
  /** The engine moment of the recording's first sample (ms), and how it was found. */
  anchor: { firstSampleAt: number; coarse: number; settledReadings: number; settledMedianMs: number };
  sounds: HeardSound[];
}

export interface HeardOptions {
  /** A band is read only at this share of its full level or more. */
  readable?: number;
  /** A sound counts only where its crossfade gain is at least this (the owner: 0.1). */
  minGain?: number;
  /** The outgoing sound's settled seconds: this long before the ask, until this long before it (ms). */
  settledFromMs?: number;
  settledToMs?: number;
}

/** A window is read only at this share of the level its sound's gain gives, or more: none of it silent to speak of. */
const FULL_SHARE = 0.7;
/** Two windows are next to each other within this (s): a 20 ms hop, and room for one window missed. */
const NEXT_S = 0.05;
/** Both sounds heard at least this many windows in a row (0.2 s) for a crossfade's stretch. */
const RUN_WINDOWS = 10;
/** Runs this close (s) are one crossfade's: a sound silent for a moment in its fade splits it in two. */
const JOIN_S = 1.5;

/** Each fade's two sounds where they were heard, against their clocks; or why the recording can't say. */
export function heardFades(
  readings: readonly Reading[],
  fades: readonly FadeInput[],
  options: HeardOptions = {},
): { fades: HeardFade[] } | { error: string } {
  const readable = options.readable ?? 0.05,
    minGain = options.minGain ?? 0.1,
    settledFromMs = options.settledFromMs ?? 1000,
    settledToMs = options.settledToMs ?? 100;
  const bandCount = Math.max(0, ...readings.map((r) => r.bands.length));
  // Each band's full level: what it reads when its sound plays at full gain (most of the recording).
  const full = Array.from({ length: bandCount }, (_, b) =>
    quantile(
      readings.map((r) => r.bands[b]?.level ?? 0),
      0.99,
    ),
  );
  // Heard: loud enough to read, and, with a gain, at least 0.7 of what that gain makes it (so a window that is
  // partly silent, at a sound’s start or a jump’s edge, is not read as half of each).
  const heardIn = (r: Reading, band: number, gain?: number) => {
    const level = r.bands[band]?.level ?? 0;
    const whole = full[band] ?? 0;
    return (
      whole > 0 && level >= readable * whole && (gain === undefined || level >= FULL_SHARE * gain * whole)
    );
  };
  // Where each pair of sounds was heard together: one stretch for each crossfade, in order.
  const pairOf = (f: FadeInput) =>
    f.sounds
      .map((s) => s.band)
      .sort((a, b) => a - b)
      .join('+');
  // Runs of windows next to each other (a click lifts both bands for 1-4 windows, CI's Windows: never a crossfade),
  // at least RUN_WINDOWS long; then runs less than JOIN_S apart (a sound silent for a moment in its fade) as one.
  const stretches = new Map<string, { from: number; to: number }[]>();
  for (const pair of new Set(fades.map(pairOf))) {
    const bands = pair.split('+').map(Number);
    const runs: { from: number; to: number; windows: number }[] = [];
    let previous: number | null = null;
    for (const r of readings) {
      if (!bands.every((b) => heardIn(r, b))) continue;
      const run = runs.at(-1);
      if (run && previous !== null && r.t - previous <= NEXT_S) {
        run.to = r.t;
        run.windows++;
      } else runs.push({ from: r.t, to: r.t, windows: 1 });
      previous = r.t;
    }
    const found: { from: number; to: number }[] = [];
    for (const run of runs.filter((x) => x.windows >= RUN_WINDOWS)) {
      const lastOne = found.at(-1);
      if (lastOne && run.from - lastOne.to < JOIN_S) lastOne.to = run.to;
      else found.push({ from: run.from, to: run.to });
    }
    stretches.set(pair, found);
  }
  const used = new Map<string, number>();
  const out: HeardFade[] = [];
  for (const f of fades) {
    const pair = pairOf(f);
    const all = stretches.get(pair) ?? [];
    const asked = fades.filter((x) => pairOf(x) === pair).length;
    if (all.length !== asked)
      return {
        error: `the recording shows ${String(all.length)} crossfades of sounds ${pair}, for ${String(asked)} fades asked`,
      };
    const index = used.get(pair) ?? 0;
    used.set(pair, index + 1);
    const stretch = all[index];
    const outgoing = f.sounds.find((s) => s.role === 'out');
    if (!stretch || !outgoing) return { error: 'a fade without its outgoing sound' };
    // Roughly: the stretch heard together is the fade's middle. Then exactly, by the outgoing sound's settled seconds.
    const coarse = f.at + f.durationMs / 2 - ((stretch.from + stretch.to) / 2) * 1000;
    let firstSampleAt = coarse,
      settled: number[] = [];
    for (let round = 0; round < 2; round++) {
      const anchor = firstSampleAt;
      settled = readings
        .filter((r) => {
          const at = anchor + r.t * 1000;
          return (
            at >= f.askedAt - settledFromMs && at <= f.askedAt - settledToMs && heardIn(r, outgoing.band, 1)
          );
        })
        .map((r) =>
          outgoing.offset(
            sweepPosition(outgoing.sweep, r.bands[outgoing.band]?.hz ?? 0),
            anchor + r.t * 1000,
          ),
        );
      if (settled.length < 10)
        return {
          error: `the outgoing sound’s settled seconds before the ask are not in the recording (${String(settled.length)} readings)`,
        };
      firstSampleAt = anchor + (quantile(settled, 0.5) - (f.settledMs ?? 0));
    }
    const anchor = firstSampleAt;
    const progress = (at: number) => Math.min(1, Math.max(0, (at - f.at) / f.durationMs));
    out.push({
      at: f.at,
      durationMs: f.durationMs,
      anchor: {
        firstSampleAt: anchor,
        coarse,
        settledReadings: settled.length,
        settledMedianMs: quantile(
          settled.map((ms) => ms - (anchor - coarse)),
          0.5,
        ),
      },
      sounds: f.sounds.map((s) => ({
        role: s.role,
        key: s.key,
        readings: readings.flatMap((r) => {
          const at = anchor + r.t * 1000;
          if (at < f.askedAt || at >= f.at + f.durationMs) return [];
          const gain = s.role === 'out' ? 1 - progress(at) : progress(at);
          if (gain < minGain || !heardIn(r, s.band, gain)) return [];
          return [{ t: at - f.at, ms: s.offset(sweepPosition(s.sweep, r.bands[s.band]?.hz ?? 0), at), gain }];
        }),
      })),
    });
  }
  return { fades: out };
}

/** A share of the way through the values, sorted (0.5: the median). */
function quantile(values: readonly number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
}
