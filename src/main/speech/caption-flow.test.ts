import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptionReview } from '../../shared/caption-coordinator';
import { DEFAULT_CAPTION_SETTINGS, type CaptionsShown } from '../../shared/captions';
import type { Heard, SpeechLanguage, SpeechState } from '../../shared/speech';
import { CaptionCoordinator } from './caption-coordinator';
import { createCaptionFlow, type CaptionSpelling } from './caption-flow';
import { createSpeechHub } from './hub';
import { spellingFixer } from './spelling-fixer';

/*
 * Caption AI's path end to end in the main process (cap-integration): a stand-in recognizer -> the real speech hub
 * -> this flow (the glossary's fixer on the way) -> Codex x90's coordinator -> the lines the screens draw. Neutral
 * placeholder words only (coloured boxes and shapes); no sound, no model, no download.
 */

/** A stand-in for cap-glossary's fixer: one near-miss Gujarati spelling put right, nothing else touched. */
const SPELLING: CaptionSpelling = (h) => {
  if (h.language !== 'gu') return h;
  const words = h.words.map((w) => (w.text === 'ખોખુ' ? { ...w, text: 'ખોખું' } : w));
  return { ...h, words, text: words.map((w) => w.text).join(' ') };
};

function setup(o: { spelling?: CaptionSpelling; language?: SpeechLanguage } = {}) {
  let out: { heard(h: Heard): void; state(s: SpeechState): void } | null = null;
  const starts: string[] = [];
  const hub = createSpeechHub({
    engine: {
      start(language, to) {
        starts.push(language);
        out = to;
        to.state({ phase: 'listening', language });
        return () => {
          out = null;
        };
      },
    },
    log: { info: () => undefined, warn: () => undefined },
    lingerMs: 0,
  });
  const shown: (CaptionsShown | null)[] = [];
  const reviews: CaptionReview[] = [];
  const coordinator = new CaptionCoordinator({
    // The test's clock (Date.now, faked): the coordinator maps capture times onto it (x90's monotonic mapping).
    clock: () => Date.now(),
    settings: () => DEFAULT_CAPTION_SETTINGS,
    show: (c) => shown.push(c),
    changed: (r) => reviews.push(r),
  });
  const finals: Heard[] = [];
  const flow = createCaptionFlow({
    hub,
    coordinator,
    ...(o.spelling ? { spelling: o.spelling } : {}),
    onFinalPhrase: (h) => finals.push(h),
  });
  hub.setLanguage(o.language ?? 'gu');
  hub.setOn(true);
  /** The recognizer hears these placeholder words, as a partial or final phrase. */
  const say = (text: string, final: boolean, id = 's1', language: SpeechLanguage = o.language ?? 'gu') => {
    const words = text.split(' ').filter((w) => w !== '');
    const endAt = Date.now() - 500;
    const startAt = endAt - Math.max(1, words.length) * 300;
    out?.heard({
      id,
      final,
      language,
      languageConfidence: null,
      words: words.map((w, i) => ({
        text: w,
        startAt: startAt + i * 300,
        endAt: startAt + i * 300 + 250,
        confidence: 0.9,
      })),
      text: words.join(' '),
      startAt,
      endAt,
      heardAt: Date.now(),
    });
  };
  /** The operator corrects the clause shown now (x90's correction panel does this). */
  const correct = (text: string): boolean => {
    const c = coordinator.view().current;
    if (!c) throw new Error('No clause is shown to correct');
    return coordinator.correct({ sessionId: c.sessionId, phraseId: c.phraseId, revision: c.revision, text });
  };
  return {
    hub,
    coordinator,
    flow,
    say,
    correct,
    starts,
    finals,
    shown,
    reviews,
    lines: () => shown.at(-1)?.lines ?? null,
    current: () => coordinator.view().current,
  };
}

describe('caption AI path: recognizer -> hub -> flow -> coordinator -> screens', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a phrase is provisional while heard, settled when final, corrected by the operator: two lines at most', () => {
    const t = setup();
    t.flow.start();
    expect(t.starts).toEqual(['gu']);
    t.say('લીલું ખોખું', false);
    expect(t.lines()).toEqual(['લીલું ખોખું']);
    expect(t.current()).toMatchObject({
      phraseId: 's1',
      revision: 1,
      status: 'provisional',
      sourceLanguage: 'gu',
    });
    t.say('લીલું ખોખું ગોળ આકાર પાસે છે', true);
    vi.advanceTimersByTime(300);
    expect(t.lines()).toEqual(['લીલું ખોખું ગોળ આકાર પાસે છે']);
    expect(t.current()).toMatchObject({ revision: 2, status: 'settled' });
    expect(t.correct('વાદળી ખોખું ગોળ આકાર પાસે છે')).toBe(true);
    vi.advanceTimersByTime(300);
    expect(t.lines()).toEqual(['વાદળી ખોખું ગોળ આકાર પાસે છે']);
    expect(t.current()).toMatchObject({ revision: 3, status: 'corrected' });
    // A long phrase still fits the band: at most two lines of at most 40 letters (Medium).
    t.say(Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 'લીલું' : 'ખોખું')).join(' '), true, 's2');
    vi.advanceTimersByTime(300);
    const lines = t.lines() ?? [];
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const line of lines) expect(Array.from(line).length).toBeLessThanOrEqual(40);
    expect(t.current()).toMatchObject({ phraseId: 's2', revision: 1, status: 'settled' });
  });

  it('the glossary puts a spelling right before the coordinator sees it, provisional and settled, in its own language only', () => {
    const t = setup({ spelling: SPELLING });
    t.flow.start();
    t.say('લીલું ખોખુ', false);
    expect(t.lines()).toEqual(['લીલું ખોખું']);
    t.say('લીલું ખોખુ ગોળ આકાર', true);
    vi.advanceTimersByTime(300);
    expect(t.lines()).toEqual(['લીલું ખોખું ગોળ આકાર']);
    expect(t.current()).toMatchObject({ sourceText: 'લીલું ખોખું ગોળ આકાર', status: 'settled' });
    t.flow.stop();
    // Hindi: the Gujarati word list is not asked to change it.
    const h = setup({ spelling: SPELLING, language: 'hi' });
    h.flow.start();
    h.say('नीला ખોખુ', true);
    expect(h.lines()).toEqual(['नीला ખોખુ']);
  });

  it('with cap-glossary’s own fixer: a caption word heard a letter off is spelt as written, provisional, settled and in the draft; Hindi untouched', () => {
    // cap-glossary's invented placeholder word ("Zentrova" in Gujarati letters), heard with one letter off.
    const word = 'ઝેન્ટ્રોવા';
    const fixer = spellingFixer([{ language: 'gu', word }]);
    const t = setup({ spelling: fixer });
    t.flow.start();
    t.say('લીલું ઝેન્ટરોવા', false);
    expect(t.lines()).toEqual([`લીલું ${word}`]);
    t.say('લીલું ઝેન્ટરોવા ગોળ આકાર', true);
    vi.advanceTimersByTime(300);
    expect(t.lines()).toEqual([`લીલું ${word} ગોળ આકાર`]);
    expect(t.current()).toMatchObject({ revision: 2, status: 'settled' });
    expect(t.finals.map((f) => f.text)).toEqual([`લીલું ${word} ગોળ આકાર`]);
    t.flow.stop();
    const h = setup({ spelling: fixer, language: 'hi' });
    h.flow.start();
    h.say('नीला ઝેન્ટરોવા', true);
    expect(h.lines()).toEqual(['नीला ઝેન્ટરોવા']);
  });

  it('the same words heard again keep their revision; an empty partial is not passed on', () => {
    const t = setup();
    t.flow.start();
    t.say('', false);
    expect(t.current()).toBeNull();
    t.say('લીલું', false);
    t.say('લીલું', false);
    expect(t.current()).toMatchObject({ revision: 1 });
    t.say('લીલું ખોખું', false);
    expect(t.current()).toMatchObject({ revision: 2 });
    // The final with the very words of the last partial: settled, as its own revision.
    t.say('લીલું ખોખું', true);
    expect(t.current()).toMatchObject({ revision: 3, status: 'settled' });
  });

  it('listening that starts again (ids from s1 again) is a new session: the old one never shows again', () => {
    const t = setup();
    t.flow.start();
    t.say('લીલું ખોખું', true);
    const first = t.coordinator.view().sessionId;
    expect(first).not.toBeNull();
    // The language changes: the hub stops and starts the recognizer again, and its ids start from s1.
    t.hub.setLanguage('hi');
    expect(t.starts).toEqual(['gu', 'hi']);
    const second = t.coordinator.view().sessionId;
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    t.say('नीला डिब्बा', true, 's1', 'hi');
    vi.advanceTimersByTime(300);
    expect(t.lines()).toEqual(['नीला डिब्बा']);
    expect(t.current()).toMatchObject({ sessionId: second, phraseId: 's1', sourceLanguage: 'hi' });
  });

  it('Sanskrit shows in Gujarati letters, as today', () => {
    const t = setup({ language: 'sa' });
    t.flow.start();
    t.say('कखग', true, 's1', 'sa');
    expect(t.lines()).toEqual(['કખગ']);
  });

  it('finals reach the recording draft once, with the glossary’s spelling and their own times; corrections do not', () => {
    const t = setup({ spelling: SPELLING });
    t.flow.start();
    t.say('લીલું ખોખુ', false);
    expect(t.finals).toHaveLength(0);
    t.say('લીલું ખોખુ', true);
    expect(t.finals).toHaveLength(1);
    expect(t.finals[0]).toMatchObject({ id: 's1', final: true, text: 'લીલું ખોખું' });
    const [final] = t.finals;
    expect(final?.words.map((w) => w.text)).toEqual(['લીલું', 'ખોખું']);
    expect(final?.words.at(-1)?.endAt).toBeLessThanOrEqual(final?.endAt ?? Number.NaN);
    expect(t.correct('વાદળી ખોખું')).toBe(true);
    expect(t.finals).toHaveLength(1);
    // Without a glossary, the very phrase the hub gave (as today's feed passes it on).
    const plain = setup();
    plain.flow.start();
    plain.say('લીલું ખોખુ', true);
    expect(plain.finals[0]).toMatchObject({ text: 'લીલું ખોખુ' });
  });

  it('stop takes the captions off at once and closes the session; nothing heard after it shows', () => {
    const t = setup();
    t.flow.start();
    t.say('લીલું ખોખું', true);
    expect(t.lines()).toEqual(['લીલું ખોખું']);
    t.flow.stop();
    expect(t.shown.at(-1)).toBeNull();
    expect(t.coordinator.view()).toMatchObject({ on: false, current: null });
    vi.advanceTimersByTime(10_000);
    expect(t.shown.at(-1)).toBeNull();
  });
});
