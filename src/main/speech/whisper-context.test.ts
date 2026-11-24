import { describe, expect, it } from 'vitest';
import { audioContextFor, sizesContext, whisperModelFor } from './whisper-context';

/*
 * QWC-1 (the owner, 25 Nov 2026: "Yes, Windows small (Rec.)"): whisper's audio context sized to the piece, with the temperature fallback off, ONLY
 * for a CPU whisper engine with a small model. Measured on CI's Windows (runs 45400846089, 45408618411): answers
 * 2.6-3x faster on 4 processors, the words no worse on the clips shown in both. Never turbo, never a Mac (its engine
 * asks for the GPU: Metal).
 */

describe('whisper’s audio context (QWC-1)', () => {
  it('is sized to the piece: its 20 ms steps rounded up to 64, never below 512 or above 1500', () => {
    expect(audioContextFor(16_000 * 3)).toBe(512);
    expect(audioContextFor(16_000 * 10)).toBe(512);
    expect(audioContextFor(16_000 * 12)).toBe(640);
    expect(audioContextFor(16_000 * 21)).toBe(1_088);
    expect(audioContextFor(16_000 * 40)).toBe(1_500);
    expect(audioContextFor(0)).toBe(512);
  });

  it.each([
    ['win32', 'small', true],
    ['win32', 'gu-small-vasista22-q5_0', true],
    ['win32', 'hi-small-vasista22-f16', true],
    ['win32', 'turbo', false],
    ['win32', 'gu-medium-vasista22-q5_0', false],
    ['darwin', 'small', false],
    ['darwin', 'gu-small-vasista22-q5_0', false],
    ['darwin', 'turbo', false],
    ['linux', 'small', false],
  ] as const)('on %s with %s: %s', (platform, model, sized) => {
    expect(sizesContext(platform, model)).toBe(sized);
  });
});

describe('the context is never smaller than the piece (cap-review-ctx n3)', () => {
  it('holds at the edges: 30 s gives 1500, and just over a step rounds up', () => {
    expect(audioContextFor(480_000)).toBe(1_500);
    expect(audioContextFor(471_041)).toBe(1_500);
    expect(audioContextFor(163_841)).toBe(576);
  });

  it('covers every piece up to 30 s: context x 320 samples is at least the piece', () => {
    for (let n = 0; n <= 480_000; n += 997) expect(audioContextFor(n) * 320).toBeGreaterThanOrEqual(n);
  });
});

describe('the model a whisper engine loads, and the one sizing judges (cap-review-ctx SHOULD-1: one helper)', () => {
  const fileOf = (own: { id: string }) =>
    own.id === 'gu-small-vasista22-q5_0' ? '/pack/gu/model.bin' : undefined;
  const selectedFile = (id: string) => `/data/${id}.bin`;

  it("is the language's own whisper.cpp model when the pack holds its file", () => {
    expect(whisperModelFor({ id: 'gu-small-vasista22-q5_0' }, fileOf, 'small', selectedFile)).toEqual({
      id: 'gu-small-vasista22-q5_0',
      file: '/pack/gu/model.bin',
    });
  });

  it('is the selected model when the language has none, when its own is another format, or the pack lacks its file', () => {
    expect(whisperModelFor(null, fileOf, 'small', selectedFile)).toEqual({
      id: 'small',
      file: '/data/small.bin',
    });
    expect(
      whisperModelFor(
        { id: 'gu-indicconformer-ctc-int8', format: 'indicconformer-ctc-onnx-v1' },
        fileOf,
        'turbo',
        selectedFile,
      ),
    ).toEqual({ id: 'turbo', file: '/data/turbo.bin' });
    expect(whisperModelFor({ id: 'hi-small-vasista22-q5_0' }, fileOf, 'small', selectedFile)).toEqual({
      id: 'small',
      file: '/data/small.bin',
    });
  });

  it('asks the pack only for a whisper.cpp model', () => {
    const asked: string[] = [];
    whisperModelFor(
      { id: 'gu-indicconformer-ctc-int8', format: 'indicconformer-ctc-onnx-v1' },
      (own) => {
        asked.push(own.id);
        return undefined;
      },
      'small',
      selectedFile,
    );
    expect(asked).toEqual([]);
  });
});
