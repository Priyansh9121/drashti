import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { Heard, SpeechState } from '../../shared/speech';
import {
  createWhisperEngine,
  likeliest,
  SAMPLE_RATE,
  wavOf,
  wordsOf,
  writtenIn,
  type PcmSource,
} from './whisper-engine';

/*
 * The captions engine's side of whisper.cpp's server (Part 10). The "server" here is a stand-in on 127.0.0.1 that
 * answers as whisper-server does, with placeholder words; the "sound" is tone bursts (not speech), which only cut
 * phrases. No program runs and nothing is downloaded.
 */

describe('what the engine heard (whisper-server’s verbose_json)', () => {
  it('joins tokens into words, keeps the engine’s punctuation, and drops its notes and silence', () => {
    const reply = {
      language: 'english',
      segments: [
        {
          no_speech_prob: 0.01,
          words: [
            { word: ' Al', start: 0.1, end: 0.2, probability: 0.8 },
            { word: 'pha', start: 0.2, end: 0.4, probability: 0.6 },
            { word: ',', start: 0.4, end: 0.45, probability: 0.9 },
            { word: ' [BLANK_AUDIO]', start: 0.5, end: 0.6, probability: 0.9 },
            { word: ' beta', start: 0.7, end: 0.9, probability: 0.9 },
          ],
        },
        { no_speech_prob: 0.9, words: [{ word: ' ghost', start: 1, end: 1.2, probability: 0.2 }] },
      ],
    };
    const words = wordsOf(reply, 10_000, 12_000);
    expect(words.map((w) => w.text)).toEqual(['Alpha,', 'beta']);
    expect(words[0]).toMatchObject({ startAt: 10_100, endAt: 10_450 });
    expect(words[0]?.confidence).toBeCloseTo((0.8 + 0.6 + 0.9) / 3);
    expect(words[1]).toMatchObject({ startAt: 10_700, endAt: 10_900 });
  });

  it('keeps times inside the clip and never running backwards; letters as NFC', () => {
    const reply = {
      segments: [
        {
          words: [
            { word: ' café', start: 0.5, end: 0.4 },
            { word: ' zeta', start: 0.3, end: 9 },
          ],
        },
      ],
    };
    const words = wordsOf(reply, 0, 2_000);
    expect(words.map((w) => w.text)).toEqual(['café', 'zeta']);
    expect(words[0]).toMatchObject({ startAt: 500, endAt: 500 });
    expect(words[1]).toMatchObject({ startAt: 500, endAt: 2_000 });
  });

  it('finds the likeliest of Gujarati, Hindi and English, and the language it wrote in', () => {
    expect(likeliest({ language_probabilities: { mr: 0.5, hi: 0.3, gu: 0.1, en: 0.05 } })).toEqual({
      language: 'hi',
      p: 0.3,
    });
    expect(likeliest({})).toBeNull();
    expect(writtenIn({ language: 'gujarati' })).toBe('gu');
    expect(writtenIn({ language: 'marathi' })).toBeNull();
  });

  it('makes a 16 kHz mono 16-bit WAV', () => {
    const wav = wavOf(new Int16Array([1, -1, 300]));
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getInt16(48, true)).toBe(300);
    expect(wav.length).toBe(44 + 6);
  });
});

/** A stand-in for whisper-server: /health, and /inference answering with placeholder words after `delayMs`. */
function standIn(o: { delayMs?: number; language?: string } = {}) {
  const servers: Server[] = [];
  const asked: string[] = [];
  const spawn = (_program: string, args: string[]): ChildProcess => {
    const port = Number(args[args.indexOf('--port') + 1]);
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    Object.assign(child, { pid: undefined, exitCode: null });
    const server = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
        return;
      }
      let body = '';
      req.setEncoding('latin1');
      req.on('data', (part: string) => (body += part));
      req.on('end', () => {
        const language = /name="language"\r\n\r\n([a-z]+)/.exec(body)?.[1] ?? '?';
        asked.push(language);
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(
            JSON.stringify({
              language: o.language ?? 'english',
              language_probabilities: { en: 0.9, hi: 0.05 },
              segments: [
                {
                  no_speech_prob: 0,
                  words: [
                    { word: ' alpha', start: 0.0, end: 0.3, probability: 0.9 },
                    { word: ' beta', start: 0.4, end: 0.7, probability: 0.9 },
                  ],
                },
              ],
            }),
          );
        }, o.delayMs ?? 0);
      });
    });
    server.listen(port, '127.0.0.1');
    servers.push(server);
    child.kill = () => {
      server.close();
      (child as { exitCode: number | null }).exitCode = 0;
      child.emit('exit', 0);
      return true;
    };
    return child;
  };
  return { spawn, asked, close: () => servers.forEach((s) => s.close()) };
}

/** Sound: a burst of tone (`ms` long) then quiet, as 100 ms chunks timed on the real clock. */
function bursts(): PcmSource & { play(loudMs: number, quietMs: number): Promise<void>; opened: number } {
  let to: ((samples: Int16Array, endAt: number) => void) | null = null;
  const source = {
    opened: 0,
    open(chunk: (samples: Int16Array, endAt: number) => void) {
      source.opened += 1;
      to = chunk;
      return () => {
        to = null;
      };
    },
    async play(loudMs: number, quietMs: number) {
      for (let t = 0; t < loudMs + quietMs; t += 100) {
        const samples = new Int16Array(SAMPLE_RATE / 10);
        if (t < loudMs)
          for (let i = 0; i < samples.length; i += 1) samples[i] = Math.round(3000 * Math.sin(i / 3));
        to?.(samples, Date.now());
        await new Promise((wait) => setTimeout(wait, 100));
      }
    },
  };
  return source;
}

const waitFor = async (check: () => boolean, ms = 5_000): Promise<void> => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((wait) => setTimeout(wait, 20));
  }
};

let stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
});

describe('the captions engine (Part 10)', () => {
  it('starts the engine, waits until it is ready, then hears a phrase as partials and once whole', async () => {
    const server = standIn();
    const sound = bursts();
    const heard: Heard[] = [];
    const states: SpeechState[] = [];
    let decoderReads = 0;
    const engine = createWhisperEngine({
      program: () => '/placeholder/whisper-server',
      model: () => '/placeholder/model.bin',
      fallback: () => {
        decoderReads += 1;
        return true;
      },
      sound,
      log: { info: () => undefined, warn: () => undefined },
      spawn: server.spawn,
      stepMs: 300,
      pauseMs: 300,
    });
    stops.push(
      engine.start('en', { heard: (h) => heard.push(h), state: (s) => states.push(s) }),
      server.close,
    );
    await waitFor(() => states.some((s) => s.phase === 'listening'));
    expect(states[0]).toEqual({ phase: 'starting' });
    await sound.play(1_600, 600);
    await waitFor(() => heard.some((h) => h.final));
    const finals = heard.filter((h) => h.final);
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({
      id: 's1',
      language: 'en',
      text: 'alpha beta',
      languageConfidence: null,
    });
    // Partials first, with the same id, then the final last.
    expect(heard.at(-1)?.final).toBe(true);
    expect(heard.every((h) => h.id === 's1')).toBe(true);
    expect(server.asked.every((l) => l === 'en')).toBe(true);
    // Its times are this computer's clock, in order.
    const f = finals[0];
    expect(f && f.endAt >= f.startAt && f.heardAt >= f.endAt).toBe(true);
    // Decoder settings belong to the loaded model. Do not query them on the audio hot path.
    expect(server.asked.length).toBeGreaterThan(1);
    expect(decoderReads).toBe(1);
  });

  it('with the language left to it, says which of the three it heard, and how sure', async () => {
    const server = standIn();
    const sound = bursts();
    const heard: Heard[] = [];
    const engine = createWhisperEngine({
      program: () => '/placeholder/whisper-server',
      model: () => '/placeholder/model.bin',
      fallback: () => true,
      sound,
      log: { info: () => undefined, warn: () => undefined },
      spawn: server.spawn,
      stepMs: 300,
      pauseMs: 300,
    });
    const states: SpeechState[] = [];
    stops.push(
      engine.start('auto', { heard: (h) => heard.push(h), state: (s) => states.push(s) }),
      server.close,
    );
    await waitFor(() => states.some((s) => s.phase === 'listening'));
    await sound.play(1_200, 500);
    await waitFor(() => heard.some((h) => h.final));
    expect(heard.find((h) => h.final)).toMatchObject({ language: 'en', languageConfidence: 0.9 });
    expect(server.asked[0]).toBe('auto');
  });

  it('rests by itself when the computer cannot keep up (the show comes first), then tries again', async () => {
    const server = standIn({ delayMs: 700 });
    const sound = bursts();
    const states: SpeechState[] = [];
    const warnings: string[] = [];
    const engine = createWhisperEngine({
      program: () => '/placeholder/whisper-server',
      model: () => '/placeholder/model.bin',
      fallback: () => true,
      sound,
      log: { info: () => undefined, warn: (m) => warnings.push(m) },
      spawn: server.spawn,
      stepMs: 200,
      pauseMs: 2_000,
      restMs: 500,
    });
    stops.push(engine.start('en', { heard: () => undefined, state: (s) => states.push(s) }), server.close);
    await waitFor(() => states.some((s) => s.phase === 'listening'));
    void sound.play(6_000, 0);
    await waitFor(() => states.some((s) => s.phase === 'held'), 8_000);
    expect(states.find((s) => s.phase === 'held')).toEqual({ phase: 'held', reason: 'busy' });
    expect(warnings.join('\n')).toMatch(/cannot keep up/);
    // A rest later it starts again by itself.
    await waitFor(() => states.filter((s) => s.phase === 'listening').length >= 2, 8_000);
  }, 20_000);

  it('is held with no sound input, and fails plainly with no engine program', async () => {
    const server = standIn();
    const states: SpeechState[] = [];
    const engine = createWhisperEngine({
      program: () => '/placeholder/whisper-server',
      model: () => '/placeholder/model.bin',
      fallback: () => true,
      sound: { open: () => null },
      log: { info: () => undefined, warn: () => undefined },
      spawn: server.spawn,
    });
    stops.push(engine.start('en', { heard: () => undefined, state: (s) => states.push(s) }), server.close);
    await waitFor(() => states.some((s) => s.phase === 'held'));
    expect(states.at(-1)).toEqual({ phase: 'held', reason: 'no-sound-input' });
    const none: SpeechState[] = [];
    const missing = createWhisperEngine({
      program: () => null,
      model: () => '/placeholder/model.bin',
      fallback: () => true,
      sound: { open: () => null },
      log: { info: () => undefined, warn: () => undefined },
    });
    stops.push(missing.start('en', { heard: () => undefined, state: (s) => none.push(s) }));
    await waitFor(() => none.length > 0);
    expect(none[0]).toEqual({ phase: 'failed', message: 'This copy of Drashti has no captions engine.' });
  });
});
