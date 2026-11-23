import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A Web Audio context that only records what the stream's mix makes. */
class GeneratedContext extends EventTarget {
  state: AudioContextState = 'running';
  readonly destination = { name: 'device output' };
  readonly constants: { offset: number; to: unknown[]; started: number }[] = [];
  private node() {
    return { connect: (to: unknown) => to, disconnect: () => undefined };
  }
  createGain() {
    return { ...this.node(), gain: { value: 1 } };
  }
  createDelay() {
    return { ...this.node(), delayTime: { value: 0, setValueAtTime: () => undefined } };
  }
  createAnalyser() {
    return { ...this.node(), fftSize: 2048 };
  }
  createMediaStreamDestination() {
    return { ...this.node(), stream: { getAudioTracks: () => [] } };
  }
  createConstantSource() {
    const made = { offset: 1, to: [] as unknown[], started: 0 };
    this.constants.push(made);
    return {
      offset: {
        get value() {
          return made.offset;
        },
        set value(v: number) {
          made.offset = v;
        },
      },
      connect(to: unknown) {
        made.to.push(to);
        return to;
      },
      disconnect() {
        made.to = [];
      },
      start() {
        made.started++;
      },
    };
  }
  resume() {
    return Promise.resolve();
  }
}

it("the stream's mix keeps its device output awake with an inaudible constant only while asked (a22-cue)", async () => {
  // Its destination hears nothing (the mix goes only to the encoder's track and the meter), so 30 s after the page
  // opened Chromium moved it to the stand-in sink, which on CI's Mac paced the whole mix at 0.13-0.45 of real time
  // (a22-cue-1123-224735-23691; 0.67-0.9 on Windows in a21-s5b's later fades). The lead (24 Nov): only while the
  // stream's sound is in use or a cue waits, so an idle Drashti holds no sound output open.
  const made: GeneratedContext[] = [];
  vi.stubGlobal(
    'AudioContext',
    class extends GeneratedContext {
      constructor() {
        super();
        made.push(this);
      }
    },
  );
  vi.stubGlobal('document', { body: { dataset: {} } });
  const { StreamSound } = await import('./sound');
  const sound = new StreamSound();
  expect(made).toHaveLength(1);
  const keep = made[0]?.constants ?? [];
  expect(keep).toHaveLength(1);
  expect(keep[0]?.offset ?? 0).toBeGreaterThan(0);
  expect(keep[0]?.offset ?? 1).toBeLessThan(2 ** -24);
  expect(keep[0]?.started).toBe(1);
  // Made at once, but sent to the output only while asked.
  expect(keep[0]?.to).toEqual([]);
  sound.keepOutputAwake(true);
  sound.keepOutputAwake(true);
  expect(keep[0]?.to).toEqual([made[0]?.destination]);
  sound.keepOutputAwake(false);
  expect(keep[0]?.to).toEqual([]);
  sound.keepOutputAwake(false);
  expect(keep[0]?.to).toEqual([]);
});
