import { describe, expect, it } from 'vitest';
import {
  indicWords,
  NOISE_CONFIDENCE,
  noiseOnly,
  parseIndicReply,
  pcmFrame,
  routeCFiles,
} from './indic-protocol';

describe('IndicConformer private pipe and checked pack', () => {
  it('frames little-endian PCM without a recording or a path', () => {
    expect([...pcmFrame(new Int16Array([-32768, 1, 32767]))]).toEqual([6, 0, 0, 0, 0, 128, 1, 0, 255, 127]);
    expect(() => pcmFrame(new Int16Array(192001))).toThrow('PCM bounds');
    expect(() => pcmFrame(new Int16Array())).toThrow('PCM bounds');
  });
  it('keeps honest coarse times inside the captured phrase, with no invented confidence', () => {
    expect(
      indicWords({ language: 'gu', words: [{ w: 'આકાર', start: 0.04, end: 9 }] }, 'gu', 1000, 2000),
    ).toEqual([{ text: 'આકાર', startAt: 1040, endAt: 2000, confidence: null }]);
    expect(() => indicWords({ language: 'hi', words: [] }, 'gu', 0, 1000)).toThrow(
      'Invalid recogniser reply',
    );
    expect(() =>
      indicWords({ language: 'gu', words: [{ w: 'x', start: -1, end: 1 }] }, 'gu', 0, 1000),
    ).toThrow('Invalid recogniser reply');
  });
  it('requires all three files from an imported Route C pack of the chosen language', () => {
    const model = {
      format: 'indicconformer-ctc-onnx-v1',
      purposes: ['captions-gu'],
      files: [
        { name: 'captions/gu/model.onnx', path: '/pack/model.onnx' },
        { name: 'captions/gu/tokens.txt', path: '/pack/tokens.txt' },
        { name: 'captions/gu/frontend.bin', path: '/pack/frontend.bin' },
      ],
    };
    expect(routeCFiles(model, 'gu')).toEqual({
      model: '/pack/model.onnx',
      tokens: '/pack/tokens.txt',
      frontend: '/pack/frontend.bin',
    });
    expect(routeCFiles(model, 'hi')).toBeNull();
    expect(routeCFiles({ ...model, files: model.files.slice(0, 2) }, 'gu')).toBeNull();
    expect(routeCFiles({ ...model, format: 'whisper-ggml' }, 'gu')).toBeNull();
  });
  it('reads the helper’s confidence in each word (0-1), none when it gives none; any other value is refused', () => {
    const reply = (c?: unknown) => ({
      language: 'gu',
      words: [{ w: 'આકાર', start: 0, end: 0.08, ...(c === undefined ? {} : { c }) }],
    });
    expect(parseIndicReply(reply(0.83), 'gu').words[0]?.c).toBe(0.83);
    expect(parseIndicReply(reply(), 'gu').words[0]?.c).toBeNull();
    expect(parseIndicReply(reply(null), 'gu').words[0]?.c).toBeNull();
    for (const bad of [1.5, -0.1, '0.8', true])
      expect(() => parseIndicReply(reply(bad), 'gu')).toThrow('Invalid recogniser reply');
  });
  it('knows noise or hum: every word one syllable AND heard with low confidence; clear short answers are speech', () => {
    const low = NOISE_CONFIDENCE / 2;
    const high = (1 + NOISE_CONFIDENCE) / 2;
    const phrase = (text: string, c: number | null) => text.split(' ').map((w) => ({ w, c }));
    // What Route C made of 10 s of generated noise and hum, Gujarati and Hindi (cap-route-c, 5b), heard unsure.
    for (const heard of ['બ છે', 'હ છે', 'હ', 'म', 'है', 'म है', 'आ'])
      expect(noiseOnly(phrase(heard, low))).toBe(true);
    // Real short answers in a sabha, heard clearly, always show; so does any phrase with a longer word.
    for (const heard of ['હા', 'ના', 'जी', 'हाँ', 'હા જી', 'જય', 'हाँ जी'])
      expect(noiseOnly(phrase(heard, high))).toBe(false);
    for (const heard of ['આકાર', 'છે આકાર', 'नमस्ते', 'है आकार'])
      expect(noiseOnly(phrase(heard, low))).toBe(false);
    // No confidence from the helper: no acoustic evidence, so nothing is hidden.
    expect(noiseOnly(phrase('હ છે', null))).toBe(false);
    // One word heard clearly is enough to show the phrase.
    expect(noiseOnly([...phrase('હ', low), ...phrase('છે', high)])).toBe(false);
    expect(noiseOnly([])).toBe(false);
  });
  it('sits between what noise and hum gave and what short answers gave (measured, int8 and full models)', () => {
    const heard = (...words: [string, number][]) => words.map(([w, c]) => ({ w, c }));
    // The highest one-syllable noise and hum words measured, Gujarati and Hindi.
    expect(noiseOnly(heard(['હ', 0.24], ['છે', 0.4]))).toBe(true);
    expect(noiseOnly(heard(['म', 0.1], ['है', 0.31]))).toBe(true);
    // The lowest short answers measured (a synthetic voice's જય heard as જે; हाँ while still growing).
    expect(noiseOnly(heard(['જે', 0.56]))).toBe(false);
    expect(noiseOnly(heard(['हाँ', 0.68]))).toBe(false);
  });
});
