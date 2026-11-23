import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPTION_SETTINGS, type CaptionsShown } from '../../shared/captions';
import type {
  CaptionRevision,
  CaptionTranslation,
  CaptionTranslationPort,
  CaptionTranslationRequest,
} from '../../shared/caption-coordinator';
import { CaptionCoordinator } from './caption-coordinator';

/** The value, or the test stops here with a plain reason (no non-null assertion). */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a value here');
  return value;
}

function setup(translation?: CaptionTranslationPort, output?: 'source' | 'translation') {
  const shown: (CaptionsShown | null)[] = [];
  const coordinator = new CaptionCoordinator({
    mayTranslate: () => true,
    clock: () => Date.now(),
    settings: () => DEFAULT_CAPTION_SETTINGS,
    show: (c) => shown.push(c),
    changed: vi.fn(),
    ...(translation ? { translation } : {}),
    ...(output ? { output } : {}),
  });
  const sessionId = coordinator.start();
  const clause = (
    text: string,
    revision = 1,
    status: CaptionRevision['status'] = 'provisional',
    phraseId = 's1',
  ): CaptionRevision => ({
    sessionId,
    phraseId,
    revision,
    sourceLanguage: 'en',
    targetLanguage: 'hi',
    sourceText: text,
    startAt: Date.now() - 1_000,
    endAt: Date.now(),
    status,
  });
  return { coordinator, clause, shown, last: () => shown.at(-1) ?? null };
}

function deferredPort() {
  const requests: {
    clause: Readonly<CaptionTranslationRequest>;
    signal: AbortSignal;
    resolve: (r: CaptionTranslation) => void;
  }[] = [];
  const translate = vi.fn(
    (clause: Readonly<CaptionTranslationRequest>, signal: AbortSignal) =>
      new Promise<CaptionTranslation>((resolve) => requests.push({ clause, signal, resolve })),
  );
  const finish = (index: number, text: string, overrides: Partial<CaptionTranslation> = {}) => {
    const request = must(requests[index]);
    request.resolve({ ...request.clause, text, status: 'ok', processingMs: 1, ...overrides });
  };
  return {
    requests,
    translate,
    finish,
    identity: {
      modelIdentity: 'placeholder@1',
      routeId: 'en-hi-placeholder',
      processorId: 'placeholder@1',
      glossaryRevision: 'none',
    },
  };
}

describe('phase D caption coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T09:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('replaces a provisional clause atomically; rejects old revisions and rolled-away phrases', () => {
    const { coordinator: c, clause, last } = setup();
    expect(c.accept(clause('The blue box'))).toBe(true);
    expect(last()?.lines).toEqual(['The blue box']);
    expect(c.accept(clause('The green box', 2, 'settled'))).toBe(true);
    vi.advanceTimersByTime(300);
    expect(last()?.lines).toEqual(['The green box']);
    expect(c.accept(clause('The blue box', 1))).toBe(false);
    expect(c.correct({ ...clause(''), text: 'The red box', revision: 2 })).toBe(true);
    vi.advanceTimersByTime(300);
    expect(last()?.lines).toEqual(['The red box']);
    expect(c.view().current).toMatchObject({ status: 'corrected', revision: 3 });
    c.accept(clause('A round shape', 1, 'settled', 's2'));
    expect(c.correct({ ...clause(''), revision: 3, text: 'Old clause' })).toBe(false);
    expect(c.accept(clause('Old clause', 10))).toBe(false);
    vi.advanceTimersByTime(300);
    expect(last()?.lines).toEqual(['A round shape']);
    expect(c.view().previous?.phraseId).toBe('s1');
  });

  it('invalidates on stop/restart, including repeated phrase ids and late pending redraws', () => {
    const { coordinator: c, clause, last } = setup();
    const old = clause('Old session');
    c.accept(old);
    c.accept({ ...old, revision: 2, sourceText: 'Queued old words' });
    c.stop();
    expect(c.view()).toMatchObject({ on: false, current: null, previous: null });
    const sessionId = c.start();
    expect(sessionId).not.toBe(old.sessionId);
    expect(c.accept(old)).toBe(false);
    c.accept({ ...old, sessionId, sourceText: 'New session' });
    vi.advanceTimersByTime(300);
    expect(last()?.lines).toEqual(['New session']);
  });

  it('bounds output to two lines even for an unbroken word; expires without replay on correction/settings', () => {
    const { coordinator: c, clause, last } = setup();
    c.accept(clause('x'.repeat(300), 1, 'settled'));
    expect(last()?.lines.length).toBeLessThanOrEqual(2);
    for (const line of last()?.lines ?? []) expect(Array.from(line).length).toBeLessThanOrEqual(40);
    vi.advanceTimersByTime(6_000);
    expect(last()).toBeNull();
    expect(c.correct({ ...clause(''), text: 'Too late' })).toBe(false);
    c.refresh();
    expect(last()).toBeNull();
  });

  it('dismisses immediately, invalidating queued paint and refusing a stale correction', () => {
    const { coordinator: c, clause, last } = setup();
    c.accept(clause('A blue shape', 1, 'settled'));
    c.correct({ ...clause(''), text: 'A green shape' });
    expect(c.dismiss({ ...clause(''), revision: 2 })).toBe(true);
    vi.advanceTimersByTime(300);
    expect(last()).toBeNull();
    expect(c.correct({ ...clause(''), revision: 2, text: 'Old edit' })).toBe(false);
  });

  it('hands only stable clauses to one translation request, then only the newest correction', async () => {
    const port = deferredPort();
    const { coordinator: c, clause } = setup(port);
    c.accept(clause('A blue box'));
    expect(port.requests).toHaveLength(0);
    c.accept(clause('A blue box', 2, 'settled'));
    expect(port.requests).toHaveLength(1);
    c.correct({ ...clause(''), revision: 2, text: 'A green box' });
    c.correct({ ...clause(''), revision: 3, text: 'A red box' });
    expect(port.requests[0]?.signal.aborted).toBe(true);
    expect(port.requests).toHaveLength(1);
    port.finish(0, 'Old translation');
    await vi.advanceTimersByTimeAsync(0);
    expect(port.requests).toHaveLength(2);
    expect(port.requests[1]?.clause).toMatchObject({ revision: 4, sourceText: 'A red box' });
    c.stop();
    expect(port.requests[1]?.signal.aborted).toBe(true);
    port.finish(1, 'Late translation');
    await vi.advanceTimersByTimeAsync(300);
    expect(c.view().current).toBeNull();
  });

  it('rejects malformed, stale and final-again source envelopes without retaining their words', () => {
    const { coordinator: c, clause } = setup();
    expect(c.accept({ ...clause('Wrong'), endAt: NaN })).toBe(false);
    expect(c.accept({ ...clause('Wrong'), startAt: Date.now() + 1 })).toBe(false);
    expect(c.accept({ ...clause('Wrong'), endAt: Date.now() - 11_000, startAt: Date.now() - 12_000 })).toBe(
      false,
    );
    expect(c.accept(clause('Settled', 1, 'settled'))).toBe(true);
    expect(c.accept(clause('Final again', 2, 'settled'))).toBe(false);
    expect(c.view().current?.sourceText).toBe('Settled');
  });
  it('publishes only matching translated revisions and replaces a corrected translation whole', async () => {
    const port = deferredPort();
    const { coordinator: c, clause, last } = setup(port, 'translation');
    c.accept(clause('A blue box', 1, 'settled'));
    expect(last()).toBeNull();
    port.finish(0, 'पहला नमूना');
    await vi.advanceTimersByTimeAsync(300);
    expect(last()).toMatchObject({ lines: ['पहला नमूना'], language: 'hi' });
    expect(c.correct({ ...clause(''), text: 'A green box' })).toBe(true);
    expect(last()).toBeNull();
    port.finish(1, 'दूसरा नमूना');
    await vi.advanceTimersByTimeAsync(300);
    expect(last()?.lines).toEqual(['दूसरा नमूना']);
    c.accept(clause('Next provisional', 1, 'provisional', 's2'));
    await vi.advanceTimersByTimeAsync(300);
    expect(last()?.lines).toEqual(['दूसरा नमूना']);
    c.accept(clause('Next stable', 2, 'settled', 's2'));
    port.finish(2, 'Wrong target', { targetLanguage: 'en' });
    await vi.advanceTimersByTimeAsync(300);
    expect(last()?.lines).toEqual(['दूसरा नमूना']);
  });

  it('never repaints a late translation after expiry or dismissal, and contains a failed port', async () => {
    const port = deferredPort();
    const { coordinator: c, clause, last } = setup(port, 'translation');
    c.accept(clause('A blue box', 1, 'settled'));
    vi.advanceTimersByTime(6_000);
    port.finish(0, 'Expired words');
    await vi.advanceTimersByTimeAsync(300);
    expect(last()).toBeNull();
    c.accept(clause('A green box', 1, 'settled', 's2'));
    c.dismiss(clause('', 1, 'settled', 's2'));
    port.finish(1, 'Dismissed words');
    await vi.advanceTimersByTimeAsync(300);
    expect(last()).toBeNull();
    const failed = setup(
      {
        identity: port.identity,
        translate: () => {
          throw new Error('Placeholder failure');
        },
      },
      'translation',
    );
    expect(() => failed.coordinator.accept(failed.clause('A round shape', 1, 'settled'))).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(failed.coordinator.view()).toMatchObject({ busy: false, omitted: 1 });
    expect(failed.last()).toBeNull();
  });

  it('does not extend the original clear time when an operator corrects a clause', () => {
    const { coordinator: c, clause, last } = setup();
    c.accept(clause('A blue box', 1, 'settled'));
    vi.advanceTimersByTime(5_500);
    c.correct({ ...clause(''), text: 'A green box' });
    vi.advanceTimersByTime(500);
    expect(last()).toBeNull();
  });

  it('uses the original earlier paint deadline and validates the complete retained request identity', async () => {
    const port = deferredPort();
    const { coordinator: c, clause, last } = setup(port, 'translation');
    c.accept(clause('A blue box', 1, 'settled'));
    const request = must(port.requests[0]).clause;
    expect(request).toMatchObject({
      protocolVersion: 1,
      sourceKind: 'speech-clause',
      clauseId: 's1',
      clauseSequence: 1,
      paintDeadlineAt: Date.now() + 2_500,
      clearAt: Date.now() + 6_000,
    });
    expect(request.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(request.requestId).not.toBe(request.sessionId);
    vi.advanceTimersByTime(1_000);
    c.correct({ ...clause(''), text: 'A green box' });
    port.finish(0, 'Old result');
    await vi.advanceTimersByTimeAsync(0);
    expect(must(port.requests[1]).clause.paintDeadlineAt).toBe(request.paintDeadlineAt);
    expect(must(port.requests[1]).clause.sourceHash).not.toBe(request.sourceHash);
    expect(must(port.requests[1]).clause.requestId).not.toBe(request.requestId);
    port.finish(1, 'Wrong model', { modelIdentity: 'wrong@1' });
    await vi.advanceTimersByTimeAsync(300);
    expect(last()).toBeNull();
  });

  it('rejects results at the reserved paint cutoff and counts an omitted translation', async () => {
    const port = deferredPort();
    const { coordinator: c, clause, last } = setup(port, 'translation');
    c.accept(clause('A blue box', 1, 'settled'));
    vi.advanceTimersByTime(2_150);
    port.finish(0, 'Too late to paint');
    await vi.advanceTimersByTimeAsync(300);
    expect(last()).toBeNull();
    expect(c.view().omitted).toBe(1);
  });

  it('bounds source by UTF-8 bytes rather than JavaScript string length', () => {
    const { coordinator: c, clause } = setup();
    expect(c.accept(clause('ક'.repeat(1_366), 1, 'settled'))).toBe(false);
    expect(c.view().current).toBeNull();
  });

  it('keeps an operator correction pinned against later automatic changes', () => {
    const { coordinator: c, clause } = setup();
    c.accept(clause('A blue box', 1, 'settled'));
    c.correct({ ...clause(''), text: 'A green box' });
    expect(c.reviseAutomatic(clause('A red box', 3, 'corrected'))).toBe(false);
    expect(c.view().current).toMatchObject({ revision: 2, sourceText: 'A green box' });
  });

  it('revises the still-eligible settled prefix without replaying it over the next provisional source', () => {
    const { coordinator: c, clause, last } = setup();
    c.accept(clause('A blue box', 1, 'settled'));
    c.accept(clause('Next provisional words', 1, 'provisional', 's2'));
    expect(c.reviseAutomatic(clause('A green box', 2, 'corrected'))).toBe(true);
    vi.advanceTimersByTime(300);
    expect(last()?.lines).toEqual(['Next provisional words']);
    expect(c.view().previous).toMatchObject({ revision: 2, sourceText: 'A green box' });
  });

  it('cancels on a background hold and resumes with a new generation and the original deadline', async () => {
    const port = deferredPort();
    const { coordinator: c, clause, last } = setup(port, 'translation');
    c.accept(clause('A blue box', 1, 'settled'));
    const first = must(port.requests[0]).clause;
    c.setTranslationHeld(true);
    expect(must(port.requests[0]).signal.aborted).toBe(true);
    expect(last()).toBeNull();
    c.setTranslationHeld(false);
    expect(port.requests).toHaveLength(1);
    port.finish(0, 'Cancelled generation');
    await vi.advanceTimersByTimeAsync(0);
    const second = must(port.requests[1]).clause;
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(second.requestId).not.toBe(first.requestId);
    expect(second.paintDeadlineAt).toBe(first.paintDeadlineAt);
    port.finish(1, 'नमूना');
    await vi.advanceTimersByTimeAsync(300);
    expect(last()?.lines).toEqual(['नमूना']);
  });

  it('requires an explicit background lease before a connected translation port can run', () => {
    const port = deferredPort();
    const { clause } = setup();
    const c = new CaptionCoordinator({
      clock: () => Date.now(),
      settings: () => DEFAULT_CAPTION_SETTINGS,
      show: vi.fn(),
      changed: vi.fn(),
      translation: port,
    });
    const sessionId = c.start();
    c.accept({ ...clause('A blue box', 1, 'settled'), sessionId });
    expect(port.requests).toHaveLength(0);
    expect(c.view().current?.sourceText).toBe('A blue box');
    c.stop();
  });

  it('does not retry an unchanged failed stable clause when more provisional words arrive', async () => {
    const port = deferredPort();
    const { coordinator: c, clause } = setup(port);
    c.accept(clause('A blue box', 1, 'settled'));
    port.finish(0, '', { status: 'error' });
    await vi.advanceTimersByTimeAsync(0);
    c.accept(clause('More source words', 1, 'provisional', 's2'));
    c.accept(clause('More source words arrive', 2, 'provisional', 's2'));
    expect(port.requests).toHaveLength(1);
    expect(c.view().current?.sourceText).toBe('More source words arrive');
  });

  it('starts pending stable work when the authoritative lease explicitly opens', () => {
    const port = deferredPort();
    let allowed = false;
    const c = new CaptionCoordinator({
      clock: () => Date.now(),
      mayTranslate: () => allowed,
      settings: () => DEFAULT_CAPTION_SETTINGS,
      show: vi.fn(),
      changed: vi.fn(),
      translation: port,
    });
    const sessionId = c.start();
    c.accept({
      sessionId,
      phraseId: 's1',
      revision: 1,
      sourceLanguage: 'en',
      targetLanguage: 'hi',
      sourceText: 'A blue box',
      startAt: Date.now(),
      endAt: Date.now(),
      status: 'settled',
    });
    expect(port.requests).toHaveLength(0);
    allowed = true;
    c.setTranslationHeld(false);
    expect(port.requests).toHaveLength(1);
    c.stop();
  });
  it('requires a new session for a source/target change and rejects unsupported AI languages', () => {
    const { coordinator: c, clause } = setup();
    expect(c.accept({ ...clause('Unsupported'), sourceLanguage: 'sa' })).toBe(false);
    expect(c.accept(clause('A blue box', 1, 'settled'))).toBe(true);
    expect(c.accept({ ...clause('A green box', 1, 'settled', 's2'), sourceLanguage: 'gu' })).toBe(false);
    const sessionId = c.start();
    expect(c.accept({ ...clause('A green box', 1, 'settled'), sessionId, sourceLanguage: 'gu' })).toBe(true);
  });

  it('retains its own immutable parent range rather than a caller-mutable reference', () => {
    const { coordinator: c, clause } = setup();
    const input = {
      ...clause('A blue box'),
      parent: {
        enginePhraseId: 's1',
        observationSequence: 1,
        rangeStart: 0,
        rangeEnd: 10,
        timingPrecision: 'phrase' as const,
      },
    };
    c.accept(input);
    input.parent.rangeStart = 5;
    expect(c.view().current?.parent?.rangeStart).toBe(0);
  });

  it('invalidates the output-policy epoch before applying a new audience choice', async () => {
    const port = deferredPort();
    let audience = true;
    const c = new CaptionCoordinator({
      clock: () => Date.now(),
      mayTranslate: () => true,
      settings: () => ({ ...DEFAULT_CAPTION_SETTINGS, audience }),
      show: vi.fn(),
      changed: vi.fn(),
      translation: port,
      output: 'translation',
    });
    const sessionId = c.start();
    c.accept({
      sessionId,
      phraseId: 's1',
      revision: 1,
      sourceLanguage: 'en',
      targetLanguage: 'hi',
      sourceText: 'A blue box',
      startAt: Date.now(),
      endAt: Date.now(),
      status: 'settled',
    });
    const first = must(port.requests[0]).clause;
    audience = false;
    c.refresh();
    expect(must(port.requests[0]).signal.aborted).toBe(true);
    port.finish(0, 'Old audience policy');
    await vi.advanceTimersByTimeAsync(0);
    expect(must(port.requests[1]).clause.outputPolicyEpoch).toBeGreaterThan(first.outputPolicyEpoch);
    expect(must(port.requests[1]).clause.paintDeadlineAt).toBe(first.paintDeadlineAt);
    c.stop();
  });

  it('keeps showing phrases when the wall clock steps during a session (the production clock, performance.now)', () => {
    // Heard times are Date.now(); the coordinator's own clock is monotonic. A time sync (or a Mac waking from
    // sleep) moves one against the other mid-session: phrases must still show (review M1).
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    vi.setSystemTime(new Date('2026-11-23T09:00:00Z'));
    // A minute into the run on both clocks (a fresh test worker's performance.now() is under a phrase's length).
    vi.advanceTimersByTime(60_000);
    const shown: (CaptionsShown | null)[] = [];
    const c = new CaptionCoordinator({
      mayTranslate: () => false,
      settings: () => DEFAULT_CAPTION_SETTINGS,
      show: (s) => shown.push(s),
      changed: vi.fn(),
    });
    const sessionId = c.start();
    const phrase = (phraseId: string, sourceText: string): CaptionRevision => ({
      sessionId,
      phraseId,
      revision: 1,
      sourceLanguage: 'gu',
      targetLanguage: 'en',
      sourceText,
      startAt: Date.now() - 1_000,
      endAt: Date.now(),
      status: 'settled',
    });
    expect(c.accept(phrase('s1', 'The blue box'))).toBe(true);
    expect(shown.at(-1)?.lines).toEqual(['The blue box']);
    vi.setSystemTime(Date.now() + 2_000);
    expect(c.accept(phrase('s2', 'A round shape'))).toBe(true);
    vi.advanceTimersByTime(300);
    expect(shown.at(-1)?.lines).toEqual(['A round shape']);
    vi.setSystemTime(Date.now() - 15_000);
    expect(c.accept(phrase('s3', 'The green box'))).toBe(true);
    vi.advanceTimersByTime(300);
    expect(shown.at(-1)?.lines).toEqual(['The green box']);
    c.stop();
  });

  it('shows a correction for its own full time, from when it was made (review S1)', () => {
    const { coordinator: c, clause, last } = setup();
    expect(c.accept(clause('The blue box', 1, 'settled'))).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(c.correct({ ...clause(''), text: 'The red box', revision: 1 })).toBe(true);
    vi.advanceTimersByTime(3_000);
    expect(last()?.lines).toEqual(['The red box']);
    vi.advanceTimersByTime(3_100);
    expect(last()).toBeNull();
  });
});
