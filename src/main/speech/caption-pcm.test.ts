import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CAPTION_SETTINGS, type CaptionsShown } from '../../shared/captions';
import type { Heard } from '../../shared/speech';
import { CaptionCoordinator } from './caption-coordinator';
import { CaptionStabilizer } from './caption-stabilizer';
import { createSpeechHub } from './hub';
import { createWhisperEngine, SAMPLE_RATE } from './whisper-engine';

/** The value, or the test stops here with a plain reason (no non-null assertion). */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a value here');
  return value;
}

/* Generated tone PCM -> existing engine/hub -> new stabilizer/coordinator. Decoder is a pure stand-in:
 * no program runs, no model/file is read, no microphone opens and no HTTP inference request is made.
 * The existing engine's free-port probe is loopback only. These words say nothing about ASR accuracy.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-11-23T09:00:00Z'));
});
afterEach(() => vi.useRealTimers());

it('preserves generated PCM capture age through provisional and final clauses, then clears on stop', async () => {
  const shown: (CaptionsShown | null)[] = [];
  const coordinator = new CaptionCoordinator({
    clock: () => Date.now(),
    settings: () => DEFAULT_CAPTION_SETTINGS,
    show: (captions) => shown.push(captions),
    changed: () => undefined,
  });
  const sessionId = coordinator.start();
  const stabilizer = new CaptionStabilizer({
    sessionId,
    inputEpoch: must(coordinator.inputEpochId()),
    sourceLanguage: 'en',
    targetLanguage: 'hi',
    emit: (clause) => {
      expect(coordinator.accept(clause)).toBe(true);
    },
    omitted: () => {
      throw new Error('The generated observation was invalid.');
    },
  });
  let pcm: ((samples: Int16Array, endAt: number) => void) | null = null;
  const soundPort = (): ((samples: Int16Array, endAt: number) => void) | null => pcm;
  let resolveListening: () => void = () => undefined;
  let rejectListening: (error: unknown) => void = () => undefined;
  const listening = new Promise<void>((resolve, reject) => {
    resolveListening = resolve;
    rejectListening = reject;
  });
  void listening.catch(() => undefined);
  let resolveFinal: (heard: Heard) => void = () => undefined;
  let rejectFinal: (error: unknown) => void = () => undefined;
  const final = new Promise<Heard>((resolve, reject) => {
    resolveFinal = resolve;
    rejectFinal = reject;
  });
  void final.catch(() => undefined);
  const heard: Heard[] = [];
  let sequence = 0;
  let inference = 0;
  const infer = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    try {
      if (!init?.method) return new Response('{}', { status: 200 });
      const clip = (init.body as FormData).get('file');
      expect(clip).toBeInstanceOf(Blob);
      const wave = new DataView(await (clip as Blob).arrayBuffer());
      expect(wave.getUint32(24, true)).toBe(SAMPLE_RATE);
      expect(wave.getUint16(22, true)).toBe(1);
      expect(wave.byteLength).toBeGreaterThan(44);
      inference += 1;
      const words = (inference === 1 ? 'The blue box' : 'The green box is beside a round shape.').split(' ');
      return new Response(
        JSON.stringify({
          language: 'english',
          segments: [
            {
              no_speech_prob: 0,
              words: words.map((word, index) => ({
                word: ` ${word}`,
                start: index * 0.1,
                end: (index + 1) * 0.1,
                probability: 0.9,
              })),
            },
          ],
        }),
        { status: 200 },
      );
    } catch (error) {
      // The production engine contains transport errors; fixture assertions must still fail for their own reason.
      rejectListening(error);
      rejectFinal(error);
      throw error;
    }
  });
  const child = Object.assign(new EventEmitter(), {
    pid: undefined,
    exitCode: null,
    kill: () => true,
  }) as unknown as ChildProcess;
  const hub = createSpeechHub({
    engine: createWhisperEngine({
      program: () => '/placeholder/unused-helper',
      model: () => '/placeholder/unused-model',
      fallback: () => false,
      spawn: () => child,
      fetch: infer,
      sound: {
        open: (to) => {
          pcm = to;
          return () => {
            pcm = null;
          };
        },
      },
      log: { info: () => undefined, warn: () => undefined },
    }),
    log: { info: () => undefined, warn: () => undefined },
  });
  hub.setLanguage('en');
  const stopState = hub.onState((state) => {
    if (state.phase === 'listening') resolveListening();
    else if (state.phase !== 'starting') {
      if (state.phase === 'failed') {
        const error = new Error(state.message);
        rejectListening(error);
        rejectFinal(error);
      }
      coordinator.stop();
    }
  });
  const stopHeard = hub.listen('generated-caption-coordinator', (phrase) => {
    try {
      heard.push(phrase);
      sequence += 1;
      expect(
        stabilizer.observe({
          sessionId,
          inputEpoch: must(coordinator.inputEpochId()),
          enginePhraseId: phrase.id,
          sequence,
          text: phrase.text,
          final: phrase.final,
          startAt: phrase.startAt,
          endAt: phrase.endAt,
          observedAt: Date.now(),
        }),
      ).toBe(true);
      if (phrase.final) resolveFinal(phrase);
    } catch (error) {
      rejectFinal(error);
      throw error;
    }
  });
  try {
    hub.setOn(true);
    await listening;
    // 2 seconds of generated tone followed by the existing 700 ms pause boundary, all on a controlled clock.
    for (let index = 0; index < 27; index += 1) {
      await vi.advanceTimersByTimeAsync(100);
      const samples = new Int16Array(SAMPLE_RATE / 10);
      if (index < 20)
        for (let at = 0; at < samples.length; at += 1) samples[at] = Math.round(3_000 * Math.sin(at / 3));
      const send = soundPort();
      if (!send) throw new Error('The generated sound port did not open.');
      send(samples, Date.now());
    }
    const settled = await final;
    await vi.advanceTimersByTimeAsync(300);
    expect(heard.map((phrase) => phrase.final)).toEqual([false, true]);
    expect(coordinator.view().current).toMatchObject({
      sessionId,
      phraseId: 's1',
      revision: 2,
      status: 'settled',
      endAt: settled.endAt,
      parent: { timingPrecision: 'phrase' },
    });
    expect(settled.heardAt - settled.endAt).toBeGreaterThan(1_000);
    expect(shown.at(-1)?.lines).toEqual(['The green box is beside a round shape.']);
    hub.setOn(false);
    expect(shown.at(-1)).toBeNull();
    expect(pcm).toBeNull();
  } finally {
    stopHeard();
    stopState();
    hub.close();
    coordinator.stop();
  }
});
