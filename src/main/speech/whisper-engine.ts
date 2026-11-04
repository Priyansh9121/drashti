import { spawn as spawnChild, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { constants, setPriority } from 'node:os';
import { SPEECH_LANGUAGES, type Heard, type HeardWord, type SpeechLanguage } from '../../shared/speech';
import type { SpeechEngine } from './hub';

/*
 * The captions engine (Session 55, Part 10): whisper.cpp's server (whisper-server.exe on Windows, from whisper.cpp's
 * own release; on a Mac our small program on whisper.cpp's prebuilt library, which answers the same way), a separate
 * program on 127.0.0.1 that keeps the model loaded. It runs below the show's priority. The stream's sound input comes
 * in as 16 kHz mono samples; a pause cuts it into phrases, each sent as it grows (partials) and once whole (final).
 * If the computer cannot keep up (each piece takes too long, or it falls more than a few seconds behind) it stops by
 * itself (held, busy) and tries again a minute later: the show comes first. It never logs a word, and the program's
 * own output is never read.
 */

export const SAMPLE_RATE = 16_000;

/** The stream's sound input, 16 kHz mono 16-bit, each chunk with when its last sample was heard (epoch ms). */
export interface PcmSource {
  /** Start; null when there is no sound input. Returns how to stop. */
  open(chunk: (samples: Int16Array, endAt: number) => void): (() => void) | null;
}

export interface WhisperEngineOptions {
  /** The engine program, or null when this copy of Drashti has none. */
  program: () => string | null;
  model: () => string;
  /** Whether a failed piece is tried again warmer (whisper's fallback): off for the large model, which then loops less. */
  fallback: () => boolean;
  sound: PcmSource;
  log: { info(message: string): void; warn(message: string): void };
  threads?: number;
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
}

const LANGUAGE_NAMES: Readonly<Record<string, SpeechLanguage>> = {
  gujarati: 'gu',
  hindi: 'hi',
  english: 'en',
};

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
  language_probabilities?: Record<string, number>;
  segments?: { words?: Token[]; no_speech_prob?: number }[];
}

/** What the engine heard in a clip that began at `clipAt` (epoch ms): its words, in order, never empty. */
export function wordsOf(reply: Reply, clipAt: number, clipEndAt: number): HeardWord[] {
  const words: { text: string; start: number; end: number; p: number[] }[] = [];
  for (const segment of reply.segments ?? []) {
    // Silence the engine still wrote something for.
    if ((segment.no_speech_prob ?? 0) > 0.6) continue;
    for (const token of segment.words ?? []) {
      const text = token.word;
      if (text.trim() === '') continue;
      const start = clipAt + (token.start ?? 0) * 1000;
      const end = clipAt + (token.end ?? token.start ?? 0) * 1000;
      const last = words.at(-1);
      // A token without a space before it belongs to the word before it (a letter's second part, punctuation).
      if (last && !/^\s/.test(text)) {
        last.text += text;
        last.end = Math.max(last.end, end);
        last.p.push(token.probability ?? 1);
      } else words.push({ text: text.trim(), start, end, p: [token.probability ?? 1] });
    }
  }
  const out: HeardWord[] = [];
  let lastStart = clipAt;
  let lastEnd = clipAt;
  for (const w of words) {
    const text = w.text.trim().normalize('NFC');
    // The engine's notes, not words: [BLANK_AUDIO], (music), ♪…
    if (text === '' || /^[[(*♪].*[\])*♪]$/u.test(text) || text.includes('�')) continue;
    const startAt = Math.min(clipEndAt, Math.max(lastStart, w.start));
    const endAt = Math.min(clipEndAt, Math.max(startAt, lastEnd, w.end));
    const confidence = w.p.reduce((a, b) => a + b, 0) / w.p.length;
    out.push({ text, startAt, endAt, confidence: Math.min(1, Math.max(0, confidence)) });
    lastStart = startAt;
    lastEnd = endAt;
  }
  return out;
}

/** The language among Gujarati, Hindi and English the engine finds likeliest, and how likely. */
export function likeliest(reply: Reply): { language: SpeechLanguage; p: number } | null {
  const probabilities = reply.language_probabilities;
  if (!probabilities) return null;
  let best: { language: SpeechLanguage; p: number } | null = null;
  for (const language of SPEECH_LANGUAGES) {
    const p = probabilities[language] ?? 0;
    if (!best || p > best.p) best = { language, p };
  }
  return best && best.p > 0 ? best : null;
}

/** The language the engine wrote the words in, if it is one of the three. */
export function writtenIn(reply: Reply): SpeechLanguage | null {
  return LANGUAGE_NAMES[(reply.language ?? '').toLowerCase()] ?? null;
}

/** A phrase being heard: its samples, from its start, and when its first sample was heard. */
interface Growing {
  id: string;
  samples: Int16Array[];
  length: number;
  startAt: number;
  endAt: number;
  quietMs: number;
  sentAt: number;
}

export function createWhisperEngine(o: WhisperEngineOptions): SpeechEngine {
  const stepMs = o.stepMs ?? 1_500;
  const pauseMs = o.pauseMs ?? 700;
  const maxMs = o.maxMs ?? 12_000;
  const restMs = o.restMs ?? 60_000;
  const readyMs = o.readyMs ?? 90_000;
  const get = o.fetch ?? fetch;
  const run =
    o.spawn ?? ((program, args) => spawnChild(program, args, { stdio: 'ignore', windowsHide: true }));

  return {
    start(language, to) {
      let stopped = false;
      let child: ChildProcess | null = null;
      let closeSound: (() => void) | null = null;
      let port = 0;
      let busy = false;
      let slowInARow = 0;
      let phrase: Growing | null = null;
      let count = 0;
      let rest: NodeJS.Timeout | null = null;
      let retrySound: NodeJS.Timeout | null = null;
      const abort = new AbortController();
      // The noise floor, learnt as it goes: speech is well above it.
      let floor = 300;
      const finals: Growing[] = [];

      const end = (): void => {
        closeSound?.();
        closeSound = null;
        if (retrySound) clearTimeout(retrySound);
        retrySound = null;
        phrase = null;
        finals.length = 0;
        const was = child;
        child = null;
        if (was && was.exitCode === null) was.kill();
      };

      /** Send one clip; null when the engine said nothing usable or the piece was dropped. */
      const ask = async (
        samples: Int16Array,
        forced: SpeechLanguage | null,
      ): Promise<{ reply: Reply; tookMs: number } | null> => {
        const form = new FormData();
        form.append('file', new Blob([wavOf(samples)], { type: 'audio/wav' }), 'clip.wav');
        form.append('response_format', 'verbose_json');
        form.append('temperature', '0');
        if (!o.fallback()) form.append('temperature_inc', '0');
        const lang = forced ?? (language === 'auto' ? 'auto' : language);
        form.append('language', lang);
        form.append('no_language_probabilities', lang === 'auto' ? 'false' : 'true');
        const began = Date.now();
        const response = await get(`http://127.0.0.1:${String(port)}/inference`, {
          method: 'POST',
          body: form,
          signal: abort.signal,
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
        working = true;
        piece.sentAt = Date.now();
        const samples = joined(piece);
        const clipAt = piece.startAt;
        const clipEndAt = piece.endAt;
        try {
          let asked = await ask(samples, null);
          if (!asked || stopped) return;
          let heardIn = language === 'auto' ? writtenIn(asked.reply) : language;
          const guess = language === 'auto' ? likeliest(asked.reply) : null;
          if (language === 'auto' && heardIn === null) {
            // Written in a fourth language: a whole phrase is heard again in the likeliest of the three.
            if (!final || !guess) return;
            asked = await ask(samples, guess.language);
            if (!asked || stopped) return;
            heardIn = guess.language;
          }
          const behind = Date.now() - clipEndAt;
          slowInARow = asked.tookMs > stepMs * 1.5 ? slowInARow + 1 : 0;
          if (slowInARow >= 3 || behind > 8_000) {
            hold();
            return;
          }
          const words = wordsOf(asked.reply, clipAt, clipEndAt);
          if (final && words.length === 0) return;
          const heard: Heard = {
            id: piece.id,
            final: final !== undefined,
            language: heardIn ?? 'en',
            languageConfidence: language === 'auto' ? (guess?.p ?? null) : null,
            words,
            text: words.map((w) => w.text).join(' '),
            startAt: Math.min(clipAt, words[0]?.startAt ?? clipAt),
            endAt: Math.max(words.at(-1)?.endAt ?? clipAt, clipAt),
            heardAt: Date.now(),
          };
          to.heard(heard);
        } catch {
          // Stopped (aborted), or the engine went away: its exit says so.
        } finally {
          working = false;
          if (!stopped) setImmediate(() => void pump());
        }
      };

      const chunk = (samples: Int16Array, endAt: number): void => {
        if (stopped || busy) return;
        const ms = (samples.length / SAMPLE_RATE) * 1000;
        let sum = 0;
        for (const s of samples) sum += s * s;
        const level = Math.sqrt(sum / Math.max(1, samples.length));
        const speech = level > Math.max(400, floor * 3);
        if (!speech) floor = floor * 0.95 + level * 0.05;
        if (!phrase) {
          if (!speech) return;
          count += 1;
          phrase = {
            id: `s${String(count)}`,
            samples: [],
            length: 0,
            startAt: endAt - ms,
            endAt,
            quietMs: 0,
            sentAt: Date.now(),
          };
        }
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
        to.state({ phase: 'starting' });
        port = await freePort();
        if (stopped) return;
        const args = [
          '-m',
          o.model(),
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '-t',
          String(o.threads ?? 4),
        ];
        const started = run(program, args);
        child = started;
        started.once('exit', (code) => {
          if (child !== started || stopped) return;
          child = null;
          o.log.warn(`Speech: the captions engine stopped (exit ${String(code)}).`);
          end();
          to.state({
            phase: 'failed',
            message: 'The captions engine stopped. Turn captions off and on to try again.',
          });
        });
        started.once('error', () => {
          if (child !== started || stopped) return;
          child = null;
          to.state({ phase: 'failed', message: 'The captions engine could not start.' });
        });
        // Below the show (the main process and the screens): Windows' below normal, a Mac's nice 10.
        try {
          if (started.pid !== undefined) setPriority(started.pid, constants.priority.PRIORITY_BELOW_NORMAL);
        } catch {
          o.log.warn('Speech: the captions engine could not be put below the show’s priority.');
        }
        const deadline = Date.now() + readyMs;
        while (!stopped && child === started && Date.now() < deadline) {
          try {
            const health = await get(`http://127.0.0.1:${String(port)}/health`, { signal: abort.signal });
            if (health.ok) {
              o.log.info(`Speech: the captions engine is ready (pid ${String(started.pid)}).`);
              openSound();
              return;
            }
          } catch {
            // Not listening yet.
          }
          await new Promise((wait) => setTimeout(wait, 250));
        }
        if (!stopped && child === started) {
          end();
          to.state({ phase: 'failed', message: 'The captions engine did not start in time.' });
        }
      };

      void begin();
      return () => {
        stopped = true;
        abort.abort();
        if (rest) clearTimeout(rest);
        rest = null;
        end();
      };
    },
  };
}
