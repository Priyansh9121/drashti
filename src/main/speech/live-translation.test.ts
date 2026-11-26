import { describe, expect, it, vi, type Mock } from 'vitest';
import type { CaptionTranslationRequest } from '../../shared/caption-coordinator';
import { TRANSLATION_STOP_AFTER_LATE } from '../../shared/caption-translation';
import type { TranslationLanguage } from '../../shared/prepared-translations';
import { HelperError } from '../translation/translation-helper';
import { LiveTranslation, type LiveTranslationEngine } from './live-translation';

/*
 * The coordinator's translation slot (alpha.24, QA24-CAPLANG-2): each settled phrase translated greedily by its own
 * translation engine (the pack's IndicTrans2), the spoken-times seam applied first, an abort answered at once, a
 * failure answered as an error with the engine's fault kept in plain words; skips counted, and after
 * TRANSLATION_STOP_AFTER_LATE late ones in a row translated captions stop on this computer, saying so (2f), never
 * switching the screens to the speaker's language. Placeholder words only.
 */

/** A stand-in engine; its spies are kept beside it (eslint's unbound-method: never a method taken off it). */
const spies = new WeakMap<LiveTranslationEngine, { translate: Mock; prepare: Mock; stop: Mock }>();
function fakeEngine(overrides: Partial<LiveTranslationEngine> = {}) {
  const translate = vi.fn((source: string, from: TranslationLanguage, to: TranslationLanguage) =>
    Promise.resolve(`[${from}>${to}] ${source}`),
  );
  const prepare = vi.fn(() => Promise.resolve());
  const stop = vi.fn();
  const engine: LiveTranslationEngine = {
    installed: () => true,
    available: () => true,
    unknownModel: () => false,
    prepare,
    translate,
    stop,
    ...overrides,
  };
  spies.set(engine, { translate, prepare, stop });
  return engine;
}
const spy = (engine: LiveTranslationEngine) => {
  const s = spies.get(engine);
  if (!s) throw new Error('Not a stand-in engine');
  return s;
};

function request(
  text: string,
  overrides: Partial<CaptionTranslationRequest> = {},
): CaptionTranslationRequest {
  return {
    sessionId: 'session-1',
    phraseId: 's1',
    revision: 2,
    sourceLanguage: 'gu',
    targetLanguage: 'hi',
    sourceText: text,
    startAt: 1,
    endAt: 2,
    status: 'settled',
    modelIdentity: 'indictrans2-dist-int8',
    routeId: 'live-greedy',
    processorId: 'indictrans-text',
    glossaryRevision: 'none',
    protocolVersion: 1,
    inputEpoch: 'epoch-1',
    generation: 3,
    clauseId: 's1',
    clauseSequence: 1,
    sourceHash: 'a'.repeat(64),
    requestId: 'request-1',
    sourceKind: 'speech-clause',
    outputPolicyEpoch: 1,
    asrIdentity: 'placeholder-recognizer/v1',
    firstSettledAt: 2,
    paintDeadlineAt: 2_502,
    clearAt: 6_002,
    ...overrides,
  };
}

const log = { info: vi.fn(), warn: vi.fn() };

describe('live translation for captions (alpha.24, QA24-CAPLANG-2)', () => {
  it('translates the settled words after the spoken-times seam, echoing the request whole', async () => {
    const engine = fakeEngine();
    const spokenTimes = vi.fn((text: string) => text.replace('placeholder time', '8:15'));
    const live = new LiveTranslation({ engine, spokenTimes, log });
    live.begin('gu', 'hi');
    const reply = await live.translate(request('placeholder time words'), new AbortController().signal);
    expect(spokenTimes).toHaveBeenCalledWith('placeholder time words', 'gu');
    expect(spy(engine).translate).toHaveBeenCalledWith('8:15 words', 'gu', 'hi');
    expect(reply).toMatchObject({
      status: 'ok',
      text: '[gu>hi] 8:15 words',
      requestId: 'request-1',
      sessionId: 'session-1',
      generation: 3,
      sourceHash: 'a'.repeat(64),
      modelIdentity: 'indictrans2-dist-int8',
    });
    expect(reply.processingMs).toBeGreaterThanOrEqual(0);
    expect(live.identity).toEqual({
      modelIdentity: 'indictrans2-dist-int8',
      routeId: 'live-greedy',
      processorId: 'indictrans-text',
      glossaryRevision: 'none',
    });
  });

  it('answers an abort at once as cancelled, even while the engine is still working', async () => {
    let finish: (text: string) => void = () => undefined;
    const engine = fakeEngine({
      translate: vi.fn(() => new Promise<string>((resolve) => (finish = resolve))),
    });
    const live = new LiveTranslation({ engine, log });
    live.begin('gu', 'hi');
    const abort = new AbortController();
    const pending = live.translate(request('placeholder words'), abort.signal);
    abort.abort();
    await expect(pending).resolves.toMatchObject({ status: 'cancelled', text: '' });
    finish('late words');
    // Never stops the helper for it (a restart costs about a second): the next phrase goes on the same model.
    expect(spy(engine).stop).not.toHaveBeenCalled();
  });

  it('answers a failure as an error with no words, and keeps the engine’s fault for the dialog', async () => {
    const changed = vi.fn();
    const engine = fakeEngine({
      translate: vi.fn(() =>
        Promise.reject(new HelperError('ended', 'The translation engine stopped. Placeholder reason.')),
      ),
    });
    const live = new LiveTranslation({ engine, log, changed });
    live.begin('gu', 'hi');
    const reply = await live.translate(request('placeholder words'), new AbortController().signal);
    expect(reply).toMatchObject({ status: 'error', text: '' });
    expect(live.status('gu', 'hi', false).fault).toBe('The translation engine stopped. Placeholder reason.');
    expect(changed).toHaveBeenCalled();
    // A model that failed to load when captions started is a fault too.
    const loads = new LiveTranslation({
      engine: fakeEngine({ prepare: vi.fn(() => Promise.reject(new Error('Placeholder load fault.'))) }),
      log,
    });
    loads.begin('hi', 'en');
    await vi.waitFor(() => {
      expect(loads.status('hi', 'en', false).fault).toBe('Placeholder load fault.');
    });
  });

  it('counts skips, and stops after late ones in a row (2f): no more asks, the reason said, never another language', () => {
    const changed = vi.fn();
    const live = new LiveTranslation({ engine: fakeEngine(), log, changed });
    live.begin('gu', 'hi');
    expect(live.may()).toBe(true);
    live.skipped('failed');
    live.skipped('late');
    live.shown();
    for (let i = 1; i < TRANSLATION_STOP_AFTER_LATE; i++) live.skipped('late');
    expect(live.may()).toBe(true);
    expect(live.status('gu', 'hi', false)).toMatchObject({ skipped: 4, fault: null, unavailable: null });
    live.skipped('late');
    expect(live.may()).toBe(false);
    expect(live.status('gu', 'hi', false)).toMatchObject({
      target: 'hi',
      skipped: 5,
      unavailable: 'too-slow',
      offered: false,
    });
    expect(live.status('gu', 'hi', false).fault).toMatch(/too slow/u);
    expect(changed).toHaveBeenCalled();
    // Captions started again: counted afresh.
    live.begin('gu', 'hi');
    expect(live.may()).toBe(true);
    expect(live.status('gu', 'hi', false)).toMatchObject({ skipped: 0, fault: null, unavailable: null });
  });

  it('asks nothing before captions start translating, and lets the model go when they stop', () => {
    const engine = fakeEngine();
    const live = new LiveTranslation({ engine, log });
    expect(live.may()).toBe(false);
    live.begin('en', 'gu');
    expect(spy(engine).prepare).toHaveBeenCalledWith('en', 'gu');
    expect(live.may()).toBe(true);
    live.end();
    expect(live.may()).toBe(false);
    expect(spy(engine).stop).toHaveBeenCalledTimes(1);
  });

  it('says why it cannot translate here: no engine, no pack, an unknown model, as heard, Sanskrit, too slow', () => {
    const status = (
      engine: LiveTranslationEngine,
      speaker: 'gu' | 'auto' | 'sa',
      target: 'hi' | 'same',
      slow = false,
    ) => new LiveTranslation({ engine, log }).status(speaker, target, slow);
    expect(status(fakeEngine(), 'gu', 'hi')).toMatchObject({
      target: 'hi',
      offered: true,
      unavailable: null,
    });
    expect(status(fakeEngine({ installed: () => false }), 'gu', 'hi')).toMatchObject({
      offered: false,
      unavailable: 'no-engine',
    });
    expect(status(fakeEngine({ available: () => false }), 'gu', 'hi')).toMatchObject({
      offered: false,
      unavailable: 'no-pack',
    });
    expect(
      status(fakeEngine({ available: () => false, unknownModel: () => true }), 'gu', 'hi'),
    ).toMatchObject({
      offered: false,
      unavailable: 'unknown-model',
    });
    expect(status(fakeEngine(), 'auto', 'hi')).toMatchObject({
      target: null,
      offered: false,
      unavailable: 'speaker-as-heard',
    });
    expect(status(fakeEngine(), 'sa', 'hi')).toMatchObject({
      target: null,
      offered: false,
      unavailable: 'speaker-sanskrit',
    });
    // 2f: where live captions stopped as too slow, translated captions are not offered.
    expect(status(fakeEngine(), 'gu', 'hi', true)).toMatchObject({ offered: false, unavailable: 'too-slow' });
    // "Same as the speaker": offered when the other two can be had, nothing to say otherwise.
    expect(status(fakeEngine(), 'gu', 'same')).toMatchObject({
      target: null,
      offered: true,
      unavailable: null,
    });
    expect(status(fakeEngine({ available: () => false }), 'gu', 'same')).toMatchObject({
      target: null,
      offered: false,
      unavailable: 'no-pack',
    });
    expect(status(fakeEngine(), 'auto', 'same')).toMatchObject({
      offered: false,
      unavailable: 'speaker-as-heard',
    });
  });

  it('offers translation by this computer alone, the same whatever "Captions in" says (lead 2, contract)', () => {
    const live = new LiveTranslation({ engine: fakeEngine(), log });
    for (const target of ['same', 'gu', 'hi', 'en'] as const)
      expect(live.status('gu', target, false)).toMatchObject({ offered: true, unavailable: null });
    // A pack without one of the other two: not offered, whichever is chosen.
    const half = new LiveTranslation({
      engine: fakeEngine({ available: (_from, to) => to === 'hi' }),
      log,
    });
    for (const target of ['same', 'hi', 'en'] as const)
      expect(half.status('gu', target, false)).toMatchObject({ offered: false, unavailable: 'no-pack' });
  });

  it('takes the engine stopping or failing as not offered, with why and the fault; one phrase too long is only that phrase', async () => {
    const changed = vi.fn();
    let fail: Error = new HelperError('too-long', 'This text is too long for one translation.');
    const engine = fakeEngine({ translate: vi.fn(() => Promise.reject(fail)) });
    const live = new LiveTranslation({ engine, log, changed });
    live.begin('gu', 'hi');
    await live.translate(request('placeholder words'), new AbortController().signal);
    expect(live.status('gu', 'hi', false)).toMatchObject({ offered: true, unavailable: null });
    expect(live.may()).toBe(true);
    fail = new HelperError('ended', 'The translation engine stopped. Placeholder reason.');
    await live.translate(request('placeholder words'), new AbortController().signal);
    expect(live.status('gu', 'hi', false)).toMatchObject({
      offered: false,
      unavailable: 'engine-fault',
      fault: 'The translation engine stopped. Placeholder reason.',
    });
    expect(live.may()).toBe(false);
    // The operator chooses again (or captions start again): tried once more.
    live.retry();
    expect(live.may()).toBe(true);
    expect(live.status('gu', 'hi', false)).toMatchObject({ offered: true, unavailable: null, fault: null });
    // A model that fails to load when captions start is the engine's fault too.
    const loads = new LiveTranslation({
      engine: fakeEngine({
        prepare: vi.fn(() => Promise.reject(new HelperError('not-installed', 'Placeholder not installed.'))),
      }),
      log,
    });
    loads.begin('hi', 'en');
    await vi.waitFor(() => {
      expect(loads.status('hi', 'en', false)).toMatchObject({ offered: false, unavailable: 'engine-fault' });
    });
    // After captions stop, the engine's own stop is no fault.
    const ends = new LiveTranslation({
      engine: fakeEngine({ translate: vi.fn(() => Promise.reject(new HelperError('ended', 'Stopped.'))) }),
      log,
    });
    ends.begin('gu', 'hi');
    const pending = ends.translate(request('placeholder words'), new AbortController().signal);
    ends.end();
    await pending;
    expect(ends.status('gu', 'hi', false)).toMatchObject({ offered: true, fault: null });
  });

  it('forgets a stop for slowness when the operator chooses again', () => {
    const live = new LiveTranslation({ engine: fakeEngine(), log });
    live.begin('gu', 'hi');
    for (let i = 0; i < TRANSLATION_STOP_AFTER_LATE; i++) live.skipped('late');
    expect(live.may()).toBe(false);
    live.retry();
    expect(live.may()).toBe(true);
    expect(live.status('gu', 'hi', false)).toMatchObject({ offered: true, unavailable: null, fault: null });
  });
});
