import { spawn as spawnChild, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { availableParallelism, constants, setPriority } from 'node:os';
import { CAPTIONS_STOP_AFTER_RESTS, type CaptionTiming } from '../../shared/captions';
import {
  SPEECH_RATE,
  type Heard,
  type HeardWord,
  type SlowHold,
  type SpeechLanguage,
} from '../../shared/speech';
import type { CaptionHints } from './caption-hints';
import { audioContextFor } from './whisper-context';
import { whisperDependencyProblem } from './engine-place';
import type { SpeechEngine } from './hub';
import { isSpeech } from './speech-level';

/*
 * The captions engine (Session 55, Part 10): whisper.cpp's server (whisper-server.exe on Windows, from whisper.cpp's
 * own release; on a Mac our small program on whisper.cpp's prebuilt library, which answers the same way), a separate
 * program on 127.0.0.1 that keeps the model loaded. It runs below the show's priority. The stream's sound input comes
 * in as 16 kHz mono samples; a pause cuts it into phrases, each sent as it grows (partials) and once whole (final).
 * If the computer cannot keep up (each piece takes too long, or it falls more than a few seconds behind) it stops by
 * itself (held, busy, with what it measured) and tries again a minute later: the show comes first. After three rests
 * in a row, with no phrase heard whole since it started, it stops trying (the owner, cap-threads: "Say so and stop"). It never logs a word, and the program's own
 * output is never read. It is never given more threads than the computer has logical
 * processors (cap-threads: 4 threads on CI's two-core Windows, and nothing was ever shown).
 */

export const SAMPLE_RATE = SPEECH_RATE;

/** The stream's sound input, 16 kHz mono 16-bit, each chunk with when its last sample was heard (epoch ms). */
export interface PcmSource {
  /** Start; null when there is no sound input. Returns how to stop. */
  open(chunk: (samples: Int16Array, endAt: number, startAt?: number) => void): (() => void) | null;
}

export interface WhisperEngineOptions {
  /** The engine program, or null when this copy of Drashti has none. */
  program: () => string | null;
  /** The model file for the speaker's language (alpha.22: a language's own model, or the general one). */
  model: (language: SpeechLanguage | 'auto') => string;
  /**
   * Why the model for this language may not be used now (alpha.22: a language's own model missing, or changed since
   * it was checked), or null. Asked before every start of the program, a restart after a rest too: never loaded then.
   */
  modelProblem?: (language: SpeechLanguage | 'auto') => string | null;
  /** Whether a failed piece is tried again warmer (whisper's fallback): off for the large model, which then loops less. */
  fallback: (language: SpeechLanguage | 'auto') => boolean;
  /**
   * Whether the model is decoded with timestamps (alpha.22): the tuned language models are not (they were trained
   * with <|notimestamps|>), so the engine asks for none and gives their words the clip's times. Yes when left out.
   */
  timestamps?: (language: SpeechLanguage | 'auto') => boolean;
  /**
   * Live timing on this computer (alpha.22): read once at each start. Without it (or for a test, the fixed values
   * below), the timing captions always had.
   */
  timing?: () => CaptionTiming;
  sound: PcmSource;
  log: { info(message: string): void; warn(message: string): void };
  threads?: number;
  /**
   * This computer's logical processors (os.availableParallelism; a test may say): whisper-server is never given more
   * threads than these (cap-threads).
   */
  processors?: () => number;
  /**
   * Whether captions have shown a phrase whole since the operator last turned them on (the service's memory, across
   * this engine's starts: a language change, a timing change, Route W's fresh engine; cap-review-threads MUST-1b). A
   * computer that has kept up is never stopped. Left out: only this start's own phrases count.
   */
  keptUp?: () => boolean;
  spawn?: (program: string, args: string[]) => ChildProcess;
  fetch?: typeof fetch;
  /** How long to wait for the engine to load its model (the first start on a Mac also builds its GPU programs). */
  readyMs?: number;
  /** Phrases: a piece is sent every stepMs while one grows; a pause of pauseMs ends it; maxMs ends it anyway. */
  stepMs?: number;
  pauseMs?: number;
  maxMs?: number;
  /** Held this long when it could not keep up, then tried again. */
  restMs?: number;
  /** The admin's caption words for the language listened in (alpha.22), given to whisper.cpp as its prompt. */
  hints?: CaptionHints;
  /**
   * QWC-1 (the owner: "Yes, Windows small"): whether the language's engine sizes whisper's audio context to each piece, with the
   * temperature fallback off (whisper-context.ts: a CPU engine with a small model only). Asked at each start; left
   * out or false, the request is today's exactly.
   */
  sizedContext?: (language: SpeechLanguage | 'auto') => boolean;
  /**
   * Told once after each stop, when the program that start ran has exited, or at once when none is running
   * (alpha.23: Route W gives the pack's model file back only then, as Windows cannot remove a file a program still has
   * open). Never told while listening. Left out (today's captions): nothing is told.
   */
  onExited?: () => void;
}

const LANGUAGE_CODES = new Map<string, SpeechLanguage>([
  ['gujarati', 'gu'],
  ['hindi', 'hi'],
  ['sanskrit', 'sa'],
  ['english', 'en'],
]);

/**
 * The threads whisper-server is started with (cap-threads): the dialog's setting, but never more than this computer's
 * logical processors, and at least one. A computer with 4 or more (every Mac that runs macOS 13) keeps the setting.
 * Not one fewer than the processors: the engine already runs below the show's priority, so the show's own work comes
 * first, and on two processors one thread would only make a slow engine slower.
 */
export function whisperThreads(setting: number, processors: number): number {
  const here = Number.isFinite(processors) ? Math.floor(processors) : 1;
  return Math.max(1, Math.min(setting, here));
}

/** Whether a chunk is speech (alpha.22's speech level; its own module so Route C shares it, alpha.23). */
export { isSpeech };

/** A free port on 127.0.0.1 for the engine. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/** 16-bit mono samples as a WAV file. */
export function wavOf(samples: Int16Array): Uint8Array {
  const data = samples.length * 2;
  const out = new Uint8Array(44 + data);
  const view = new DataView(out.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, samples[i] ?? 0, true);
  return out;
}

interface Token {
  word: string;
  start?: number;
  end?: number;
  probability?: number;
}
interface Reply {
  language?: string;
  segments?: { words?: Token[]; no_speech_prob?: number }[];
}

/** What the engine heard in a clip that began at `clipAt` (epoch ms): its words, in order, never empty. */
export function wordsOf(
  reply: Reply,
  clipAt: number,
  clipEndAt: number,
  captured?: (seconds: number, beginning: boolean) => number,
  /** Decoded without timestamps (alpha.22: the tuned models): each word is given its whole clip, never made-up times. */
  coarse = false,
): HeardWord[] {
  const words: { text: string; start: number; end: number; p: number[] }[] = [];
  // A token that is only a space ends the word before it: whisper has no Gujarati tokens joined to a space before
  // them, so between Gujarati words the space comes as a token of its own (alpha.22, cap-route-w's finding).
  let spaced = false;
  for (const segment of reply.segments ?? []) {
    // Silence the engine still wrote something for.
    if ((segment.no_speech_prob ?? 0) > 0.6) continue;
    for (const token of segment.words ?? []) {
      const text = token.word;
      if (text.trim() === '') {
        spaced = true;
        continue;
      }
      const from = token.start ?? 0;
      const to = token.end ?? from;
      const start = captured ? captured(from, true) : clipAt + from * 1000;
      const end = captured ? captured(to, false) : clipAt + to * 1000;
      const last = words.at(-1);
      // A token without a space before it belongs to the word before it (a letter's second part, punctuation).
      if (last && !spaced && !/^\s/.test(text)) {
        last.text += text;
        last.end = Math.max(last.end, end);
        last.p.push(token.probability ?? 1);
      } else words.push({ text: text.trim(), start, end, p: [token.probability ?? 1] });
      spaced = false;
    }
  }
  const out: HeardWord[] = [];
  let lastStart = clipAt;
  let lastEnd = clipAt;
  for (const w of words) {
    const text = w.text.trim().normalize('NFC');
    // The engine's notes, not words: [BLANK_AUDIO], (music), ♪…
    if (text === '' || /^[[(*♪].*[\])*♪]$/u.test(text) || text.includes('�')) continue;
    const startAt = coarse ? clipAt : Math.min(clipEndAt, Math.max(lastStart, w.start));
    const endAt = coarse ? clipEndAt : Math.min(clipEndAt, Math.max(startAt, lastEnd, w.end));
    const confidence = w.p.reduce((a, b) => a + b, 0) / w.p.length;
    out.push({ text, startAt, endAt, confidence: Math.min(1, Math.max(0, confidence)) });
    lastStart = startAt;
    lastEnd = endAt;
  }
  return out;
}

/** The language the engine used, if Drashti captions it. */
export function writtenIn(reply: Reply): SpeechLanguage | null {
  return LANGUAGE_CODES.get((reply.language ?? '').toLowerCase()) ?? null;
}

/** A phrase being heard: its samples, from its start, and when its first sample was heard. */
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

export function createWhisperEngine(o: WhisperEngineOptions): SpeechEngine {
  const restMs = o.restMs ?? 60_000;
  const readyMs = o.readyMs ?? 90_000;
  const get = o.fetch ?? fetch;
  const run =
    o.spawn ??
    ((program, args) => {
      const options = { stdio: 'ignore', windowsHide: true } as const;
      // Keep the model's compute and disk work below the show, including while it loads.
      return process.platform === 'darwin'
        ? spawnChild('/usr/sbin/taskpolicy', ['-b', program, ...args], options)
        : spawnChild(program, args, options);
    });

  return {
    start(language, to) {
      // The live timing, as it is now (alpha.22): a change starts listening again.
      const timing = o.timing?.();
      const stepMs = timing?.stepMs ?? o.stepMs ?? 1_500;
      const pauseMs = timing?.pauseMs ?? o.pauseMs ?? 700;
      const maxMs = timing?.longestMs ?? o.maxMs ?? 12_000;
      // Never more threads than this computer's logical processors (cap-threads), read once at each start.
      const processors = (o.processors ?? availableParallelism)();
      const threads = whisperThreads(timing?.threads ?? o.threads ?? 4, processors);
      const speechLevel = timing?.speech ?? 'standard';
      let stopped = false;
      // Read through a function: stop() changes it while a piece is awaited, which the type checker cannot see.
      const ended = (): boolean => stopped;
      let child: ChildProcess | null = null;
      let closeSound: (() => void) | null = null;
      let address = '';
      let busy = false;
      let slowInARow = 0;
      // Rests in a row with no phrase heard whole between them (cap-threads: the dialog says when it is not once), and
      // whether a phrase has been heard whole since this start: one that has kept up is never stopped (review MUST-1).
      let rests = 0;
      let heardWhole = false;
      let phrase: Growing | null = null;
      let count = 0;
      let rest: NodeJS.Timeout | null = null;
      let retrySound: NodeJS.Timeout | null = null;
      let allowFallback = true;
      let withTimestamps = true;
      let sized = false;
      const abort = new AbortController();
      // The noise floor, learnt as it goes: speech is well above it.
      let floor = 300;
      const finals: Growing[] = [];
      // This start's programs not yet exited (a rest's earlier one may still be going), and whether a stop was told.
      let running = 0;
      let toldExited = false;
      const tellExited = (): void => {
        if (!stopped || running > 0 || toldExited) return;
        toldExited = true;
        o.onExited?.();
      };

      const end = (): void => {
        closeSound?.();
        closeSound = null;
        if (retrySound) clearTimeout(retrySound);
        retrySound = null;
        phrase = null;
        finals.length = 0;
        const was = child;
        child = null;
        if (was?.exitCode === null) was.kill();
      };

      /** Send one clip; null when the engine said nothing usable or the piece was dropped. */
      const ask = async (samples: Int16Array): Promise<{ reply: Reply; tookMs: number } | null> => {
        const form = new FormData();
        form.append('file', new Blob([wavOf(samples)], { type: 'audio/wav' }), 'clip.wav');
        form.append('response_format', 'verbose_json');
        form.append('temperature', '0');
        if (!allowFallback) form.append('temperature_inc', '0');
        if (!withTimestamps) form.append('no_timestamps', 'true');
        form.append('language', language);
        // The decode already reports its language. Asking for probabilities runs detection again.
        form.append('no_language_probabilities', 'true');
        // The admin's caption words, as whisper.cpp's initial prompt (about 220 tokens at most): none, none sent.
        const prompt = o.hints?.for(language).prompt ?? '';
        if (prompt !== '') form.append('prompt', prompt);
        // QWC-1: the audio context sized to the piece, after every field today sends.
        if (sized) form.append('audio_ctx', String(audioContextFor(samples.length)));
        const began = Date.now();
        const response = await get(`${address}/inference`, {
          method: 'POST',
          body: form,
          signal: abort.signal,
          redirect: 'error',
        });
        if (!response.ok) return null;
        const reply = (await response.json()) as Reply;
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

      const hold = (measured: Pick<SlowHold, 'answerMs' | 'behindMs'>): void => {
        if (busy || stopped) return;
        busy = true;
        rests += 1;
        // The one decision (the owner, Q-CT-1: "Say so and stop"): the third rest in a row, nothing heard whole since
        // this start. A computer that has kept up is only busy for a while (a long import, a conversion): it rests and
        // tries again as before, however long the stretch.
        // Kept up: a phrase heard whole in this start, or shown since the operator turned captions on (MUST-1b).
        const keptUp = heardWhole || (o.keptUp?.() ?? false);
        const stops = rests >= CAPTIONS_STOP_AFTER_RESTS && !keptUp;
        const slow: SlowHold = { ...measured, threads, processors, rests, keptUp, stops };
        // Numbers only (cap-threads): what it measured, so a log from a slow computer says why.
        o.log.warn(
          `Speech: the computer cannot keep up, so captions rest for a minute (the show comes first): an answer took ${String(slow.answerMs)} ms, ${String(slow.behindMs)} ms behind, ${String(threads)} threads, ${String(processors)} logical processors, rest ${String(rests)} in a row.`,
        );
        to.state({ phase: 'held', reason: 'busy', slow });
        end();
        // After three rests in a row, never having kept up, it stops trying; captions turn off with the reason
        // (captions-service.ts follows slow.stops).
        if (stops) {
          o.log.warn(`Speech: ${String(rests)} rests in a row, so the captions engine stops trying.`);
          return;
        }
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
        working = true;
        piece.sentAt = Date.now();
        const samples = joined(piece);
        // Freeze the clock with the submitted samples: more microphone chunks can arrive during inference.
        const captured = piece.captured.slice();
        const clipAt = piece.startAt;
        const clipEndAt = piece.endAt;
        try {
          const asked = await ask(samples);
          if (!asked || ended()) return;
          const behind = Date.now() - clipEndAt;
          slowInARow = asked.tookMs > stepMs * 1.5 ? slowInARow + 1 : 0;
          if (slowInARow >= 3 || behind > 8_000) {
            hold({ answerMs: asked.tookMs, behindMs: behind });
            return;
          }
          const heardIn = language === 'auto' ? writtenIn(asked.reply) : language;
          if (heardIn === null) return;
          const words = wordsOf(
            asked.reply,
            clipAt,
            clipEndAt,
            (seconds, beginning) => capturedAt(captured, seconds, beginning),
            !withTimestamps,
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
          // A phrase heard whole: the next rest, if one comes, is the first again, and this start has kept up.
          if (heard.final) {
            rests = 0;
            heardWhole = true;
          }
        } catch {
          // Stopped (aborted), or the engine went away: its exit says so.
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
          !samples.length ||
          !Number.isFinite(capturedStart) ||
          !Number.isFinite(endAt) ||
          capturedStart > endAt
        )
          return;
        let sum = 0;
        for (const s of samples) sum += s * s;
        const level = Math.sqrt(sum / Math.max(1, samples.length));
        const speech = isSpeech(level, floor, speechLevel);
        if (!speech) floor = floor * 0.95 + level * 0.05;
        if (!phrase) {
          if (!speech) return;
          count += 1;
          phrase = {
            id: `s${String(count)}`,
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
        if (phrase.quietMs >= pauseMs || endAt - phrase.startAt >= maxMs) {
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
        const program = o.program();
        if (!program) {
          to.state({ phase: 'failed', message: 'This copy of Drashti has no captions engine.' });
          return;
        }
        const problem = o.modelProblem?.(language) ?? null;
        if (problem !== null) {
          to.state({ phase: 'failed', message: problem });
          return;
        }
        to.state({ phase: 'starting' });
        const port = await freePort().catch(() => 0);
        if (stopped) return;
        if (!port) {
          to.state({
            phase: 'failed',
            message:
              'The captions engine could not open a local connection: turn captions off and on to try again.',
          });
          return;
        }
        // Both engines require this private path for their handlers. Each child gets a fresh one.
        const requestPath = `/${randomBytes(16).toString('hex')}`;
        address = `http://127.0.0.1:${String(port)}${requestPath}`;
        const args = [
          '-m',
          o.model(language),
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--request-path',
          requestPath,
          '-t',
          String(threads),
        ];
        o.log.info(
          `Speech: the captions engine’s threads: ${String(threads)} (logical processors here: ${String(processors)}).`,
        );
        // The Windows server has an optional public files directory. Drashti serves no files.
        if (process.platform === 'win32') args.push('--public', '');
        sized = o.sizedContext?.(language) ?? false;
        // A sized context goes with the fallback off (measured so: the words the same, the answers steadier).
        allowFallback = sized ? false : o.fallback(language);
        withTimestamps = o.timestamps?.(language) ?? true;
        const started = run(program, args);
        child = started;
        running += 1;
        let gone = false;
        const exited = (): void => {
          if (gone) return;
          gone = true;
          running -= 1;
          tellExited();
        };
        started.once('exit', exited);
        // A program that never started has no exit to come.
        started.once('error', () => {
          if (started.pid === undefined) exited();
        });
        started.once('exit', (code) => {
          if (child !== started || stopped) return;
          child = null;
          o.log.warn(`Speech: the captions engine stopped (exit ${String(code)}).`);
          end();
          to.state({
            phase: 'failed',
            message:
              whisperDependencyProblem(process.platform, code) ??
              'The captions engine stopped. Turn captions off and on to try again.',
          });
        });
        started.once('error', () => {
          if (child !== started || stopped) return;
          child = null;
          to.state({
            phase: 'failed',
            message: 'The captions engine could not start: turn captions off and on to try again.',
          });
        });
        // Below the show (the main process and the screens): Windows' below normal, a Mac's nice 10.
        try {
          if (started.pid !== undefined) setPriority(started.pid, constants.priority.PRIORITY_BELOW_NORMAL);
        } catch {
          o.log.warn('Speech: the captions engine could not be put below the show’s priority.');
        }
        const deadline = Date.now() + readyMs;
        while (!ended() && child === started && Date.now() < deadline) {
          try {
            const health = await get(`${address}/health`, { signal: abort.signal, redirect: 'error' });
            if (health.ok && !ended() && child === started) {
              o.log.info(`Speech: the captions engine is ready (pid ${String(started.pid)}).`);
              openSound();
              return;
            }
          } catch {
            // Not listening yet.
          }
          await new Promise((wait) => setTimeout(wait, 250));
        }
        if (!ended() && child === started) {
          end();
          to.state({
            phase: 'failed',
            message: 'The captions engine did not start in time: turn captions off and on to try again.',
          });
        }
      };

      void begin();
      return () => {
        stopped = true;
        abort.abort();
        if (rest) clearTimeout(rest);
        rest = null;
        end();
        tellExited();
      };
    },
  };
}
