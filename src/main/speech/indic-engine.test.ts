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
  it('shows nothing Route C made of noise or hum (every word one syllable); speech after it comes through', async () => {
    let chunk: ((samples: Int16Array, endAt: number, startAt?: number) => void) | undefined;
    const states: SpeechState[] = [],
      phrases: Heard[] = [];
    const decode = vi
      .fn()
      .mockResolvedValueOnce({
        language: 'gu',
        words: [
          { w: 'હ', start: 0, end: 0.04 },
          { w: 'છે', start: 0.04, end: 0.08 },
        ],
      })
      .mockResolvedValue({ language: 'gu', words: [{ w: 'આકાર', start: 0, end: 0.08 }] });
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
    // Two short phrases, each a sound then a pause: the first decodes as hum, the second as a word.
    const began = Date.now() - 1_600;
    for (const at of [began, began + 800]) {
      chunk?.(new Int16Array(1600).fill(5000), at + 100, at);
      for (let i = 1; i <= 7; i += 1) chunk?.(new Int16Array(1600), at + (i + 1) * 100, at + i * 100);
    }
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(phrases.filter((h) => h.final)).toHaveLength(1));
    expect(phrases.filter((h) => h.words.length > 0).map((h) => h.text)).toEqual(['આકાર']);
    stop();
  });
});
