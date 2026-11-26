import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptionReview } from '../../shared/caption-coordinator';
import { DEFAULT_CAPTION_SETTINGS, type CaptionsShown } from '../../shared/captions';
import type { Heard } from '../../shared/speech';
import { CaptionCoordinator } from './caption-coordinator';
import { createCaptionFlow } from './caption-flow';
import { createSpeechHub } from './hub';
import { createIndicEngine } from './indic-engine';

/*
 * The early final (QA24-CAPFAST-1; the owner: "Yes, show at once"): Route C decodes a phrase once it has 300 ms of
 * quiet; its words go on the screens as soon as that decode answers, and if the speaker is still quiet when the pause
 * ends (700 ms), that decode is the phrase's final, with no decode after it. The engine as index.ts wires it (below
 * the show, two threads, the dialog's standard timing) -> the real speech hub -> caption AI's flow -> the captions
 * coordinator, on a controlled clock, with a stand-in helper (cap-partials' model of IndicConformer: sound cut off
 * mid-speech is heard as unsure one-syllable sounds; with quiet after it, the words spoken so far). Placeholder words
 * only; no sound, no model, no download.
 */

const RATE = 16_000;
const WORDS = ['લાલ', 'ખોખું', 'ગોળ', 'આકાર', 'પાસે', 'વાદળી', 'દરવાજો', 'છે'];
const WORD_S = 0.45;
/** A word the stand-in hears in the quiet after the speech: never a word anyone said. */
const IN_THE_QUIET = 'ખાલી';
const DECODE_MS = 200;
const LOUD = 5_000;
const HISS = 7;

interface Reply {
  language: 'gu';
  words: { w: string; start: number; end: number; c: number | null }[];
}

/** Each loud stretch's words, at their times from the start of the sound given (a gap of quiet shifts them on). */
function speechReply(samples: Int16Array): Reply {
  const last = samples.findLastIndex((x) => x === LOUD);
  const speechS = (last + 1) / RATE;
  const quietAfterS = (samples.length - last - 1) / RATE;
  if (quietAfterS < 0.3)
    return {
      language: 'gu',
      words: [
        { w: 'તે', start: 0.1, end: 0.2, c: 0.3 },
        { w: 'છે', start: 0.3, end: 0.4, c: 0.2 },
      ],
    };
  // Speech time only (the quiet between stretches does not count): the n-th word is said in the n-th 0.45 s of speech.
  const loudAt: number[] = [];
  for (let i = 0; i < samples.length; i += 1600) if (samples[i] === LOUD) loudAt.push(i / RATE);
  const words: Reply['words'] = [];
  WORDS.forEach((w, i) => {
    const from = Math.floor((i * WORD_S) / 0.1);
    const to = Math.ceil(((i + 1) * WORD_S) / 0.1) - 1;
    const start = loudAt[from];
    const end = loudAt[to];
    if (start !== undefined && end !== undefined && end + 0.1 <= speechS + 1e-9)
      words.push({ w, start, end: end + 0.1, c: 0.9 });
  });
  return { language: 'gu', words };
}

/** As above, and a confident word heard in the quiet after the speech (it must never be kept). */
function quietWordReply(samples: Int16Array): Reply {
  const said = speechReply(samples);
  const last = samples.findLastIndex((x) => x === LOUD);
  const speechS = (last + 1) / RATE;
  const quietAfterS = (samples.length - last - 1) / RATE;
  if (quietAfterS < 0.25) return said;
  return {
    language: 'gu',
    words: [...said.words, { w: IN_THE_QUIET, start: speechS + 0.1, end: speechS + 0.25, c: 0.95 }],
  };
}

function setup(reply: (samples: Int16Array) => Reply, decodeMs = DECODE_MS, longestMs = 12_000) {
  let chunk: ((samples: Int16Array, endAt: number, startAt?: number) => void) | undefined;
  const decoded: Int16Array[] = [];
  const began: number[] = [];
  const engine = createIndicEngine({
    admission: 'below-show',
    threads: 2,
    timing: () => ({
      stepMs: 1_500,
      pauseMs: 700,
      longestMs: longestMs as 12_000,
      speech: 'standard',
      threads: 4,
    }),
    program: () => '/native',
    acquire: () => ({
      files: { model: '/pack/model.onnx', tokens: '/pack/tokens.txt', frontend: '/pack/frontend.bin' },
      release: () => undefined,
    }),
    sound: {
      open: (to) => {
        chunk = to;
        return () => {
          chunk = undefined;
        };
      },
    },
    log: { info: () => undefined, warn: () => undefined },
    open: () =>
      Promise.resolve({
        decode: (samples: Int16Array) => {
          decoded.push(samples.slice());
          began.push(Date.now());
          return new Promise<Reply>((resolve) => setTimeout(() => resolve(reply(samples)), decodeMs));
        },
        close: () => undefined,
      }),
  });
  const hub = createSpeechHub({ engine, log: { info: () => undefined, warn: () => undefined }, lingerMs: 0 });
  const shown: { at: number; captions: CaptionsShown | null }[] = [];
  const reviews: { at: number; review: CaptionReview }[] = [];
  const coordinator = new CaptionCoordinator({
    clock: () => Date.now(),
    settings: () => DEFAULT_CAPTION_SETTINGS,
    show: (captions) => shown.push({ at: Date.now(), captions }),
    changed: (review) => reviews.push({ at: Date.now(), review }),
  });
  const heard: Heard[] = [];
  const flow = createCaptionFlow({ hub, coordinator });
  hub.listen('test', (h) => heard.push(h));
  hub.setLanguage('gu');
  hub.setOn(true);
  flow.start();
  /** The stream's sound, 100 ms at a time on the clock: `speech` loud chunks, then `quiet` ones (`fill`: silence). */
  const play = async (speech: number, quiet: number, fill = 0): Promise<void> => {
    for (let i = 0; i < speech + quiet; i += 1) {
      await vi.advanceTimersByTimeAsync(100);
      const now = Date.now();
      chunk?.(new Int16Array(1_600).fill(i < speech ? LOUD : fill), now, now - 100);
    }
  };
  const lines = () => shown.filter((s) => s.captions !== null);
  return { hub, heard, shown, reviews, lines, decoded, began, play, ready: () => chunk !== undefined };
}

describe('the early final: a phrase settled from one decode at 300 ms of quiet (QA24-CAPFAST-1)', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'Date',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
      ],
    });
    vi.setSystemTime(new Date('2026-11-26T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A second of the room's quiet, then `speech` chunks, then `quiet` chunks of silence: when the speech ended. */
  const speak = async (t: ReturnType<typeof setup>, speech = 40, quiet = 25): Promise<number> => {
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ready()).toBe(true);
    await t.play(0, 10, HISS);
    await t.play(speech, 0);
    const speechEnd = Date.now();
    await t.play(0, quiet);
    return speechEnd;
  };

  it('a speaker who stays quiet: the phrase is settled when its pause ends, from the one decode begun at 300 ms of quiet, with no decode after it', async () => {
    const t = setup(speechReply);
    const speechEnd = await speak(t);
    const finals = t.heard.filter((h) => h.final);
    expect(finals.map((h) => h.text)).toEqual([WORDS.join(' ')]);
    // Settled at the pause (700 ms, in 100 ms chunks), not a decode after it.
    expect((finals[0]?.heardAt ?? Infinity) - speechEnd).toBeLessThanOrEqual(700);
    // The last decode: the phrase as heard up to its third chunk of quiet (300 ms), begun then; none after it.
    const last = t.decoded.at(-1) ?? new Int16Array(0);
    expect(last.length).toBe(43 * 1_600);
    expect((t.began.at(-1) ?? 0) - speechEnd).toBe(300);
    expect(t.began.every((at) => at <= speechEnd + 300)).toBe(true);
  });

  it('its words are on the screens as soon as that decode answers (300 ms of quiet and one decode), unsettled until the pause ends, then settled without a change', async () => {
    const t = setup(speechReply);
    const speechEnd = await speak(t);
    const whole = WORDS.join(' ');
    const first = t.lines().find((s) => s.captions?.lines.join(' ') === whole);
    expect(first, 'the whole phrase never reached the screens').toBeDefined();
    expect((first?.at ?? Infinity) - speechEnd).toBeLessThanOrEqual(300 + DECODE_MS);
    // Provisional while the pause goes on, settled at its end, and the lines never changed in between.
    const provisional = t.reviews.find((r) => r.review.current?.sourceText === whole);
    expect(provisional?.review.current?.status).toBe('provisional');
    const settled = t.reviews.find((r) => r.review.current?.status === 'settled');
    expect(settled?.review.current?.sourceText).toBe(whole);
    expect((settled?.at ?? Infinity) - speechEnd).toBeLessThanOrEqual(700);
    const after = t.lines().filter((s) => s.at >= (first?.at ?? 0));
    for (const s of after) expect(s.captions?.lines.join(' ')).toBe(whole);
  });

  it('a speaker who goes on after a short pause (400 ms): that early decode is not the final; the phrase goes on and is settled whole at its real pause', async () => {
    const t = setup(speechReply);
    await vi.advanceTimersByTimeAsync(0);
    await t.play(0, 10, HISS);
    await t.play(20, 4); // two seconds of speech, 400 ms of quiet
    await t.play(20, 0); // two seconds more of the same phrase
    const speechEnd = Date.now();
    await t.play(0, 25);
    const finals = t.heard.filter((h) => h.final);
    expect(finals).toHaveLength(1);
    expect(finals[0]?.text).toBe(WORDS.join(' '));
    expect(finals[0]?.id).toBe('s1');
    // Settled from the decode at the second quiet's 300 ms, and at its pause.
    expect((finals[0]?.heardAt ?? Infinity) - speechEnd).toBeLessThanOrEqual(700);
    expect(t.decoded.at(-1)?.length).toBe((20 + 4 + 20 + 3) * 1_600);
  });

  it('a phrase that reaches the longest phrase without a pause is decoded whole at the limit, as before', async () => {
    const t = setup(speechReply, DECODE_MS, 6_000);
    await vi.advanceTimersByTimeAsync(0);
    await t.play(0, 10, HISS);
    await t.play(65, 25); // 6.5 s of speech: cut at 6 s
    const first = t.heard.find((h) => h.final);
    expect(first).toBeDefined();
    // Its final decode is the whole first 6 s, as heard: no early decode stands in for it.
    const cutAt = t.decoded.find((d) => d.length === 60 * 1_600);
    expect(cutAt, 'the 6 s phrase was not decoded whole').toBeDefined();
  });

  it('a slow computer: the early decode still answering when the pause ends settles the phrase when it answers, never later than a decode after the pause', async () => {
    const slow = 1_000;
    const t = setup(speechReply, slow);
    const speechEnd = await speak(t, 40, 30);
    const finals = t.heard.filter((h) => h.final);
    expect(finals.map((h) => h.text)).toEqual([WORDS.join(' ')]);
    // Begun at 300 ms of quiet (or when a partial still decoding finished), answered a second later: no second decode.
    expect((finals[0]?.heardAt ?? Infinity) - speechEnd).toBeLessThan(700 + slow);
    const lastBegan = t.began.at(-1) ?? 0;
    expect(lastBegan - speechEnd).toBeLessThan(700);
  });

  it('a word heard in the quiet after the speech (begun after its last chunk of speech) is never kept, on the screens or in the final', async () => {
    const t = setup(quietWordReply);
    await speak(t);
    const finals = t.heard.filter((h) => h.final);
    expect(finals.map((h) => h.text)).toEqual([WORDS.join(' ')]);
    for (const s of t.lines()) expect(s.captions?.lines.join(' ')).not.toContain(IN_THE_QUIET);
  });
});
