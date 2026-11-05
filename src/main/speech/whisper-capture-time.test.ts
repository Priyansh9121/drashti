import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import type { Heard } from '../../shared/speech';
import { createWhisperEngine, SAMPLE_RATE, type PcmSource } from './whisper-engine';

/** The recognizer's offsets count submitted samples; the microphone's captured times can have gaps. */
async function hear(
  spacing: number,
  age: number,
  responseDelay = 0,
): Promise<{ final: Heard; endAt: number }> {
  const captured = { offer: null as ((samples: Int16Array, endAt: number) => void) | null };
  const now = 1_800_000_000_000;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  let listening!: () => void;
  let finished!: (heard: Heard) => void;
  const ready = new Promise<void>((resolve) => {
    listening = resolve;
  });
  const result = new Promise<Heard>((resolve) => {
    finished = resolve;
  });
  const sound: PcmSource = {
    open(chunk) {
      captured.offer = chunk;
      return () => {
        captured.offer = null;
      };
    },
  };
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    kill() {
      child.exitCode = 0;
      return true;
    },
  });
  const engine = createWhisperEngine({
    program: () => '/generated/whisper-server',
    model: () => '/generated/model.bin',
    fallback: () => false,
    sound,
    spawn: () => child as unknown as ChildProcess,
    fetch: (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/health')) return Promise.resolve(new Response('ok'));
      // Advance recognition time without a real scheduling budget in this correctness test.
      clock.mockReturnValue(now + responseDelay);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            language: 'english',
            segments: [
              {
                words: [
                  { word: ' alpha', start: 0.1, end: 0.4, probability: 0.9 },
                  { word: ' beta', start: 1.75, end: 1.95, probability: 0.9 },
                ],
              },
            ],
          }),
        ),
      );
    },
    log: { info: () => undefined, warn: () => undefined },
    pauseMs: 100,
  });
  const stop = engine.start('en', {
    heard(heard) {
      if (heard.final) finished(heard);
    },
    state(state) {
      if (state.phase === 'listening') listening();
    },
  });
  try {
    await ready;
    const endAt = Date.now() - age;
    for (let i = 0; i <= 20; i++) {
      const samples = new Int16Array(SAMPLE_RATE / 10);
      if (i < 20) for (let j = 0; j < samples.length; j++) samples[j] = Math.round(3000 * Math.sin(j / 3));
      if (!captured.offer) throw new Error('The generated microphone is not open');
      captured.offer(samples, endAt - (20 - i) * spacing);
    }
    return { final: await result, endAt };
  } finally {
    stop();
    clock.mockRestore();
  }
}

it('locates words on their captured chunks when audio delivery is discontinuous', async () => {
  const { final, endAt } = await hear(600, 0);
  // The last word ends halfway through the last loud 100 ms chunk, captured 600 ms before the quiet one.
  expect(final.endAt).toBe(endAt - 650);
  expect(final.words.at(-1)?.endAt).toBe(endAt - 650);
  expect(final.heardAt - final.endAt).toBeLessThan(2_000);
});

it('preserves genuine capture age instead of refreshing word times at recognition or delivery', async () => {
  const { final, endAt } = await hear(100, 4_000, 80);
  expect(final.endAt).toBe(endAt - 150);
  expect(final.heardAt - final.endAt).toBeGreaterThanOrEqual(4_080);
});
