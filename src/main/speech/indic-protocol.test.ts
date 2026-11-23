import { describe, expect, it } from 'vitest';
import { indicWords, noiseOnly, pcmFrame, routeCFiles } from './indic-protocol';

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
  it('knows a phrase made of noise or hum: every word one syllable (cap-route-c’s generated noise and hum)', () => {
    const phrase = (text: string) => text.split(' ').map((w) => ({ text: w }));
    // What Route C heard in 10 s of generated noise and hum, Gujarati and Hindi, int8 and full (cap-route-c, 5b).
    for (const heard of ['બ છે', 'હ છે', 'હ', 'म', 'है', 'म है', 'आ']) expect(noiseOnly(phrase(heard))).toBe(true);
    // Words of more than one syllable, or any one of them in the phrase: speech, kept.
    for (const heard of ['આકાર', 'લીલું ખોખું', 'છે આકાર', 'नमस्ते', 'क्ष', 'है आकार'])
      expect(noiseOnly(phrase(heard))).toBe(false);
    expect(noiseOnly([])).toBe(false);
  });
});
