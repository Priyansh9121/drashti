import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Heard, HeardWord, SpeechState } from '../../shared/speech';
import { createFakeSpeechHub } from './speech-hub';

const NOW = Date.UTC(2026, 10, 4, 9, 0, 0);

/** A phrase of placeholder words, heard 1.5 s after it ended (times near the fake clock's now). */
function phrase(
  id: string,
  final: boolean,
  words: string[],
  over: Partial<Heard> = {},
): Omit<Heard, 'heardAt'> {
  const startAt = NOW - 3_000;
  const heardWords = words.map((text, i) => ({
    text,
    startAt: startAt + i * 400,
    endAt: startAt + i * 400 + 300,
    confidence: 0.9,
  }));
  return {
    id,
    final,
    language: 'en',
    languageConfidence: 0.8,
    words: heardWords,
    text: words.join(' '),
    startAt,
    endAt: heardWords.at(-1)?.endAt ?? startAt,
    ...over,
  };
}

const LISTENING: SpeechState = { phase: 'listening', language: 'auto' };

describe('the fake speech hub (Part 10), for unit tests of every listener', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts off: listen() registers, and nothing can be heard until it listens', () => {
    const hub = createFakeSpeechHub();
    const heard: Heard[] = [];
    hub.listen('captions', (h) => heard.push(h));
    expect(hub.state()).toEqual({ phase: 'off' });
    expect(() => {
      hub.say(phrase('s1', true, ['alpha']));
    }).toThrow(/listening/);
    expect(heard).toEqual([]);
  });

  it('gives every listener each phrase in order, partials then the final, heardAt now unless given', () => {
    const hub = createFakeSpeechHub();
    hub.setState(LISTENING);
    const a: Heard[] = [];
    const b: Heard[] = [];
    hub.listen('captions', (h) => a.push(h));
    hub.listen('helper:test', (h) => b.push(h));
    hub.say(phrase('s1', false, ['alpha']));
    hub.say(phrase('s1', false, ['alpha', 'beta']));
    hub.say({ ...phrase('s1', true, ['alpha', 'beta', 'gamma']), heardAt: NOW - 500 });
    expect(a.map((h) => [h.id, h.final, h.text, h.heardAt])).toEqual([
      ['s1', false, 'alpha', NOW],
      ['s1', false, 'alpha beta', NOW],
      ['s1', true, 'alpha beta gamma', NOW - 500],
    ]);
    expect(b).toEqual(a);
    // What a listener is given cannot be changed under the others.
    const first = a[0];
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.words)).toBe(true);
    expect(Object.isFrozen(first?.words[0])).toBe(true);
  });

  it('stops giving phrases to a listener that stopped (twice is harmless)', () => {
    const hub = createFakeSpeechHub();
    hub.setState(LISTENING);
    const heard: string[] = [];
    const stop = hub.listen('captions', (h) => heard.push(h.text));
    hub.say(phrase('s1', true, ['alpha']));
    stop();
    stop();
    hub.say(phrase('s2', true, ['beta']));
    expect(heard).toEqual(['alpha']);
  });

  it('tells each state change once, and not after the watcher stopped', () => {
    const hub = createFakeSpeechHub();
    const seen: SpeechState[] = [];
    const stop = hub.onState((s) => seen.push(s));
    hub.setState({ phase: 'starting' });
    hub.setState({ phase: 'starting' });
    hub.setState(LISTENING);
    hub.setState({ phase: 'held', reason: 'busy' });
    hub.setState({ phase: 'held', reason: 'no-sound-input' });
    stop();
    hub.setState({ phase: 'failed', message: 'Placeholder failure.' });
    expect(seen).toEqual([
      { phase: 'starting' },
      LISTENING,
      { phase: 'held', reason: 'busy' },
      { phase: 'held', reason: 'no-sound-input' },
    ]);
    expect(hub.state()).toEqual({ phase: 'failed', message: 'Placeholder failure.' });
  });

  it('hears nothing while held, starting or failed', () => {
    const hub = createFakeSpeechHub();
    for (const s of [
      { phase: 'held', reason: 'busy' },
      { phase: 'starting' },
      { phase: 'failed', message: 'Placeholder failure.' },
    ] satisfies SpeechState[]) {
      hub.setState(s);
      expect(() => {
        hub.say(phrase('s1', true, ['alpha']));
      }).toThrow(/listening/);
    }
  });

  it("never sends a final phrase's id again, until listening starts again (ids start from s1 then)", () => {
    const hub = createFakeSpeechHub();
    hub.setState(LISTENING);
    const heard: string[] = [];
    hub.listen('captions', (h) => heard.push(`${h.id}:${h.text}`));
    hub.say(phrase('s1', true, ['alpha']));
    expect(() => {
      hub.say(phrase('s1', false, ['beta']));
    }).toThrow(/s1.*final/);
    hub.setState({ phase: 'held', reason: 'busy' });
    hub.setState(LISTENING);
    hub.say(phrase('s1', true, ['gamma']));
    expect(heard).toEqual(['s1:alpha', 's1:gamma']);
  });

  it('refuses a phrase the real hub never sends', () => {
    const hub = createFakeSpeechHub();
    hub.setState({ phase: 'listening', language: 'gu' });
    const refused = (h: Omit<Heard, 'heardAt'> & { heardAt?: number }, why: RegExp): void => {
      expect(() => {
        hub.say(h);
      }).toThrow(why);
    };
    // Each refused phrase below has exactly one thing wrong; its words lie inside its span.
    const w = (
      text: string,
      startAt: number,
      endAt: number,
      confidence: number | null = null,
    ): HeardWord => ({
      text,
      startAt,
      endAt,
      confidence,
    });
    const gu = (over: Partial<Heard> = {}): Omit<Heard, 'heardAt'> => ({
      ...phrase('s1', true, ['alpha', 'beta'], { language: 'gu' }),
      startAt: NOW - 3_000,
      endAt: NOW - 1_000,
      ...over,
    });
    // Only the language the admin chose.
    refused(gu({ language: 'hi' }), /language/);
    // A word is never empty and has no surrounding spaces; the words and the text are NFC.
    refused(gu({ words: [w('', NOW - 2_000, NOW - 1_900)] }), /word/);
    refused(gu({ words: [w(' alpha', NOW - 2_000, NOW - 1_900)] }), /word/);
    refused(gu({ words: [w('café', NOW - 2_000, NOW - 1_900)] }), /NFC/);
    refused(gu({ text: 'café' }), /NFC/);
    // Times never run backwards, and the words lie inside their phrase.
    refused(gu({ words: [w('alpha', NOW - 2_000, NOW - 2_100)] }), /time/);
    refused(
      gu({ words: [w('alpha', NOW - 2_000, NOW - 1_900), w('beta', NOW - 2_500, NOW - 1_800)] }),
      /time/,
    );
    refused(gu({ words: [w('alpha', NOW - 4_000, NOW - 1_900)] }), /time/);
    refused(gu({ startAt: NOW - 1_000, endAt: NOW - 2_000, words: [], final: false }), /time/);
    // Confidence is 0 to 1, or null.
    refused(gu({ languageConfidence: 1.5 }), /confidence/);
    refused(gu({ words: [w('alpha', NOW - 2_000, NOW - 1_900, -0.1)] }), /confidence/);
    // A final phrase has words; a partial may have none.
    refused(gu({ words: [], text: '' }), /words/);
    // Its id is s1, s2…
    refused(gu({ id: 'phrase-1' }), /id/);
    // Never more than 10 s behind.
    refused({ ...gu(), heardAt: NOW - 1_000 + 10_001 }, /10 s/);
    // None of those was heard, so s1 is still free.
    const heard: string[] = [];
    hub.listen('captions', (h) => heard.push(h.id));
    hub.say(phrase('s1', false, [], { language: 'gu', text: '', startAt: NOW - 500, endAt: NOW - 500 }));
    hub.say(gu());
    expect(heard).toEqual(['s1', 's1']);
  });

  it('keeps a listener that throws, gives the phrase to the others, then throws for the test to see', () => {
    const hub = createFakeSpeechHub();
    hub.setState(LISTENING);
    const heard: string[] = [];
    hub.listen('helper:broken', () => {
      throw new Error('placeholder listener failure');
    });
    hub.listen('captions', (h) => heard.push(h.text));
    expect(() => {
      hub.say(phrase('s1', true, ['alpha']));
    }).toThrow('placeholder listener failure');
    expect(() => {
      hub.say(phrase('s2', true, ['beta']));
    }).toThrow('placeholder listener failure');
    expect(heard).toEqual(['alpha', 'beta']);
  });

  it('names each listener (for the log), never with an empty name', () => {
    const hub = createFakeSpeechHub();
    expect(() => hub.listen('', () => undefined)).toThrow(/name/);
    expect(() => hub.listen(' captions', () => undefined)).toThrow(/name/);
  });
});
