import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptionReview } from '../../shared/caption-coordinator';
import { DEFAULT_CAPTION_SETTINGS, type CaptionsShown } from '../../shared/captions';
import type { Heard } from '../../shared/speech';
import { CaptionCoordinator } from './caption-coordinator';
import { createCaptionFlow } from './caption-flow';
import { createSpeechHub } from './hub';
import { createIndicEngine } from './indic-engine';

/*
 * Route C's words while a phrase is still being spoken (cap-partials, alpha.23): the engine as index.ts wires it
 * (below the show, two threads, the dialog's standard timing) -> the real speech hub -> caption AI's flow -> x90's
 * coordinator -> the lines the screens draw, on a controlled clock. A stand-in helper plays IndicConformer as
 * cap-partials' probes of the committed synthetic clips found it: sound cut off mid-speech, with no quiet after it,
 * is heard only as unsure one-syllable sounds (which the noise filter hides); with quiet after it, the words spoken so
 * far, but the word still being spoken at the cut is misheard. Placeholder words only (coloured boxes and shapes);
 * no sound, no model, no download.
 */

const RATE = 16_000;
/** Eight placeholder words, 0.45 s each, in four seconds of speech (so a cut can fall inside a word). */
const WORDS = ['લાલ', 'ખોખું', 'ગોળ', 'આકાર', 'પાસે', 'વાદળી', 'દરવાજો', 'છે'];
const WORD_S = 0.45;
/** A word the final never has: what the stand-in makes of a word cut off mid-way. */
const MISHEARD = 'ખોટું';
/** The stand-in helper's time for one decode (cap-ship-c: a 2.4-3.7 s clip in 219-258 ms, two threads, warm). */
const DECODE_MS = 200;
/** Loud sound is speech; the room's quiet between phrases is a faint hiss (below the speech gate); a pause is silence. */
const LOUD = 5_000;
const HISS = 7;

interface Reply {
  language: 'gu';
  words: { w: string; start: number; end: number; c: number | null }[];
}

/** The speech in what the helper was given: its seconds, and the seconds of quiet after it. */
function speechIn(samples: Int16Array): { speechS: number; quietAfterS: number } {
  const last = samples.findLastIndex((x) => x === LOUD);
  return { speechS: (last + 1) / RATE, quietAfterS: (samples.length - last - 1) / RATE };
}

/** IndicConformer as the probes heard it (above). */
function speechReply(samples: Int16Array): Reply {
  const { speechS, quietAfterS } = speechIn(samples);
  if (quietAfterS < 0.3)
    return {
      language: 'gu',
      words: [
        { w: 'તે', start: 0.1, end: 0.2, c: 0.3 },
        { w: 'છે', start: 0.3, end: 0.4, c: 0.2 },
      ],
    };
  const words = WORDS.flatMap((w, i) => {
    const start = i * WORD_S;
    const end = (i + 1) * WORD_S;
    if (end <= speechS) return [{ w, start, end, c: 0.9 }];
    // The word still being spoken at the cut, misheard (it ends where the sound so far ends).
    if (start < speechS) return [{ w: MISHEARD, start, end: speechS, c: 0.6 }];
    return [];
  });
  return { language: 'gu', words };
}

/** Hum: whatever the stand-in hears is one-syllable and unsure, however long it lasts (cap-integration's filter). */
function humReply(samples: Int16Array): Reply {
  const seconds = samples.length / RATE;
  return {
    language: 'gu',
    words: [
      { w: 'હ', start: 0, end: Math.min(0.2, seconds), c: 0.2 },
      { w: 'છે', start: Math.min(0.2, seconds), end: Math.min(0.4, seconds), c: 0.35 },
    ],
  };
}

function setup(reply: (samples: Int16Array) => Reply) {
  let chunk: ((samples: Int16Array, endAt: number, startAt?: number) => void) | undefined;
  /** What the helper was given, each time. */
  const decoded: Int16Array[] = [];
  const engine = createIndicEngine({
    admission: 'below-show',
    threads: 2,
    timing: () => ({ stepMs: 1_500, pauseMs: 700, longestMs: 12_000, speech: 'standard', threads: 4 }),
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
          return new Promise<Reply>((resolve) => setTimeout(() => resolve(reply(samples)), DECODE_MS));
        },
        close: () => undefined,
      }),
  });
  const hub = createSpeechHub({ engine, log: { info: () => undefined, warn: () => undefined }, lingerMs: 0 });
  const shown: { at: number; captions: CaptionsShown | null }[] = [];
  const reviews: CaptionReview[] = [];
  const coordinator = new CaptionCoordinator({
    clock: () => Date.now(),
    settings: () => DEFAULT_CAPTION_SETTINGS,
    show: (captions) => shown.push({ at: Date.now(), captions }),
    changed: (r) => reviews.push(r),
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
  return { hub, coordinator, heard, shown, reviews, lines, decoded, play, ready: () => chunk !== undefined };
}

describe('Route C shows the words of a phrase while it is still being spoken (cap-partials)', () => {
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
    vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** One four-second phrase as a speaker says it, then its pause and quiet: when it began and when its speech ended. */
  const speak = async (t: ReturnType<typeof setup>): Promise<{ onset: number; speechEnd: number }> => {
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ready()).toBe(true);
    await t.play(0, 10, HISS); // a second of the room's quiet: the speech gate learns the room
    const onset = Date.now();
    await t.play(40, 0); // four seconds of speech
    const speechEnd = Date.now();
    await t.play(0, 25); // then the pause, and quiet
    return { onset, speechEnd };
  };

  it('a four-second phrase: its first words reach the screens within 3 s of its onset, unsettled, while it is still being spoken', async () => {
    const t = setup(speechReply);
    const { onset, speechEnd } = await speak(t);
    const first = t.lines()[0];
    expect(first, 'nothing reached the screens').toBeDefined();
    // The owner's live limit (about 3 s), and while the speaker is still talking.
    expect((first?.at ?? Infinity) - onset).toBeLessThanOrEqual(3_000);
    expect(first?.at ?? Infinity).toBeLessThan(speechEnd);
    // Unsettled while heard: the coordinator held those words as provisional.
    const provisional = t.reviews.find((r) => r.current?.status === 'provisional');
    expect(provisional?.current?.sourceText).toBe(first?.captions?.lines.join(' '));
    // Nothing the noise filter hides was ever on the screens.
    for (const s of t.lines()) expect(s.captions?.lines.join(' ')).not.toBe('તે છે');
  });

  it('the settled phrase then replaces them: every word of the whole phrase, exactly as the helper heard it whole', async () => {
    const t = setup(speechReply);
    await speak(t);
    const finals = t.heard.filter((h) => h.final);
    expect(finals.map((h) => h.text)).toEqual([WORDS.join(' ')]);
    expect(t.coordinator.view().current).toMatchObject({ status: 'settled', sourceText: WORDS.join(' ') });
    expect(t.lines().at(-1)?.captions?.lines.join(' ')).toBe(WORDS.join(' '));
  });

  it('a final is never padded: the helper gets exactly the phrase as heard, its speech then its own pause, as before', async () => {
    const t = setup(speechReply);
    await speak(t);
    const final = t.decoded.at(-1) ?? new Int16Array(0);
    // From the onset to the end of its pause: 40 chunks of speech, then 7 of silence; none of the room's hiss.
    expect(final.length).toBe(47 * 1_600);
    expect(final.subarray(0, 40 * 1_600).every((x) => x === LOUD)).toBe(true);
    expect(final.subarray(40 * 1_600).every((x) => x === 0)).toBe(true);
  });

  it('a partial is worked out with the room’s quiet after it, and shows no word the final does not confirm: the screens never flash a wrong word', async () => {
    const t = setup(speechReply);
    await speak(t);
    const partials = t.decoded.slice(0, -1);
    expect(partials.length).toBeGreaterThan(0);
    for (const p of partials) {
      // Its sound so far, then half a second of the hiss the room had between phrases.
      const { quietAfterS } = speechIn(p);
      expect(quietAfterS).toBeCloseTo(0.5, 5);
      expect(p.subarray(p.length - 8_000).every((x) => x === HISS)).toBe(true);
    }
    // Everything the screens showed is, word for word, how the final begins.
    const final = WORDS;
    const shownLines = t.lines().map((s) => s.captions?.lines.join(' ') ?? '');
    expect(shownLines.length).toBeGreaterThan(1);
    for (const line of shownLines) {
      const words = line.split(' ');
      expect(words).toEqual(final.slice(0, words.length));
    }
    expect(shownLines.join(' ')).not.toContain(MISHEARD);
  });

  it('the final is no later: after its pause (700 ms) and one decode, never behind a partial decoding the pause', async () => {
    const t = setup(speechReply);
    const { speechEnd } = await speak(t);
    const final = t.heard.find((h) => h.final);
    expect((final?.heardAt ?? Infinity) - speechEnd).toBeLessThanOrEqual(700 + DECODE_MS);
  });

  it('hum the noise filter hides never reaches the screens, however often the growing phrase is worked out', async () => {
    const t = setup(humReply);
    await vi.advanceTimersByTimeAsync(0);
    await t.play(0, 10, HISS);
    await t.play(30, 25); // three seconds of hum, then quiet
    expect(t.decoded.length).toBeGreaterThan(0);
    expect(t.lines()).toEqual([]);
    expect(t.heard.filter((h) => h.words.length > 0)).toEqual([]);
  });
});
