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
}

/*
 * When a growing phrase is worked out again (cap-partials, alpha.23). Route C's model hears the whole phrase at once
 * (not streaming), and in a phrase's first second or two it often hears only what the noise filter hides; on the
 * dialog's step alone, a phrase then showed its first words only at the next step, often with its final (cap-winci's
 * bench: first words p95 4.3-4.7 s from the speech's onset). So, until a phrase has shown words, and only in its
 * first seconds of sound, it is worked out every half second (at least twice as long as its last working out took,
 * so the helper is never busy more than half the time); after that, at the dialog's step, as before. A phrase in a
 * pause waits: its words do not change in quiet, and its final (the whole phrase, worked out once) then never waits
 * behind a partial.
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
  const out = new Int16Array(Math.max(phrase.length, Math.min(SAMPLE_RATE * 12, phrase.length + PAD_SAMPLES)));
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

function partialDue(g: Growing, stepMs: number, now: number): boolean {
  if (g.length < FIRST_SAMPLES || g.quietMs >= PAUSING_MS) return false;
  if (!g.shown && g.length <= EARLY_SAMPLES)
    return g.partials === 0 || now - g.sentAt >= Math.max(EARLY_STEP_MS, 2 * g.tookMs);
  return now - g.sentAt >= stepMs;
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
      const end = (): void => {
        generation += 1;
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
        if (!piece || (growing && !partialDue(growing, stepMs, Date.now()))) return;
        const mine = generation;
        working = true;
        piece.sentAt = Date.now();
        // A partial with the room's quiet after it; a final exactly as heard (its pause is its own).
        const samples = growing ? padded(joined(piece), roomQuiet) : joined(piece);
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
          // A padded partial shows only its first words that ended before the cut (above); a final, all of them.
          const reply = parseIndicReply(asked.reply, chosen).words;
          const kept = growing ? reply.slice(0, wordsToShow(reply, heardS)) : reply;
          // Noise or hum (one-syllable words heard unsure) is nothing heard: a growing phrase clears, a whole goes.
          const words = noiseOnly(kept) ? [] : decoded.slice(0, kept.length);
          if (growing) {
            growing.partials += 1;
            growing.tookMs = asked.tookMs;
            if (words.length > 0) growing.shown = true;
          }
          if (final && words.length === 0) return;
          const heard: Heard = {
            id: piece.id,
            final: final !== undefined,
            language: heardIn,
            languageConfidence: null,
            words,
            text: words.map((w) => w.text).join(' '),
            startAt: Math.min(clipAt, words[0]?.startAt ?? clipAt),
            endAt: Math.max(words.at(-1)?.endAt ?? clipAt, clipAt),
            heardAt: Date.now(),
          };
          to.heard(heard);
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
        if (
          phrase.quietMs >= pauseMs ||
          phrase.length >= SAMPLE_RATE * 12 ||
          endAt - phrase.startAt >= maxMs
        ) {
          finals.push(phrase);
          phrase = null;
          // More than two whole phrases waiting: the oldest is dropped (the hub would drop it as late anyway).
          if (finals.length > 2) finals.shift();
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
