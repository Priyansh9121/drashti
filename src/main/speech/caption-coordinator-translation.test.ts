import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CaptionRevision,
  CaptionTranslation,
  CaptionTranslationPort,
  CaptionTranslationRequest,
} from '../../shared/caption-coordinator';
import { CAPTION_PAGE_MIN_MS, CAPTION_PAGE_MS_PER_WORD } from '../../shared/caption-translation';
import { DEFAULT_CAPTION_SETTINGS, type CaptionsShown } from '../../shared/captions';
import { CaptionCoordinator, type CaptionSkip } from './caption-coordinator';

/*
 * Translated live captions through the coordinator (alpha.24, QA24-CAPLANG-2, the owner's 2b and 2c): the stage keeps
 * the speaker's own words while the audience screens and the stream show the translation; a long translation is
 * shown as two-line pages, never dropped; a phrase whose translation is late or fails is skipped and counted, and a
 * translation that cannot be shown is never asked for twice. Placeholder words only.
 */

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a value here');
  return value;
}

function deferredPort() {
  const requests: {
    clause: Readonly<CaptionTranslationRequest>;
    resolve: (r: CaptionTranslation) => void;
  }[] = [];
  // As the port must (x89): an abort settles the request at once, as cancelled.
  const translate = vi.fn(
    (clause: Readonly<CaptionTranslationRequest>, signal: AbortSignal) =>
      new Promise<CaptionTranslation>((resolve) => {
        requests.push({ clause, resolve });
        signal.addEventListener('abort', () => {
          resolve({ ...clause, text: '', status: 'cancelled', processingMs: null });
        });
      }),
  );
  const port: CaptionTranslationPort = {
    identity: {
      modelIdentity: 'placeholder@1',
      routeId: 'en-hi-placeholder',
      processorId: 'placeholder@1',
      glossaryRevision: 'none',
    },
    translate,
  };
  const finish = (index: number, text: string, overrides: Partial<CaptionTranslation> = {}) => {
    const request = must(requests[index]);
    request.resolve({ ...request.clause, text, status: 'ok', processingMs: 1, ...overrides });
  };
  return { port, translate, requests, finish };
}

function setup(port: CaptionTranslationPort, target: 'hi' | 'en' = 'hi') {
  const shown: (CaptionsShown | null)[] = [];
  const skips: CaptionSkip[] = [];
  const painted = vi.fn();
  const coordinator = new CaptionCoordinator({
    mayTranslate: () => true,
    clock: () => Date.now(),
    settings: () => DEFAULT_CAPTION_SETTINGS,
    show: (c) => shown.push(c),
    changed: vi.fn(),
    translation: port,
    output: 'translation',
    stage: true,
    pages: true,
    onSkip: (why) => skips.push(why),
    onTranslationShown: painted,
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
    targetLanguage: target,
    sourceText: text,
    startAt: Date.now() - 1_000,
    endAt: Date.now(),
    status,
  });
  return { coordinator, clause, shown, skips, painted, last: () => shown.at(-1) ?? null };
}

describe('translated captions through the coordinator (alpha.24, QA24-CAPLANG-2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T09:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('gives the stage the speaker’s words as heard, and the others the translation once it is ready', async () => {
    const { port, finish } = deferredPort();
    const { coordinator: c, clause, last, painted } = setup(port);
    c.accept(clause('Placeholder words'));
    await vi.advanceTimersByTimeAsync(300);
    // Nothing translated yet: the stage only.
    expect(last()).toMatchObject({
      kind: 'translation',
      language: 'hi',
      lines: [],
      stage: { lines: ['Placeholder words'], language: 'en', fit: true },
    });
    c.accept(clause('Placeholder words heard whole', 2, 'settled'));
    await vi.advanceTimersByTimeAsync(300);
    expect(last()?.stage?.lines).toEqual(['Placeholder words heard whole']);
    expect(last()?.lines).toEqual([]);
    finish(0, 'प्लेसहोल्डर अनुवाद');
    await vi.advanceTimersByTimeAsync(300);
    expect(last()).toMatchObject({
      kind: 'translation',
      language: 'hi',
      lines: ['प्लेसहोल्डर अनुवाद'],
      stage: { lines: ['Placeholder words heard whole'], language: 'en' },
    });
    expect(last()?.page).toBeUndefined();
    expect(painted).toHaveBeenCalledTimes(1);
    // The next phrase being heard: the stage follows it, the translation of the one before stays.
    c.accept(clause('Next placeholder', 1, 'provisional', 's2'));
    await vi.advanceTimersByTimeAsync(300);
    expect(last()).toMatchObject({ lines: ['प्लेसहोल्डर अनुवाद'], stage: { lines: ['Next placeholder'] } });
    // Quiet: both go when their time is up.
    await vi.advanceTimersByTimeAsync(6_500);
    expect(last()).toBeNull();
  });

  it('shows the speaker’s words as today, with no stage band, when the target is the speaker’s own language', async () => {
    const { port, translate } = deferredPort();
    const { coordinator: c, clause, last } = setup(port, 'hi');
    c.accept({ ...clause('Placeholder words', 1, 'settled'), targetLanguage: 'en' });
    await vi.advanceTimersByTimeAsync(300);
    expect(last()).toMatchObject({ lines: ['Placeholder words'], language: 'en' });
    expect(last()?.stage).toBeUndefined();
    expect(last()?.kind).toBeUndefined();
    expect(translate).not.toHaveBeenCalled();
  });

  it('shows a long translation as two-line pages in turn, by reading time, never dropping it', async () => {
    const { port, finish } = deferredPort();
    const { coordinator: c, clause, last, skips } = setup(port);
    c.accept(clause('A long placeholder sentence', 1, 'settled'));
    // 12 words of 6-9 letters: about 3 lines at Medium (40 letters), so two pages.
    const long = 'placeholder sentence number one carries several ordinary words along the bottom line today';
    finish(0, long);
    await vi.advanceTimersByTimeAsync(300);
    const first = must(last());
    expect(first.page).toEqual({ n: 1, of: 2 });
    expect(first.lines).toHaveLength(2);
    const firstWords = first.lines.join(' ').split(' ').length;
    await vi.advanceTimersByTimeAsync(Math.max(CAPTION_PAGE_MIN_MS, firstWords * CAPTION_PAGE_MS_PER_WORD));
    const second = must(last());
    expect(second.page).toEqual({ n: 2, of: 2 });
    expect([...first.lines, ...second.lines].join(' ')).toBe(long);
    expect(skips).toEqual([]);
    expect(c.view().omitted).toBe(0);
  });

  it('skips a translation that cannot be shown at all (a word wider than a line) once, and never asks for it again', async () => {
    const { port, translate, finish } = deferredPort();
    const { coordinator: c, clause, last, skips } = setup(port);
    c.accept(clause('Placeholder words', 1, 'settled'));
    finish(0, 'W'.repeat(60));
    await vi.advanceTimersByTimeAsync(300);
    expect(last()?.lines).toEqual([]);
    expect(skips).toEqual(['unfit']);
    // More of the next phrase heard: the phrase before is still eligible, but is not asked for again (was: twice).
    c.accept(clause('Next placeholder', 1, 'provisional', 's2'));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(c.view().omitted).toBe(1);
  });

  it('counts each skip with its reason: late, failed, or overtaken by the next phrase; never shown late', async () => {
    const { port, finish, requests } = deferredPort();
    const { coordinator: c, clause, last, skips } = setup(port);
    c.accept(clause('First placeholder', 1, 'settled'));
    await vi.advanceTimersByTimeAsync(2_150);
    finish(0, 'देर से');
    await vi.advanceTimersByTimeAsync(300);
    expect(last()?.lines ?? []).toEqual([]);
    expect(skips).toEqual(['late']);
    c.accept(clause('Second placeholder', 1, 'settled', 's2'));
    finish(1, '', { status: 'error' });
    await vi.advanceTimersByTimeAsync(300);
    expect(skips).toEqual(['late', 'failed']);
    c.accept(clause('Third placeholder', 1, 'settled', 's3'));
    // Still in flight when the fourth settles: the third is overtaken.
    c.accept(clause('Fourth placeholder', 1, 'settled', 's4'));
    expect(skips).toEqual(['late', 'failed', 'late']);
    // The overtaken request settles (cancelled) first; then the fourth is asked.
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(4);
    finish(3, 'चौथा');
    await vi.advanceTimersByTimeAsync(300);
    expect(last()?.lines).toEqual(['चौथा']);
    expect(c.view().omitted).toBe(3);
  });
});
