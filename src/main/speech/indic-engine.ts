import type { CaptionTiming } from '../../shared/captions';
import { SPEECH_RATE, type Heard } from '../../shared/speech';
import type { SpeechEngine } from './hub';
import { isSpeech } from './speech-level';
import {
  indicWords,
  noiseOnly,
  parseIndicReply,
  type IndicFiles,
  type IndicLanguage,
} from './indic-protocol';
import { openIndicPipe, type IndicPipe, type IndicPipeOptions } from './indic-pipe';

/** Route C's scheduler deliberately retains today's phrase, capture-clock, queue and lag guards.
 * Whisper's production code is unchanged. Off is owned by cap-integration, which selects this SpeechEngine only
 * after an operator selects the imported pack's explicit Gujarati/Hindi model. No model is downloaded here. */
export interface IndicEngineOptions {
  program(): string | null;
  problem?: () => string | null;
  /** Explicit continuous-ASR policy; still requires native below-show priority. A provided gate always wins. */
  admission?: 'below-show';
  /** Read-only authoritative show/background lease. Closed or unknown is closed; overrides below-show admission. */
  workGate?: { allowed(): boolean; listen(changed: () => void): () => void };
  /** Acquire a checked imported model; release only once native work has stopped. Never an installer model. */
  acquire(
    language: IndicLanguage,
    signal?: AbortSignal,
  ): { files: IndicFiles; release(): void } | null | Promise<{ files: IndicFiles; release(): void } | null>;
  sound: {
    open(chunk: (samples: Int16Array, endAt: number, startAt?: number) => void): (() => void) | null;
  };
  log: { info(message: string): void; warn(message: string): void };
  /** The helper's compute threads: Route C's own (two in the app), whatever the dialog's thread setting. */
  threads?: number;
  /**
   * The dialog's live timing on this computer (alpha.23, the review), read once at each start as Whisper's engine
   * reads it: the step, the pause, the longest phrase and the speech level. Not its threads (above). Without it,
   * the timing captions always had.
   */
  timing?: () => CaptionTiming;
  open?: (options: IndicPipeOptions) => Promise<IndicPipe>;
}
const SAMPLE_RATE = SPEECH_RATE;
interface CapturedSpan {
  from: number;
  to: number;
  startAt: number;
  endAt: number;
}

/** Recognizer offsets count samples; gaps or slow capture must not turn recent words into old ones. */
function capturedAt(spans: readonly CapturedSpan[], seconds: number, beginning: boolean): number {
  const last = spans[spans.length - 1];
  if (!last) return NaN;
  const sample = Math.max(0, Math.min(last.to, Math.round(seconds * SAMPLE_RATE)));
  const span = spans.find((part) => (beginning ? sample < part.to : sample <= part.to)) ?? last;
  const fraction = Math.max(0, Math.min(1, (sample - span.from) / (span.to - span.from)));
  return span.startAt + fraction * (span.endAt - span.startAt);
}

interface Growing {
  id: string;
  samples: Int16Array[];
  captured: CapturedSpan[];
  length: number;
  startAt: number;
  endAt: number;
  quietMs: number;
  sentAt: number;
  /** How often it was worked out while growing, and whether any of those gave words (after the noise filter). */
  partials: number;
  shown: boolean;
  /** How long its last working out took (ms). */
  tookMs: number;
  /** Its early final (QA24-CAPFAST-1), asked in this stretch of quiet; gone when speech comes again. */
  early: Early | null;
}

/** The early final: where its speech ended, and once it answered, the phrase as heard then. */
interface Early {
  /** Where its speech ended in what was asked (seconds): a word begun after that is not kept. */
  speechS: number;
  heard: Heard | null;
  answered: boolean;
}

/*
 * When a growing phrase is worked out again (cap-partials, alpha.23). Route C's model hears the whole phrase at once
 * (not streaming), and in a phrase's first second or two it often hears only what the noise filter hides; on the
 * dialog's step alone, a phrase then showed its first words only at the next step, often with its final (cap-winci's
 * bench: first words p95 4.3-4.7 s from the speech's onset). So, until a phrase has shown words, and only in its
 * first 2.5 s of sound, it is worked out every half second; after that, at the dialog's step, as before. Each time,
 * never sooner than twice as long as its last working out took, so on a slow computer the helper is busy at most
 * half the time (cap-review-partials S3). No partial starts once a phrase has 300 ms of quiet: its words do not
 * change in quiet. A final can still wait behind a partial begun before that (in the last of the speech or up to
 * 300 ms into the quiet), at most for the rest of that one decode: about 0.2 s on a fast Mac with the 0.5 s pause,
 * up to about a second on a two-core Windows computer (cap-review-partials S1), and less often than before, when a
 * partial could start anywhere in the pause. At the longest phrase there is no pause, as before.
 */
const FIRST_SAMPLES = SAMPLE_RATE;
const EARLY_SAMPLES = SAMPLE_RATE * 2.5;
const EARLY_STEP_MS = 500;
const PAUSING_MS = 300;

/*
 * A growing phrase is cut off mid-speech, without the pause a whole phrase ends with, and the model, trained on whole
 * phrases, then often hears only hum (cap-partials' probes of the committed synthetic clips: with half a second of
 * quiet after the cut, a partial is heard from 0.8 s of sound in every clip; without it, at p95 only from 2.4 s and in
 * some clips never before the final). So a partial is worked out with PAD of the room's own quiet after it (the quiet
 * last heard between phrases; silence before any was heard). A final is never padded: it already ends with its pause,
 * and its words are exactly as before. Of a padded partial, only its first words are shown, each ending at least
 * MARGIN before the sound heard so far ends: a word still being spoken at the cut, or one heard in the quiet added,
 * is the one most likely wrong (lead 2: the screens must not flash a word the final does not confirm; on the probes,
 * 0.3 s leaves fewer such words than today's partials, with the first words as soon).
 */
const PAD_SAMPLES = SAMPLE_RATE * 0.5;
const MARGIN_S = 0.3;

/**
 * A partial's sound: the phrase so far, then the room's quiet (repeated to PAD; silence when none was heard yet), never
 * past the twelve seconds the helper takes at once.
 */
function padded(phrase: Int16Array, quiet: Int16Array): Int16Array {
  const out = new Int16Array(
    Math.max(phrase.length, Math.min(SAMPLE_RATE * 12, phrase.length + PAD_SAMPLES)),
  );
  out.set(phrase);
  if (quiet.length === 0) return out;
  for (let at = phrase.length; at < out.length; at += quiet.length)
    out.set(quiet.subarray(0, Math.min(quiet.length, out.length - at)), at);
  return out;
}

/** How many of a padded partial's first words to show: each ended MARGIN before its sound so far (seconds) ends. */
function wordsToShow(words: readonly { start: number; end: number }[], seconds: number): number {
  const n = words.findIndex((w) => w.start >= seconds || w.end > seconds - MARGIN_S);
  return n < 0 ? words.length : n;
}

/*
 * The early final (QA24-CAPFAST-1; the owner: "faster caption as well, 0.5seconds or around", then "Yes, show at
 * once"). A phrase's words are all said once it has PAUSING_MS of quiet, but its final waited for the whole pause
 * (700 ms by default) and then one decode: about 0.9 s on a two-core Windows PC, 1.1 s on a Mac. So once it has
 * PAUSING_MS of quiet it is decoded as it is then, unpadded as a final is, and its words go on the screens at once,
 * still unsettled. If the speaker is still quiet when the pause ends, that decode is the phrase's final, with no decode
 * after it; if it is still decoding then, its answer settles the phrase when it comes. Speech before that and the
 * phrase goes on (a later quiet asks again); a phrase that ends at the longest phrase, with no pause, is decoded whole
 * as before. Of its words, one begun more than LATE_S after the phrase's last speech is not kept: the quiet is no
 * one's words. Measured
 * (a24-capfast) on 30 minutes of real Gujarati: WER +0.5 points [-0.4, +1.7] against the final after the whole pause.
 */
function earlyDue(g: Growing): boolean {
  return g.quietMs >= PAUSING_MS && g.early === null;
}

/**
 * How many of an early final's words to keep: those begun before the phrase's last speech ended (seconds), or within
 * LATE_S after it, where the helper's 40 ms frames can put a word said at the very end (a generated model's last words
 * begin 20-60 ms after its one chunk of speech: indic-captions.spec.ts). A word begun later was heard in the quiet.
 */
const LATE_S = 0.1;
function wordsBefore(words: readonly { start: number }[], speechS: number): number {
  const n = words.findIndex((w) => w.start >= speechS + LATE_S);
  return n < 0 ? words.length : n;
}

/** The quiet a growing phrase ends with, in samples. */
function quietSamples(g: Growing): number {
  return Math.min(g.length, Math.round((g.quietMs / 1000) * SAMPLE_RATE));
}

function partialDue(g: Growing, stepMs: number, now: number): boolean {
  if (g.length < FIRST_SAMPLES || g.quietMs >= PAUSING_MS) return false;
  if (!g.shown && g.length <= EARLY_SAMPLES)
    return g.partials === 0 || now - g.sentAt >= Math.max(EARLY_STEP_MS, 2 * g.tookMs);
  return now - g.sentAt >= Math.max(stepMs, 2 * g.tookMs);
}

export function createIndicEngine(o: IndicEngineOptions): SpeechEngine {
  const restMs = 60_000;
  return {
    start(language, to) {
      // The live timing, as it is now: a change starts listening again (as Whisper's engine).
      const timing = o.timing?.();
      const stepMs = timing?.stepMs ?? 1_500;
      const pauseMs = timing?.pauseMs ?? 700;
      const maxMs = timing?.longestMs ?? 12_000;
      const speechLevel = timing?.speech ?? 'standard';
      if (language !== 'gu' && language !== 'hi') {
        to.state({ phase: 'failed', message: 'Choose Gujarati or Hindi for this recognition model.' });
        return () => undefined;
      }
      const problem = o.problem?.();
      if (problem) {
        to.state({ phase: 'failed', message: problem });
        return () => undefined;
      }
      const gate = o.workGate;
      const belowShow = o.admission === 'below-show';
      if (!gate && !belowShow) {
        to.state({
          phase: 'failed',
          message: 'Recognition is not ready on this computer yet.',
        });
        return () => undefined;
      }
      const allowed = (): boolean => {
        try {
          return gate ? gate.allowed() : belowShow;
        } catch {
          return false;
        }
      };
      const chosen: IndicLanguage = language;
      let stopped = false;
      const ended = (): boolean => stopped;
      let pipe: IndicPipe | null = null;
      let release: (() => void) | null = null;
      let controller: AbortController | null = null;
      let closeSound: (() => void) | null = null;
      let busy = false;
      const resting = (): boolean => busy;
      let gateHeld = !allowed();
      let slowInARow = 0;
      let phrase: Growing | null = null;
      let count = 0;
      let generation = 0;
      let rest: NodeJS.Timeout | null = null;
      let retrySound: NodeJS.Timeout | null = null;
      let floor = 300;
      // The room's quiet heard last between phrases (at most PAD), to pad a partial with.
      let roomQuiet = new Int16Array(0);
      const finals: Growing[] = [];
      // A phrase whose pause has ended while its early final is still decoding: that answer settles it.
      let settling: Growing | null = null;
      const end = (): void => {
        generation += 1;
        settling = null;
        closeSound?.();
        closeSound = null;
        if (retrySound) clearTimeout(retrySound);
        retrySound = null;
        phrase = null;
        finals.length = 0;
        controller?.abort();
        controller = null;
        const was = pipe;
        pipe = null;
        const letGo = release;
        release = null;
        was?.close();
        if (was?.exited && letGo) void was.exited.then(letGo);
        else if (was || o.open) letGo?.();
      };
      const fail = (): void => {
        end();
        to.state({
          phase: 'failed',
          message: 'The recognition model stopped. Turn captions off and on to try again.',
        });
      };
      const ask = async (samples: Int16Array): Promise<{ reply: unknown; tookMs: number } | null> => {
        const current = pipe;
        if (!current) return null;
        const began = Date.now();
        const reply = await current.decode(samples);
        return { reply, tookMs: Date.now() - began };
      };
      const joined = (p: Growing): Int16Array => {
        const all = new Int16Array(p.length);
        let at = 0;
        for (const part of p.samples) {
          all.set(part, at);
          at += part.length;
        }
        return all;
      };

      const hold = (): void => {
        if (busy || stopped) return;
        busy = true;
        o.log.warn(
          'Speech: the computer cannot keep up, so captions rest for a minute (the show comes first).',
        );
        to.state({ phase: 'held', reason: 'busy' });
        end();
        rest = setTimeout(() => {
          rest = null;
          busy = false;
          slowInARow = 0;
          void begin();
        }, restMs);
      };

      let working = false;
      /** Send the next piece: a whole phrase first, else the growing one if a step has passed. */
      const pump = async (): Promise<void> => {
        if (working || stopped || busy || !allowed()) return;
        const final = finals.shift();
        const growing = final ? null : phrase;
        const piece = final ?? growing;
        if (!piece) return;
        const early: Early | null =
          growing && earlyDue(growing)
            ? {
                speechS: (growing.length - quietSamples(growing)) / SAMPLE_RATE,
                heard: null,
                answered: false,
              }
            : null;
        if (growing && !early && !partialDue(growing, stepMs, Date.now())) return;
        const mine = generation;
        working = true;
        piece.sentAt = Date.now();
        if (growing && early) growing.early = early;
        // A partial with the room's quiet after it; a final, or an early final, exactly as heard.
        const samples = growing && !early ? padded(joined(piece), roomQuiet) : joined(piece);
        const heardS = piece.length / SAMPLE_RATE;
        // Freeze the clock with the submitted samples: more microphone chunks can arrive during inference.
        const captured = piece.captured.slice();
        const clipAt = piece.startAt;
        const clipEndAt = piece.endAt;
        try {
          const asked = await ask(samples);
          if (!asked || ended() || mine !== generation || !allowed()) return;
          const behind = Date.now() - clipEndAt;
          slowInARow = asked.tookMs > stepMs * 1.5 ? slowInARow + 1 : 0;
          if (slowInARow >= 3 || behind > 8_000) {
            hold();
            return;
          }
          const heardIn = chosen;
          const decoded = indicWords(asked.reply, chosen, clipAt, clipEndAt, (seconds, beginning) =>
            capturedAt(captured, seconds, beginning),
          );
          // A padded partial shows only its first words that ended before the cut (above); a final, all of them; an
          // early final, all those begun before the phrase's last speech.
          const reply = parseIndicReply(asked.reply, chosen).words;
          const kept = early
            ? reply.slice(0, wordsBefore(reply, early.speechS))
            : growing
              ? reply.slice(0, wordsToShow(reply, heardS))
              : reply;
          // Noise or hum (one-syllable words heard unsure) is nothing heard: a growing phrase clears, a whole goes.
          const words = noiseOnly(kept) ? [] : decoded.slice(0, kept.length);
          if (growing) {
            growing.partials += 1;
            growing.tookMs = asked.tookMs;
            // Words of an early decode the speaker went on after were never passed on: not shown (a24-review-capfast F1).
            if (words.length > 0 && (!early || growing.early === early)) growing.shown = true;
          }
          const heardAs = (whole: boolean): Heard => ({
            id: piece.id,
            final: whole,
            language: heardIn,
            languageConfidence: null,
            words,
            text: words.map((w) => w.text).join(' '),
            startAt: Math.min(clipAt, words[0]?.startAt ?? clipAt),
            endAt: Math.max(words.at(-1)?.endAt ?? clipAt, clipAt),
            heardAt: Date.now(),
          });
          if (early && growing) {
            // Speech came since it was asked: the phrase goes on, and this answer is not its final.
            if (growing.early !== early) return;
            early.answered = true;
            early.heard = words.length > 0 ? heardAs(true) : null;
            if (settling === growing) {
              // Its pause ended while it was decoding: this answer settles it.
              settling = null;
              if (early.heard) to.heard({ ...early.heard, heardAt: Date.now() });
              return;
            }
            // Shown at once, unsettled until the pause ends (the owner: "Yes, show at once").
            if (words.length > 0) to.heard(heardAs(false));
            return;
          }
          if (final && words.length === 0) return;
          to.heard(heardAs(final !== undefined));
        } catch {
          if (!ended() && !resting() && mine === generation) fail();
        } finally {
          working = false;
          if (!ended()) setImmediate(() => void pump());
        }
      };

      const chunk = (samples: Int16Array, endAt: number, startAt?: number): void => {
        if (stopped || busy || !allowed()) return;
        const ms = (samples.length / SAMPLE_RATE) * 1000;
        const capturedStart = startAt ?? endAt - ms;
        if (
          samples.length === 0 ||
          samples.length > SAMPLE_RATE ||
          !Number.isFinite(capturedStart) ||
          !Number.isFinite(endAt) ||
          capturedStart > endAt
        )
          return;
        const room = SAMPLE_RATE * 12 - (phrase?.length ?? 0);
        if (samples.length > room) {
          // Capture callbacks need not divide twelve seconds evenly. Keep both sides and their capture clock.
          const boundary = capturedStart + ((endAt - capturedStart) * room) / samples.length;
          chunk(samples.subarray(0, room), boundary, capturedStart);
          chunk(samples.subarray(room), endAt, boundary);
          return;
        }
        let sum = 0;
        for (const s of samples) sum += s * s;
        const level = Math.sqrt(sum / Math.max(1, samples.length));
        const speech = isSpeech(level, floor, speechLevel);
        if (!speech) floor = floor * 0.95 + level * 0.05;
        if (!phrase) {
          if (!speech) {
            const kept = new Int16Array(Math.min(PAD_SAMPLES, roomQuiet.length + samples.length));
            const fromOld = kept.length - Math.min(kept.length, samples.length);
            kept.set(roomQuiet.subarray(roomQuiet.length - fromOld), 0);
            kept.set(samples.subarray(samples.length - (kept.length - fromOld)), fromOld);
            roomQuiet = kept;
            return;
          }
          count += 1;
          phrase = {
            // The hub's phrase ids, as Whisper's engine gives them: s1, s2… in this listening.
            id: `s${String(count)}`,
            samples: [],
            captured: [],
            length: 0,
            startAt: capturedStart,
            endAt,
            quietMs: 0,
            sentAt: Date.now(),
            partials: 0,
            shown: false,
            tookMs: 0,
            early: null,
          };
        }
        phrase.captured.push({
          from: phrase.length,
          to: phrase.length + samples.length,
          startAt: capturedStart,
          endAt,
        });
        phrase.samples.push(samples);
        phrase.length += samples.length;
        phrase.endAt = endAt;
        phrase.quietMs = speech ? 0 : phrase.quietMs + ms;
        // More was said: an early final asked in the quiet before no longer stands (QA24-CAPFAST-1).
        if (speech) phrase.early = null;
        if (
          phrase.quietMs >= pauseMs ||
          phrase.length >= SAMPLE_RATE * 12 ||
          endAt - phrase.startAt >= maxMs
        ) {
          const early = phrase.quietMs >= pauseMs ? phrase.early : null;
          const ended = phrase;
          phrase = null;
          if (early?.answered) {
            // Its pause has ended and the speaker stayed quiet: the early final is the phrase's final, now.
            if (early.heard) to.heard({ ...early.heard, heardAt: Date.now() });
          } else if (early) {
            // Still decoding: its answer settles the phrase when it comes.
            settling = ended;
          } else {
            finals.push(ended);
            // More than two whole phrases waiting: the oldest is dropped (the hub would drop it as late anyway).
            if (finals.length > 2) finals.shift();
          }
        }
        void pump();
      };

      const openSound = (): void => {
        if (stopped || busy || !allowed()) return;
        const mine = generation;
        closeSound = o.sound.open((samples, endAt, startAt) => {
          if (mine === generation) chunk(samples, endAt, startAt);
        });
        if (closeSound) {
          to.state({ phase: 'listening', language });
          return;
        }
        to.state({ phase: 'held', reason: 'no-sound-input' });
        retrySound = setTimeout(openSound, 5_000);
      };

      const begin = async (): Promise<void> => {
        if (stopped) return;
        if (!allowed()) {
          gateHeld = true;
          to.state({ phase: 'held', reason: 'busy' });
          return;
        }
        const program = o.program();
        if (!program) {
          to.state({
            phase: 'failed',
            message: 'This copy of Drashti has no Gujarati or Hindi recognition engine.',
          });
          return;
        }
        const mine = ++generation;
        const abort = new AbortController();
        controller = abort;
        to.state({ phase: 'starting' });
        try {
          const held = await o.acquire(chosen, abort.signal);
          if (ended() || mine !== generation || !allowed()) {
            held?.release();
            return;
          }
          if (!held) {
            to.state({ phase: 'held', reason: 'no-model' });
            return;
          }
          let heldHere = true;
          const letGo = (): void => {
            if (heldHere) {
              heldHere = false;
              held.release();
            }
          };
          release = letGo;
          const started = await (o.open ?? openIndicPipe)({
            program,
            files: held.files,
            language: chosen,
            threads: o.threads ?? 1,
            signal: abort.signal,
            onExit: letGo,
            failed: (reason) => {
              if (!ended() && !resting() && mine === generation) {
                if (reason === 'recogniser lag') hold();
                else fail();
              }
            },
          });
          if (ended() || mine !== generation || !allowed()) {
            started.close();
            return;
          }
          pipe = started;
          openSound();
        } catch {
          if (!ended() && mine === generation) fail();
        }
      };
      let stopGate: () => void;
      let observing = false;
      try {
        stopGate =
          gate?.listen(() => {
            if (stopped || !observing) return;
            if (!allowed()) {
              gateHeld = true;
              end();
              to.state({ phase: 'held', reason: 'busy' });
            } else if (gateHeld) {
              gateHeld = false;
              if (!busy) void begin();
            }
          }) ?? (() => undefined);
      } catch {
        to.state({ phase: 'failed', message: 'Recognition is not ready on this computer yet.' });
        return () => undefined;
      }
      observing = true;
      void begin();
      return () => {
        if (stopped) return;
        stopped = true;
        if (rest) clearTimeout(rest);
        rest = null;
        end();
        try {
          stopGate();
        } catch {
          /* Native work is already stopped; a detached observer cannot restart it. */
        }
      };
    },
  };
}
