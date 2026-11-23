import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPTION_SETTINGS, type CaptionsShown } from '../../shared/captions';
import { CaptionPrototype } from './caption-prototype';

function setup() {
  const shown: (CaptionsShown | null)[] = [];
  const p = new CaptionPrototype({
    settings: () => DEFAULT_CAPTION_SETTINGS,
    show: (c) => shown.push(c),
    changed: vi.fn(),
  });
  return { p, shown, last: () => shown.at(-1) ?? null };
}

describe('manual placeholder recognizer prototype', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T09:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());
  it('starts off, advances only on operator action, and revises a partial with a settled clause', () => {
    const { p, last } = setup();
    p.advance();
    expect(p.view().on).toBe(false);
    expect(last()).toBeNull();
    p.setOn(true);
    expect(p.view().on).toBe(true);
    expect(p.view().current).toBeNull();
    p.advance();
    expect(p.view().current).toMatchObject({
      phraseId: 's1',
      revision: 1,
      sourceText: 'The blue box',
      status: 'provisional',
    });
    p.advance();
    vi.advanceTimersByTime(300);
    expect(last()?.lines).toEqual(['The green box is beside a round shape.']);
    expect(p.view().current).toMatchObject({ phraseId: 's1', revision: 2, status: 'settled' });
    vi.advanceTimersByTime(1_000);
    expect(p.view().current?.phraseId).toBe('s1');
    p.setOn(false);
    expect(last()).toBeNull();
    expect(p.view()).toMatchObject({ current: null, previous: null, sessionId: null });
  });
  it('discards an edit open across restart or switch off and never replays a rolled-away clause', () => {
    const { p, last } = setup();
    p.setOn(true);
    p.advance();
    p.advance();
    const old = p.view().current!;
    p.restart();
    expect(p.view().sessionId).not.toBe(old.sessionId);
    p.advance();
    p.advance();
    expect(p.correct({ ...old, text: 'Stale edit' })).toBe(false);
    const current = p.view().current!;
    expect(p.correct({ ...current, text: 'The red box is still.' })).toBe(true);
    vi.advanceTimersByTime(300);
    expect(last()?.lines).toEqual(['The red box is still.']);
    p.advance();
    p.advance();
    expect(p.correct({ ...current, revision: current.revision + 1, text: 'Rolled away' })).toBe(false);
    p.setOn(false);
    expect(last()).toBeNull();
  });
});

it('passes recognizer observations through the scalar-range stabilizer', () => {
  const { p } = setup();
  p.setOn(true);
  p.advance();
  expect(p.view().current?.parent).toMatchObject({
    enginePhraseId: 's1',
    observationSequence: 1,
    rangeStart: 0,
    rangeEnd: 12,
    timingPrecision: 'phrase',
  });
  p.advance();
  expect(p.view().current?.parent).toMatchObject({
    enginePhraseId: 's1',
    observationSequence: 2,
    rangeStart: 0,
    rangeEnd: 37,
    timingPrecision: 'phrase',
  });
  p.setOn(false);
});

it('treats a later manual update as a fresh synthetic event without pretending to capture the waiting interval', () => {
  vi.useFakeTimers();
  try {
    const { p, last } = setup();
    p.setOn(true);
    p.advance();
    vi.advanceTimersByTime(12_001);
    expect(last()).toBeNull();
    p.advance();
    expect(p.view().on).toBe(true);
    expect(p.view().current?.status).toBe('settled');
    expect(p.view().current!.endAt - p.view().current!.startAt).toBeLessThanOrEqual(1_000);
    p.setOn(false);
  } finally { vi.useRealTimers(); }
});
