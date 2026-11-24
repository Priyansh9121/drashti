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
 * cap-winci's bench saw it on the committed synthetic clips: in a phrase's first second and a half it hears only
 * unsure one-syllable sounds (which the noise filter hides), then the words spoken so far. Placeholder words only
 * (coloured boxes and shapes); no sound, no model, no download.
 */

const RATE = 16_000;
/** Eight placeholder words, half a second each: four seconds of speech. */
const WORDS = ['લાલ', 'ખોખું', 'ગોળ', 'આકાર', 'પાસે', 'વાદળી', 'દરવાજો', 'છે'];
const WORD_S = 0.5;
/** The stand-in helper's time for one decode (cap-ship-c: a 2.4-3.7 s clip in 219-258 ms, two threads, warm). */
const DECODE_MS = 200;
/** Before this much of a phrase, the stand-in hears only what the noise filter hides (cap-winci's bench). */
const CONTEXT_S = 1.7;

type Reply = { language: 'gu'; words: { w: string; start: number; end: number; c: number | null }[] };

/** What the stand-in helper hears in `seconds` of a phrase: unsure hum first, then each word 0.2 s after it ends. */
function speechReply(seconds: number): Reply {
  if (seconds < CONTEXT_S)
    return {
      language: 'gu',
      words: [
        { w: 'તે', start: 0.1, end: 0.2, c: 0.3 },
        { w: 'છે', start: 0.3, end: 0.4, c: 0.2 },
      ],
    };
  const words = WORDS.flatMap((w, i) =>
    (i + 1) * WORD_S <= seconds - 0.2 ? [{ w, start: i * WORD_S, end: (i + 1) * WORD_S, c: 0.9 }] : [],
  );
  return { language: 'gu', words };
}

/** Hum: whatever the stand-in hears is one-syllable and unsure, however long it lasts (cap-integration's filter). */
function humReply(seconds: number): Reply {
  return {
    language: 'gu',
    words: [
      { w: 'હ', start: 0, end: Math.min(0.2, seconds), c: 0.2 },
      { w: 'છે', start: Math.min(0.2, seconds), end: Math.min(0.4, seconds), c: 0.35 },
    ],
  };
}

function setup(reply: (seconds: number) => Reply) {
  let chunk: ((samples: Int16Array, endAt: number, startAt?: number) => void) | undefined;
  const decoded: number[] = [];
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
          decoded.push(samples.length / RATE);
          return new Promise<Reply>((resolve) =>
            setTimeout(() => resolve(reply(samples.length / RATE)), DECODE_MS),
          );
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
  /** The stream's sound, 100 ms at a time on the clock: `speech` loud chunks, then `quiet` silent ones. */
  const play = async (speech: number, quiet: number): Promise<void> => {
    for (let i = 0; i < speech + quiet; i += 1) {
      await vi.advanceTimersByTimeAsync(100);
      const now = Date.now();
      chunk?.(new Int16Array(1_600).fill(i < speech ? 5_000 : 0), now, now - 100);
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
    await t.play(0, 10); // a second of quiet: the speech gate learns the room
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
    // The final decode is the whole phrase, as before: its sound from onset to the end of its pause.
    expect(t.decoded.at(-1)).toBeCloseTo(4.7, 5);
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
    await t.play(0, 10);
    await t.play(30, 25); // three seconds of hum, then quiet
    expect(t.decoded.length).toBeGreaterThan(0);
    expect(t.lines()).toEqual([]);
    expect(t.heard.filter((h) => h.words.length > 0)).toEqual([]);
  });
});
