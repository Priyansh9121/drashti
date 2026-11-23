import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPTION_SETTINGS, type CaptionsShown } from '../../shared/captions';
import type { CaptionRevision, CaptionTranslation, CaptionTranslationPort } from '../../shared/caption-coordinator';
import { CaptionCoordinator } from './caption-coordinator';

function setup(translation?: CaptionTranslationPort) {
  const shown: (CaptionsShown | null)[] = [];
  const coordinator = new CaptionCoordinator({ settings: () => DEFAULT_CAPTION_SETTINGS, show: c => shown.push(c), changed: vi.fn(), ...(translation ? { translation } : {}) });
  const sessionId = coordinator.start();
  const clause = (text: string, revision = 1, status: CaptionRevision['status'] = 'provisional', phraseId = 's1'): CaptionRevision => ({ sessionId, phraseId, revision, sourceLanguage: 'en', targetLanguage: 'hi', sourceText: text, startAt: Date.now() - 1_000, endAt: Date.now(), status });
  return { coordinator, clause, shown, last: () => shown.at(-1) ?? null };
}

function deferredPort() {
  const requests: { clause: Readonly<CaptionRevision>; signal: AbortSignal; resolve: (r: CaptionTranslation) => void }[] = [];
  const translate = vi.fn((clause: Readonly<CaptionRevision>, signal: AbortSignal) => new Promise<CaptionTranslation>(resolve => requests.push({ clause, signal, resolve })));
  const finish = (index: number, text: string, overrides: Partial<CaptionTranslation> = {}) => {
    const request = requests[index]!;
    request.resolve({ sessionId: request.clause.sessionId, phraseId: request.clause.phraseId, revision: request.clause.revision, targetLanguage: 'hi', text, modelId: 'placeholder', routeId: 'placeholder', processingMs: 1, ...overrides });
  };
  return { requests, translate, finish };
}

describe('phase D caption coordinator', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T09:00:00Z')); });
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
    for (const line of last()?.lines ?? []) expect([...line].length).toBeLessThanOrEqual(40);
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
    expect(c.accept({ ...clause('Wrong'), endAt: Date.now() - 11_000, startAt: Date.now() - 12_000 })).toBe(false);
    expect(c.accept(clause('Settled', 1, 'settled'))).toBe(true);
    expect(c.accept(clause('Final again', 2, 'settled'))).toBe(false);
    expect(c.view().current?.sourceText).toBe('Settled');
  });
});
