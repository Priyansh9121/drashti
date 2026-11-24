import { describe, expect, it } from 'vitest';
import {
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

  it('says why when it cannot read: no settled seconds before the ask, or not every fade heard', () => {
    // The recording begins after the ask.
    const samples = record(4, FADE_AT - 50, scene(inClock));
    const late = heardFades(readSweeps(samples, RATE, BANDS), [fade()]);
    expect(late).toEqual({ error: expect.stringMatching(/settled/u) });
    // Two fades asked, one heard.
    const one = heardFades(readSweeps(record(10, 3217, scene(inClock)), RATE, BANDS), [fade(), fade()]);
    expect(one).toEqual({ error: expect.stringMatching(/fades/u) });
  });
});
