import { randomUUID } from 'node:crypto';
import { SPEECH_RATE, type Heard } from '../../shared/speech';
import type { SpeechEngine } from './hub';
import type { PcmSource } from './whisper-engine';
import { indicWords, type IndicFiles, type IndicLanguage } from './indic-protocol';
import { openIndicPipe, type IndicPipe, type IndicPipeOptions } from './indic-pipe';

/** Route C's scheduler deliberately retains today's phrase, capture-clock, queue and lag guards.
 * Whisper's production code is unchanged. Off is owned by cap-integration, which selects this SpeechEngine only
 * after an operator selects the imported pack's explicit Gujarati/Hindi model. No model is downloaded here. */
export interface IndicEngineOptions {
  program(): string | null;
  problem?: () => string | null;
  /** Acquire a checked imported model; release only once native work has stopped. Never an installer model. */
  acquire(
    language: IndicLanguage,
    signal?: AbortSignal,
  ): { files: IndicFiles; release(): void } | null | Promise<{ files: IndicFiles; release(): void } | null>;
  sound: PcmSource;
  log: { info(message: string): void; warn(message: string): void };
  threads?: number;
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
}

export function createIndicEngine(o: IndicEngineOptions): SpeechEngine {
  const stepMs = 1_500,
    pauseMs = 700,
    maxMs = 12_000,
    restMs = 60_000;
  return {
    start(language, to) {
      if (language !== 'gu' && language !== 'hi') {
        to.state({ phase: 'failed', message: 'Choose Gujarati or Hindi for this recognition model.' });
        return () => undefined;
      }
      const problem = o.problem?.();
      if (problem) {
        to.state({ phase: 'failed', message: problem });
        return () => undefined;
      }
      const chosen: IndicLanguage = language;
      const session = randomUUID();
      let stopped = false;
      const ended = (): boolean => stopped;
      let pipe: IndicPipe | null = null;
      let release: (() => void) | null = null;
      let controller: AbortController | null = null;
      let closeSound: (() => void) | null = null;
      let busy = false;
      let slowInARow = 0;
      let phrase: Growing | null = null;
      let count = 0;
      let generation = 0;
      let rest: NodeJS.Timeout | null = null;
      let retrySound: NodeJS.Timeout | null = null;
      let floor = 300;
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
        if (working || stopped || busy) return;
        const final = finals.shift();
        const growing = final ? null : phrase;
        const piece = final ?? growing;
        if (!piece || (growing && (Date.now() - growing.sentAt < stepMs || growing.length < SAMPLE_RATE)))
          return;
        const mine = generation;
        working = true;
        piece.sentAt = Date.now();
        const samples = joined(piece);
        // Freeze the clock with the submitted samples: more microphone chunks can arrive during inference.
        const captured = piece.captured.slice();
        const clipAt = piece.startAt;
        const clipEndAt = piece.endAt;
        try {
          const asked = await ask(samples);
          if (!asked || ended() || mine !== generation) return;
          const behind = Date.now() - clipEndAt;
          slowInARow = asked.tookMs > stepMs * 1.5 ? slowInARow + 1 : 0;
          if (slowInARow >= 3 || behind > 8_000) {
            hold();
            return;
          }
          const heardIn = chosen;
          if (heardIn === null) return;
          const words = indicWords(asked.reply, chosen, clipAt, clipEndAt, (seconds, beginning) =>
            capturedAt(captured, seconds, beginning),
          );
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
          if (!ended() && !busy && mine === generation) fail();
        } finally {
          working = false;
          if (!ended()) setImmediate(() => void pump());
        }
      };

      const chunk = (samples: Int16Array, endAt: number, startAt?: number): void => {
        if (stopped || busy) return;
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
        let sum = 0;
        for (const s of samples) sum += s * s;
        const level = Math.sqrt(sum / Math.max(1, samples.length));
        const speech = level > Math.max(400, floor * 3);
        if (!speech) floor = floor * 0.95 + level * 0.05;
        if (!phrase) {
          if (!speech) return;
          count += 1;
          phrase = {
            id: `${session}:${String(count)}`,
            samples: [],
            captured: [],
            length: 0,
            startAt: capturedStart,
            endAt,
            quietMs: 0,
            sentAt: Date.now(),
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
        if (stopped || busy) return;
        closeSound = o.sound.open(chunk);
        if (closeSound) {
          to.state({ phase: 'listening', language });
          return;
        }
        to.state({ phase: 'held', reason: 'no-sound-input' });
        retrySound = setTimeout(openSound, 5_000);
      };

      const begin = async (): Promise<void> => {
        if (stopped) return;
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
          if (ended() || mine !== generation) {
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
            failed: () => {
              if (!ended() && !busy && mine === generation) fail();
            },
          });
          if (ended() || mine !== generation) {
            started.close();
            return;
          }
          pipe = started;
          openSound();
        } catch {
          if (!ended() && mine === generation) fail();
        }
      };
      void begin();
      return () => {
        if (stopped) return;
        stopped = true;
        if (rest) clearTimeout(rest);
        rest = null;
        end();
      };
    },
  };
}
