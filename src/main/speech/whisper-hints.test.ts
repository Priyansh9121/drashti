import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import type { SpeechLanguage, SpeechState } from '../../shared/speech';
import type { CaptionHints } from './caption-hints';
import { createWhisperEngine, SAMPLE_RATE, type PcmSource } from './whisper-engine';

/*
 * The captions engine is given the admin's caption words as whisper.cpp's prompt (alpha.22): only when there are
 * some for the language it is asked for. No program runs: a stand-in child and a stand-in fetch answer as
 * whisper-server does, with placeholder words; the "sound" is a tone burst, which only cuts a phrase.
 */

function engineWith(hints: CaptionHints | undefined) {
  const prompts: (string | null)[] = [];
  const spawn = (): ChildProcess => {
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    Object.assign(child, { pid: undefined, exitCode: null });
    child.kill = () => {
      (child as { exitCode: number | null }).exitCode = 0;
      return true;
    };
    return child;
  };
  const answer: typeof fetch = (url, options) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (href.endsWith('/health')) return Promise.resolve(new Response('{"status":"ok"}'));
    const body = options?.body;
    let language: unknown = null;
    if (body instanceof FormData) {
      const prompt = body.get('prompt');
      prompts.push(typeof prompt === 'string' ? prompt : null);
      language = body.get('language');
    }
    // A placeholder word in the letters of the language asked (alpha.24: a chosen language's captions keep to them).
    const word = language === 'gu' ? ' આલ્ફા' : language === 'hi' || language === 'sa' ? ' अल्फा' : ' alpha';
    const reply = {
      language: 'english',
      segments: [{ no_speech_prob: 0, words: [{ word, start: 0, end: 0.3, probability: 0.9 }] }],
    };
    return Promise.resolve(new Response(JSON.stringify(reply)));
  };
  let to: ((samples: Int16Array, endAt: number) => void) | null = null;
  const sound: PcmSource = {
    open(chunk) {
      to = chunk;
      return () => {
        to = null;
      };
    },
  };
  const play = async (): Promise<void> => {
    for (let t = 0; t < 1_600; t += 100) {
      const samples = new Int16Array(SAMPLE_RATE / 10);
      if (t < 1_100)
        for (let i = 0; i < samples.length; i += 1) samples[i] = Math.round(3000 * Math.sin(i / 3));
      to?.(samples, Date.now());
      await new Promise((wait) => setTimeout(wait, 100));
    }
  };
  const engine = createWhisperEngine({
    program: () => '/placeholder/whisper-server',
    model: () => '/placeholder/model.bin',
    fallback: () => true,
    sound,
    log: { info: () => undefined, warn: () => undefined },
    spawn,
    fetch: answer,
    stepMs: 300,
    pauseMs: 300,
    hints,
  });
  return { engine, prompts, play };
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

const hintsFor = (prompt: string, asked: (SpeechLanguage | 'auto')[]): CaptionHints => ({
  for: (language) => {
    asked.push(language);
    return { words: prompt === '' ? [] : [prompt], prompt };
  },
  hinted: () => ({ gu: 0, hi: 0, sa: 0, en: 0 }),
});

describe('the captions engine and the caption words', () => {
  it('sends the hints for the language it listens in as the prompt of every piece', async () => {
    const asked: (SpeechLanguage | 'auto')[] = [];
    const { engine, prompts, play } = engineWith(hintsFor('Zentrova, Person Q7', asked));
    const states: SpeechState[] = [];
    let finals = 0;
    stops.push(
      engine.start('en', {
        heard: (h) => {
          if (h.final) finals += 1;
        },
        state: (s) => states.push(s),
      }),
    );
    await waitFor(() => states.some((s) => s.phase === 'listening'));
    await play();
    await waitFor(() => finals > 0);
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.every((p) => p === 'Zentrova, Person Q7')).toBe(true);
    expect(asked.every((l) => l === 'en')).toBe(true);
  });

  it('sends no prompt when there are no hints, or no caption words at all', async () => {
    for (const hints of [hintsFor('', []), undefined]) {
      const { engine, prompts, play } = engineWith(hints);
      const states: SpeechState[] = [];
      let finals = 0;
      const stop = engine.start('gu', {
        heard: (h) => {
          if (h.final) finals += 1;
        },
        state: (s) => states.push(s),
      });
      stops.push(stop);
      await waitFor(() => states.some((s) => s.phase === 'listening'));
      await play();
      await waitFor(() => finals > 0);
      expect(prompts.length).toBeGreaterThan(0);
      expect(prompts.every((p) => p === null)).toBe(true);
      stop();
    }
  });
});
