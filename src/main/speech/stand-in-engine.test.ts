import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Heard, SpeechState } from '../../shared/speech';
import { createStandInEngine } from './stand-in-engine';

/*
 * The test switch's stand-in recognizer (DRASHTI_TEST_SPEECH): placeholder phrases "heard" in turn, each half then
 * whole. Once (DRASHTI_TEST_SPEECH_ONCE, cap-integration): each phrase is heard one time and then nothing more, so an
 * end-to-end test can correct a settled clause before a newer one replaces it.
 */

function listen(once: boolean) {
  const heard: Heard[] = [];
  const states: SpeechState[] = [];
  const stop = createStandInEngine(['alpha beta', 'gamma delta'], 1_500, once ? { once: true } : {}).start(
    'en',
    {
      heard: (h) => heard.push(h),
      state: (s) => states.push(s),
    },
  );
  return { heard, states, stop };
}

describe('the stand-in recognizer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('as today: the phrases in turn, round and round, each half then whole', () => {
    const t = listen(false);
    expect(t.states).toEqual([{ phase: 'listening', language: 'en' }]);
    vi.advanceTimersByTime(1_500 * 4);
    expect(t.heard.map((h) => [h.id, h.final, h.text])).toEqual([
      ['s1', false, 'alpha'],
      ['s1', true, 'alpha beta'],
      ['s2', false, 'gamma'],
      ['s2', true, 'gamma delta'],
      ['s3', false, 'alpha'],
      ['s3', true, 'alpha beta'],
      ['s4', false, 'gamma'],
      ['s4', true, 'gamma delta'],
    ]);
    t.stop();
  });

  it('hold (cap-threads): after its first phrase heard whole it rests as a too-slow computer does, and stays resting', () => {
    const heard: Heard[] = [];
    const states: SpeechState[] = [];
    const stop = createStandInEngine(['alpha beta', 'gamma delta'], 1_500, { hold: true }).start('en', {
      heard: (h) => heard.push(h),
      state: (s) => states.push(s),
    });
    vi.advanceTimersByTime(1_500 * 5);
    expect(heard.map((h) => [h.id, h.final, h.text])).toEqual([
      ['s1', false, 'alpha'],
      ['s1', true, 'alpha beta'],
    ]);
    expect(states).toEqual([
      { phase: 'listening', language: 'en' },
      {
        phase: 'held',
        reason: 'busy',
        slow: { answerMs: 9_100, behindMs: 6_200, threads: 2, processors: 2, rests: 1 },
      },
    ]);
    stop();
  });

  it('once: each phrase one time, then nothing more while still listening', () => {
    const t = listen(true);
    vi.advanceTimersByTime(1_500 * 6);
    expect(t.heard.map((h) => [h.id, h.final, h.text])).toEqual([
      ['s1', false, 'alpha'],
      ['s1', true, 'alpha beta'],
      ['s2', false, 'gamma'],
      ['s2', true, 'gamma delta'],
    ]);
    expect(t.states).toEqual([{ phase: 'listening', language: 'en' }]);
    t.stop();
  });
});
