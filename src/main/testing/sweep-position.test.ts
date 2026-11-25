import { describe, expect, it } from 'vitest';
import {
  closedMedians,
  heardFades,
  readSweeps,
  sweepHz,
  type FadeInput,
  type Sweep,
} from '../../../tests/e2e/sweep-position';

/*
 * The cost spec's position code (tests/e2e/sweep-position.ts; QA23-FADE-9, the owner: "Read it from the recording
 * (Rec.)"): each generated video's sound carries a quiet sweep whose frequency says its media position; read back from
 * a recording, it says where each sound was heard, every 20 ms. Generated numbers only.
 */

const RATE = 48_000;
const A: Sweep = { from: 2000, perSecond: 500 };
const B: Sweep = { from: 7000, perSecond: 500 };
const BANDS = [
  { lo: 1900, hi: 6300 },
  { lo: 6900, hi: 11_300 },
];

/** One sound in a generated recording: its tone, its sweep, where it plays at each engine moment (null: silent). */
interface Voice {
  tone: number;
  sweep: Sweep;
  position: (engineMs: number) => number | null;
  gain: (engineMs: number) => number;
}

/**
 * A recording that begins at engine moment `firstSampleAt` (ms), as the generated videos sound: a tone at 0.9 and its
 * sweep at 0.1, the sweep's frequency following the position however fast it moves (the pitch is kept), plus a little
 * noise (-40 dB).
 */
function record(seconds: number, firstSampleAt: number, voices: Voice[], noise = 0.01): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (const voice of voices) {
    let tone = 0,
      sweep = 0;
    for (let i = 0; i < out.length; i++) {
      const at = firstSampleAt + (i / RATE) * 1000;
      const p = voice.position(at);
      if (p === null || p < 0) continue;
      tone += (2 * Math.PI * voice.tone) / RATE;
      sweep += (2 * Math.PI * sweepHz(voice.sweep, p)) / RATE;
      out[i] = (out[i] ?? 0) + voice.gain(at) * (0.9 * Math.sin(tone) + 0.1 * Math.sin(sweep));
    }
  }
  let seed = 7;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    out[i] = (out[i] ?? 0) + noise * (seed / 1_073_741_824 - 1);
  }
  return out;
}

/** The fade every test uses: at 10 s on the engine's clock, 2 s, asked 150 ms before it. */
const FADE_AT = 10_000;
const DURATION = 2000;
const progress = (at: number) => Math.min(1, Math.max(0, (at - FADE_AT) / DURATION));
/** The outgoing sound's clock: 6 s into its file at the fade's moment; the incoming's starts at the fade. */
const outClock = (at: number) => (at - 4000) / 1000;
const inClock = (at: number) => (at - FADE_AT) / 1000;

function scene(incoming: (at: number) => number | null, outgoing: (at: number) => number | null = outClock) {
  return [
    { tone: 440, sweep: A, position: outgoing, gain: (at: number) => 1 - progress(at) },
    {
      tone: 880,
      sweep: B,
      position: (at: number) => (at < FADE_AT ? null : incoming(at)),
      gain: (at: number) => progress(at),
    },
  ];
}

function fade(settledMs: number | null = null): FadeInput {
  return {
    askedAt: FADE_AT - 150,
    at: FADE_AT,
    durationMs: DURATION,
    settledMs,
    sounds: [
      { role: 'out', key: 'out', band: 0, sweep: A, offset: (heard, at) => (heard - outClock(at)) * 1000 },
      { role: 'in', key: 'in', band: 1, sweep: B, offset: (heard, at) => (heard - inClock(at)) * 1000 },
    ],
  };
}

/** The recording read back; begins 3.217 s on the engine's clock, which the reader must find for itself. */
function heard(voices: Voice[], input = fade(), firstSampleAt = 3217) {
  const samples = record(10, firstSampleAt, voices);
  const result = heardFades(readSweeps(samples, RATE, BANDS), [input]);
  if ('error' in result) throw new Error(result.error);
  const [only] = result.fades;
  if (!only) throw new Error('no fade');
  return only;
}

const sound = (f: ReturnType<typeof heard>, role: 'out' | 'in') => {
  const s = f.sounds.find((x) => x.role === role);
  if (!s) throw new Error(`no ${role} sound`);
  return s;
};

describe('the position sweep read back from a recording', () => {
  it('reads a sweep’s frequency and level beside the loud tone and the noise', () => {
    const samples = record(2, 0, [{ tone: 440, sweep: A, position: (at) => 3 + at / 1000, gain: () => 1 }]);
    const readings = readSweeps(samples, RATE, BANDS, { from: 0.5, to: 1.5 });
    expect(readings.length).toBeGreaterThanOrEqual(45);
    for (const r of readings) {
      const band = r.bands[0];
      expect(band?.hz, `at ${String(r.t)} s`).toBeCloseTo(sweepHz(A, 3 + r.t), 0);
      expect(band?.level).toBeGreaterThan(0.09);
      expect(band?.level).toBeLessThan(0.11);
      expect(r.bands[1]?.level ?? 1, 'nothing in the other band').toBeLessThan(0.005);
    }
  });

  it('two sounds in step: each read every 20 ms where its gain is at least 0.1, within 3 ms, the clock found', () => {
    const f = heard(scene(inClock));
    expect(f.anchor.firstSampleAt).toBeCloseTo(3217, -1);
    expect(Math.abs(f.anchor.firstSampleAt - 3217)).toBeLessThanOrEqual(3);
    for (const role of ['out', 'in'] as const) {
      const s = sound(f, role);
      expect(s.readings.length, role).toBeGreaterThanOrEqual(80);
      for (const r of s.readings) {
        expect(Math.abs(r.ms), `${role} at ${String(r.t)} ms`).toBeLessThanOrEqual(3);
        expect(r.gain).toBeGreaterThanOrEqual(0.1);
      }
    }
    // The outgoing sound from the ask until its gain falls under 0.1; the incoming from 0.1 on.
    expect(Math.min(...sound(f, 'out').readings.map((r) => r.t))).toBeLessThan(-100);
    expect(Math.max(...sound(f, 'out').readings.map((r) => r.t))).toBeLessThanOrEqual(1800);
    expect(Math.min(...sound(f, 'in').readings.map((r) => r.t))).toBeGreaterThanOrEqual(200);
  });

  it('an incoming sound that starts 0.3 s late and closes at 8%: read as it was, a reading a few ms off at most', () => {
    const late = (at: number) => Math.max(0, 0.3 - 0.08 * ((at - FADE_AT) / 1000));
    const f = heard(scene((at) => inClock(at) - late(at)));
    const s = sound(f, 'in');
    expect(s.readings.length).toBeGreaterThanOrEqual(20);
    for (const r of s.readings)
      expect(Math.abs(r.ms + late(FADE_AT + r.t) * 1000), `at ${String(r.t)} ms`).toBeLessThanOrEqual(3);
    for (const r of sound(f, 'out').readings) expect(Math.abs(r.ms)).toBeLessThanOrEqual(3);
  });

  it('a sound played a little fast with its pitch kept is read where it is', () => {
    // The outgoing sound 5% fast from the ask: 0.1 s ahead 2 s later.
    const fast = (at: number) => outClock(at) + Math.max(0, (at - (FADE_AT - 150)) / 1000) * 0.05;
    const f = heard(scene(inClock, fast));
    for (const r of sound(f, 'out').readings)
      expect(Math.abs(r.ms - (fast(FADE_AT + r.t) - outClock(FADE_AT + r.t)) * 1000)).toBeLessThanOrEqual(3);
  });

  it('a silent sound is not read: a jump from 0.2 s to 0.8 s into the fade leaves no reading there', () => {
    const f = heard(scene((at) => (at >= FADE_AT + 200 && at < FADE_AT + 800 ? null : inClock(at))));
    const s = sound(f, 'in');
    expect(s.readings.filter((r) => r.t > 230 && r.t < 770)).toEqual([]);
    expect(s.readings.filter((r) => r.t >= 800).length).toBeGreaterThanOrEqual(20);
  });

  it('anchors the recording so the outgoing sound’s settled seconds match the page’s own reading of them', () => {
    // The page's sampler read the outgoing sound 12 ms ahead before the ask: the heard sounds are read 12 ms ahead too.
    const f = heard(scene(inClock), fade(12));
    for (const role of ['out', 'in'] as const)
      for (const r of sound(f, role).readings) expect(Math.abs(r.ms - 12), role).toBeLessThanOrEqual(3);
    expect(f.anchor.settledReadings).toBeGreaterThanOrEqual(30);
  });

  it('counts a crossfade only where both sounds are heard window after window, never a few clicks (QFP-6)', () => {
    // CI's Windows (a22-fadeprep-1125-105151-7516): a sound's start or stop is a click that lifts both bands over their
    // floor for 1-4 windows; three such clicks within 3 s were taken for a crossfade (8 counted for 3 fades).
    const samples = record(10, 3217, scene(inClock));
    let seed = 11;
    for (const at of [4500, 5100, 5700]) {
      const first = Math.round(((at - 3217) / 1000) * RATE);
      for (let i = first; i < first + 480; i++) {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        samples[i] = (samples[i] ?? 0) + 0.8 * (seed / 1_073_741_824 - 1);
      }
    }
    const result = heardFades(readSweeps(samples, RATE, BANDS), [fade()]);
    expect('error' in result ? result.error : '').toBe('');
    const [only] = 'fades' in result ? result.fades : [];
    expect(Math.abs((only?.anchor.firstSampleAt ?? 0) - 3217)).toBeLessThanOrEqual(3);
  });

  it('says why when it cannot read: no settled seconds before the ask, or not every fade heard', () => {
    // The recording begins after the ask.
    const samples = record(4, FADE_AT - 50, scene(inClock));
    const late = heardFades(readSweeps(samples, RATE, BANDS), [fade()]);
    expect('error' in late ? late.error : '').toMatch(/settled/u);
    // Two fades asked, one heard.
    const one = heardFades(readSweeps(record(10, 3217, scene(inClock)), RATE, BANDS), [fade(), fade()]);
    expect('error' in one ? one.error : '').toMatch(/fades/u);
  });
});

describe('the 50 ms bound judged on the median of each 5 readings (the owner’s QFP-6 item 2, "Median of 5")', () => {
  /** Readings every 20 ms from `from` ms, each `ms` off unless set. */
  const every20 = (from: number, count: number, ms: number, set: Record<number, number> = {}) =>
    Array.from({ length: count }, (_, i) => ({ t: from + i * 20, ms: set[i] ?? ms }));
  const over = (readings: { t: number; ms: number }[]) =>
    closedMedians(readings, 1500).filter((r) => Math.abs(r.ms) > 50);

  it('single readings that jump past 50 ms and back (the time-stretch’s splices) are not a sound out of step', () => {
    // +61 and -55, each alone among readings 10 ms off: the raw rule failed these.
    const readings = every20(1500, 25, 10, { 3: 61, 11: -55, 12: 51 });
    expect(readings.filter((r) => Math.abs(r.ms) > 50).length, 'the raw rule').toBe(3);
    expect(over(readings), 'the median of each 5').toEqual([]);
  });

  it('a sound out of step for 100 ms or more still fails, as does one at the end’s last few readings', () => {
    // Five in a row 60 ms off: their median is 60.
    expect(over(every20(1500, 25, 10, { 5: 60, 6: 62, 7: 58, 8: 61, 9: 60 }))).toEqual([{ t: 1640, ms: 60 }]);
    // The whole late part 55 ms off.
    expect(over(every20(1500, 25, 55)).length).toBe(5);
    // The last 3 (a part group) 70 ms off.
    expect(over(every20(1500, 23, 10, { 20: 70, 21: 70, 22: 70 }))).toEqual([{ t: 1920, ms: 70 }]);
  });

  it('only readings from 1.5 s into the fade are judged, in groups from the first of them; the bound is still 50 ms', () => {
    // Out of step before 1.5 s: not this bound's.
    expect(over([...every20(1000, 25, 80), ...every20(1500, 10, 10)])).toEqual([]);
    // 50 is within; 51 for a whole group is not.
    expect(over(every20(1500, 5, 50))).toEqual([]);
    expect(over(every20(1500, 5, 51))).toEqual([{ t: 1540, ms: 51 }]);
  });
});
