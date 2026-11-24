import { describe, expect, it, vi } from 'vitest';
import type { Heard, SpeechState } from '../../shared/speech';
import { createIndicEngine } from './indic-engine';

describe('Route C behind the speech engine seam', () => {
  it('needs an explicit language and a held imported model, without starting Whisper or sound', () => {
    const acquire = vi.fn(() => null),
      open = vi.fn(() => null);
    const state = vi.fn();
    const engine = createIndicEngine({
      workGate: { allowed: () => true, listen: () => () => undefined },
      program: () => '/native',
      acquire,
      sound: { open },
      log: { info: () => undefined, warn: () => undefined },
    });
    const stop = engine.start('auto', { heard: () => undefined, state });
    expect(acquire).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'failed' }));
    stop();
  });
  it('keeps capture times and null confidence and releases the pack on stop', async () => {
    let chunk: ((samples: Int16Array, endAt: number, startAt?: number) => void) | undefined;
    const release = vi.fn(),
      close = vi.fn();
    const states: SpeechState[] = [],
      phrases: Heard[] = [];
    const engine = createIndicEngine({
      workGate: { allowed: () => true, listen: () => () => undefined },
      program: () => '/native',
      acquire: () => ({
        files: { model: '/pack/model.onnx', tokens: '/pack/tokens.txt', frontend: '/pack/frontend.bin' },
        release,
      }),
      sound: {
        open: (to) => {
          chunk = to;
          return () => undefined;
        },
      },
      log: { info: () => undefined, warn: () => undefined },
      open: () =>
        Promise.resolve({
          decode: () => Promise.resolve({ language: 'gu', words: [{ w: 'આકાર', start: 0, end: 0.08 }] }),
          close,
        }),
    });
    const stop = engine.start('gu', { heard: (h) => phrases.push(h), state: (s) => states.push(s) });
    await vi.waitFor(() => expect(states.at(-1)?.phase).toBe('listening'));
    const began = Date.now() - 800;
    chunk?.(new Int16Array(1600).fill(5000), began + 100, began);
    for (let i = 1; i <= 7; i += 1) chunk?.(new Int16Array(1600), began + (i + 1) * 100, began + i * 100);
    await vi.waitFor(() => expect(phrases).toHaveLength(1));
    expect(phrases[0]).toMatchObject({
      final: true,
      language: 'gu',
      startAt: began,
      endAt: began + 80,
      words: [{ text: 'આકાર', confidence: null }],
    });
    stop();
    expect(close).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
  it('shows nothing Route C made of noise or hum (one-syllable words heard unsure); a clear short answer, and any phrase without the helper’s confidence, comes through', async () => {
    let chunk: ((samples: Int16Array, endAt: number, startAt?: number) => void) | undefined;
    const states: SpeechState[] = [],
      phrases: Heard[] = [];
    const word = (w: string, c: number | null, start = 0) => ({ w, start, end: start + 0.04, c });
    const decode = vi
      .fn()
      .mockResolvedValueOnce({ language: 'gu', words: [word('હ', 0.1), word('છે', 0.1, 0.04)] })
      .mockResolvedValueOnce({ language: 'gu', words: [word('હા', 0.95)] })
      .mockResolvedValue({ language: 'gu', words: [word('હ', null), word('છે', null, 0.04)] });
    const engine = createIndicEngine({
      workGate: { allowed: () => true, listen: () => () => undefined },
      program: () => '/native',
      acquire: () => ({
        files: { model: '/pack/model.onnx', tokens: '/pack/tokens.txt', frontend: '/pack/frontend.bin' },
        release: () => undefined,
      }),
      sound: {
        open: (to) => {
          chunk = to;
          return () => undefined;
        },
      },
      log: { info: () => undefined, warn: () => undefined },
      open: () => Promise.resolve({ decode, close: () => undefined }),
    });
    const stop = engine.start('gu', { heard: (h) => phrases.push(h), state: (s) => states.push(s) });
    await vi.waitFor(() => expect(states.at(-1)?.phase).toBe('listening'));
    // Three short phrases, each a sound then a pause: hum heard unsure, a clear "yes", hum with no confidence given.
    const began = Date.now() - 2_400;
    for (const at of [began, began + 800, began + 1_600]) {
      chunk?.(new Int16Array(1600).fill(5000), at + 100, at);
      for (let i = 1; i <= 7; i += 1) chunk?.(new Int16Array(1600), at + (i + 1) * 100, at + i * 100);
    }
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(phrases.filter((h) => h.final)).toHaveLength(2));
    expect(phrases.filter((h) => h.words.length > 0).map((h) => h.text)).toEqual(['હા', 'હ છે']);
    // The helper's confidence decides what is shown; the phrase's words still carry none (as before).
    expect(phrases.flatMap((h) => h.words.map((w) => w.confidence))).toEqual([null, null, null]);
    stop();
  });
  it('follows the dialog’s live timing, read once at each start: step, pause, longest phrase and speech level (alpha.23, the review); two threads still', async () => {
    let chunk: ((samples: Int16Array, endAt: number, startAt?: number) => void) | undefined;
    const states: SpeechState[] = [],
      phrases: Heard[] = [];
    const threads: (number | undefined)[] = [];
    const timing = vi.fn(() => ({
      stepMs: 1_000 as const,
      pauseMs: 500 as const,
      longestMs: 6_000 as const,
      speech: 'quiet-room' as const,
      threads: 4 as const,
    }));
    const engine = createIndicEngine({
      workGate: { allowed: () => true, listen: () => () => undefined },
      program: () => '/native',
      acquire: () => ({
        files: { model: '/pack/model.onnx', tokens: '/pack/tokens.txt', frontend: '/pack/frontend.bin' },
        release: () => undefined,
      }),
      sound: {
        open: (to) => {
          chunk = to;
          return () => undefined;
        },
      },
      log: { info: () => undefined, warn: () => undefined },
      threads: 2,
      timing,
      open: (options) => {
        threads.push(options.threads);
        return Promise.resolve({
          decode: () => Promise.resolve({ language: 'gu', words: [{ w: 'આકાર', start: 0, end: 0.08 }] }),
          close: () => undefined,
        });
      },
    });
    const stop = engine.start('gu', { heard: (h) => phrases.push(h), state: (s) => states.push(s) });
    await vi.waitFor(() => expect(states.at(-1)?.phase).toBe('listening'));
    expect(timing).toHaveBeenCalledOnce();
    expect(threads).toEqual([2]);
    const finals = () => phrases.filter((h) => h.final);
    // Softer speech (a quiet room hears it; standard would not), then a 500 ms pause: one whole phrase.
    let at = Date.now() - 600;
    chunk?.(new Int16Array(1600).fill(700), at + 100, at);
    for (let i = 1; i <= 5; i += 1) chunk?.(new Int16Array(1600), at + (i + 1) * 100, at + i * 100);
    await vi.waitFor(() => expect(finals()).toHaveLength(1));
    // Speech without a pause ends a phrase at the longest, 6 s.
    at = Date.now() - 6_000;
    for (let i = 0; i < 60; i += 1)
      chunk?.(new Int16Array(1600).fill(5000), at + (i + 1) * 100, at + i * 100);
    await vi.waitFor(() => expect(finals()).toHaveLength(2));
    stop();
  });
});
