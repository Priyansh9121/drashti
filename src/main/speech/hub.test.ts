import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Heard, SpeechLanguage, SpeechState } from '../../shared/speech';
import { createSpeechHub, type SpeechEngine } from './hub';

/* The real speech hub (Session 55, Part 10): its engine is a stand-in here; placeholder words only. */

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);

function phrase(id: string, final: boolean, text: string, behindMs = 1_500): Heard {
  const words = text.split(' ').filter((w) => w !== '');
  // The last word ends exactly behindMs before it is heard.
  const endAt = Date.now() - behindMs;
  const startAt = words.length === 0 ? endAt : endAt - words.length * 400 + 100;
  const heardWords = words.map((w, i) => ({
    text: w,
    startAt: startAt + i * 400,
    endAt: startAt + i * 400 + 300,
    confidence: 0.9,
  }));
  return {
    id,
    final,
    language: 'en',
    languageConfidence: 0.9,
    words: heardWords,
    text: words.join(' '),
    startAt,
    endAt: heardWords.at(-1)?.endAt ?? startAt,
    heardAt: Date.now(),
  };
}

/** A stand-in engine: the test says what it hears and how it is. */
function standIn() {
  const runs: { language: SpeechLanguage | 'auto'; stopped: boolean }[] = [];
  let out: { heard(h: Heard): void; state(s: SpeechState): void } | null = null;
  const engine: SpeechEngine = {
    start(language, to) {
      const run = { language, stopped: false };
      runs.push(run);
      out = to;
      return () => {
        run.stopped = true;
        out = null;
      };
    },
  };
  return {
    engine,
    runs,
    hear: (h: Heard) => out?.heard(h),
    be: (s: SpeechState) => out?.state(s),
  };
}

function setup() {
  const e = standIn();
  const lines: string[] = [];
  const hub = createSpeechHub({
    engine: e.engine,
    log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
    lingerMs: 5_000,
  });
  return { hub, e, lines };
}

describe('the speech hub (Part 10)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is off until an admin turns it on: a listener registers, nothing starts, nothing arrives', () => {
    const { hub, e } = setup();
    const heard: Heard[] = [];
    hub.listen('captions', (h) => heard.push(h));
    expect(hub.state()).toEqual({ phase: 'off' });
    expect(e.runs).toEqual([]);
    e.hear(phrase('s1', true, 'alpha'));
    expect(heard).toEqual([]);
  });

  it('runs only while someone listens: starts with the first, stops a few seconds after the last', () => {
    const { hub, e } = setup();
    const states: SpeechState[] = [];
    hub.onState((s) => states.push(s));
    hub.setOn(true);
    expect(e.runs).toEqual([]);
    const stopA = hub.listen('captions', () => undefined);
    expect(e.runs).toHaveLength(1);
    expect(hub.state()).toEqual({ phase: 'starting' });
    e.be({ phase: 'listening', language: 'auto' });
    const stopB = hub.listen('helper:placeholder', () => undefined);
    expect(e.runs).toHaveLength(1);
    stopA();
    stopB();
    vi.advanceTimersByTime(4_999);
    expect(e.runs[0]?.stopped).toBe(false);
    // A listener back within the few seconds keeps the same run.
    const stopC = hub.listen('captions', () => undefined);
    vi.advanceTimersByTime(10_000);
    expect(e.runs[0]?.stopped).toBe(false);
    stopC();
    vi.advanceTimersByTime(5_000);
    expect(e.runs[0]?.stopped).toBe(true);
    expect(hub.state()).toEqual({ phase: 'off' });
    expect(states).toEqual([
      { phase: 'starting' },
      { phase: 'listening', language: 'auto' },
      { phase: 'off' },
    ]);
  });

  it('turned off by the admin, stops at once; a new language starts it again in that language', () => {
    const { hub, e } = setup();
    hub.setOn(true);
    hub.listen('captions', () => undefined);
    hub.setLanguage('gu');
    expect(e.runs.map((r) => [r.language, r.stopped])).toEqual([
      ['auto', true],
      ['gu', false],
    ]);
    hub.setOn(false);
    expect(e.runs[1]?.stopped).toBe(true);
    expect(hub.state()).toEqual({ phase: 'off' });
  });

  it('gives each phrase to every listener while listening, and drops what is more than 10 s behind', () => {
    const { hub, e } = setup();
    hub.setOn(true);
    const a: string[] = [];
    const b: string[] = [];
    hub.listen('captions', (h) => a.push(`${h.id}:${String(h.final)}:${h.text}`));
    hub.listen('helper:placeholder', (h) => b.push(h.text));
    // Not listening yet (starting): nothing arrives.
    e.hear(phrase('s1', false, 'alpha'));
    e.be({ phase: 'listening', language: 'auto' });
    e.hear(phrase('s1', false, 'alpha'));
    e.hear(phrase('s1', true, 'alpha beta'));
    e.hear(phrase('s2', true, 'gamma', 10_500));
    // A final id is never sent again.
    e.hear(phrase('s1', true, 'delta'));
    expect(a).toEqual(['s1:false:alpha', 's1:true:alpha beta']);
    expect(b).toEqual(['alpha', 'alpha beta']);
  });

  it('keeps a listener that throws, names it once in the log, and the others still hear', () => {
    const { hub, e, lines } = setup();
    hub.setOn(true);
    const heard: string[] = [];
    hub.listen('helper:broken', () => {
      throw new Error('placeholder failure with words alpha');
    });
    hub.listen('captions', (h) => heard.push(h.text));
    e.be({ phase: 'listening', language: 'auto' });
    e.hear(phrase('s1', true, 'alpha'));
    e.hear(phrase('s2', true, 'beta'));
    expect(heard).toEqual(['alpha', 'beta']);
    const named = lines.filter((l) => l.includes('helper:broken'));
    expect(named).toHaveLength(1);
  });

  it('never logs a word: counts and times only', () => {
    const { hub, e, lines } = setup();
    hub.setOn(true);
    const stop = hub.listen('captions', () => undefined);
    e.be({ phase: 'listening', language: 'auto' });
    e.hear(phrase('s1', false, 'alpha'));
    e.hear(phrase('s1', true, 'alpha beta'));
    e.hear(phrase('s2', true, 'gamma delta', 2_500));
    e.hear(phrase('s3', true, 'epsilon', 12_000));
    stop();
    vi.advanceTimersByTime(5_000);
    const log = lines.join('\n');
    expect(log).toMatch(/Speech: 2 phrases, 2\.0 s behind, 1 dropped late/);
    expect(log).not.toMatch(/alpha|beta|gamma|delta|epsilon/);
  });

  it('passes on the engine’s own state: held (busy, no sound input, no model) and failed', () => {
    const { hub, e } = setup();
    hub.setOn(true);
    hub.listen('captions', () => undefined);
    e.be({ phase: 'held', reason: 'busy' });
    expect(hub.state()).toEqual({ phase: 'held', reason: 'busy' });
    e.be({ phase: 'failed', message: 'Placeholder failure.' });
    expect(hub.state()).toEqual({ phase: 'failed', message: 'Placeholder failure.' });
  });
});
