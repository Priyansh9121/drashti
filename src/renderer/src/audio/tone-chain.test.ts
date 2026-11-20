import { describe, expect, it, vi } from 'vitest';
import { TONE_EASE_S, toneFilters } from '../../../shared/playback-settings';
import { bandDb, METER_BANDS, toneThrough } from './tone-chain';

/*
 * A sound's tone in Web Audio (alpha.20, Sound and picture…): a file with no tone gets no filters, so nothing changes
 * for it; the first tone puts the four filters between its source and its level, each eased (setTargetAtTime) to the
 * tone's values; and the meter's two bands. Web Audio's nodes are stand-ins here.
 */

function param() {
  return { value: 0, setTargetAtTime: vi.fn() };
}

function fakes() {
  const made: {
    type: string;
    frequency: ReturnType<typeof param>;
    gain: ReturnType<typeof param>;
    Q: ReturnType<typeof param>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const ctx = {
    currentTime: 3,
    createBiquadFilter: () => {
      const node = {
        type: '',
        frequency: param(),
        gain: param(),
        Q: param(),
        connect: vi.fn((n: unknown) => n),
        disconnect: vi.fn(),
      };
      made.push(node);
      return node;
    },
  } as unknown as BaseAudioContext;
  const sourceFake = { connect: vi.fn((n: unknown) => n), disconnect: vi.fn() };
  const levelFake = { connect: vi.fn(), disconnect: vi.fn() };
  return {
    ctx,
    source: sourceFake as unknown as AudioNode,
    level: levelFake as unknown as AudioNode,
    sourceFake,
    made,
  };
}

describe('a sound’s tone', () => {
  it('gives a file with no tone no filters at all: its source stays joined to its level', () => {
    const { ctx, source, level, made, sourceFake } = fakes();
    expect(toneThrough(ctx, source, level, null, null)).toBeNull();
    expect(made).toHaveLength(0);
    expect(sourceFake.disconnect).not.toHaveBeenCalled();
  });

  it('puts the four filters between source and level at the first tone, each eased to its value', () => {
    const { ctx, source, level, made, sourceFake } = fakes();
    const tone = { bassDb: 12, trebleDb: -12, voice: true };
    const chain = toneThrough(ctx, source, level, null, tone);
    expect(chain).not.toBeNull();
    expect(made.map((m) => m.type)).toEqual(['lowshelf', 'highshelf', 'highpass', 'peaking']);
    expect(sourceFake.connect).toHaveBeenCalledWith(made[0]);
    expect(sourceFake.disconnect).toHaveBeenCalledWith(level);
    expect(made[3]?.connect).toHaveBeenCalledWith(level);
    toneFilters(tone).forEach((f, i) => {
      expect(made[i]?.gain.setTargetAtTime).toHaveBeenLastCalledWith(f.gain, 3, TONE_EASE_S);
      expect(made[i]?.frequency.setTargetAtTime).toHaveBeenLastCalledWith(f.frequency, 3, TONE_EASE_S);
    });
    // Taken off again: eased flat, the filters kept (no click, nothing stopped).
    expect(toneThrough(ctx, source, level, chain, null)).toBe(chain);
    expect(made[0]?.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 3, TONE_EASE_S);
  });

  it('reads the meter’s two bands from a spectrum', () => {
    const spectrum = new Float32Array(1024).fill(-120);
    // 48 kHz, 2048 points: 23.4 Hz a bin; 50 Hz is bin 2, 8 kHz bin 341.
    spectrum[2] = -20;
    spectrum[341] = -35;
    expect(bandDb(spectrum, 48_000, 2048, METER_BANDS.low)).toBe(-20);
    expect(bandDb(spectrum, 48_000, 2048, METER_BANDS.high)).toBe(-35);
  });
});
