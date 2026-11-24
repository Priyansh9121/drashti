import { describe, expect, it } from 'vitest';
import { audioContextFor, sizesContext } from './whisper-context';

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
