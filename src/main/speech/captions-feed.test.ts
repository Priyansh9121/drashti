import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPTION_SETTINGS, type CaptionSettings, type CaptionsShown } from '../../shared/captions';
import type { Heard } from '../../shared/speech';
import { createCaptionsFeed } from './captions-feed';
import { createFakeSpeechHub } from './speech-hub';

/* Live captions from the speech hub to the screens (Part 10): placeholder words only. */

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);

function phrase(id: string, final: boolean, text: string, language: Heard['language'] = 'en') {
  const words = text.split(' ').filter((w) => w !== '');
  const endAt = Date.now() - 1_000;
  const startAt = words.length === 0 ? endAt : endAt - words.length * 400 + 100;
  return {
    id,
    final,
    language,
    languageConfidence: 0.9,
    words: words.map((w, i) => ({
      text: w,
      startAt: startAt + i * 400,
      endAt: startAt + i * 400 + 300,
      confidence: 0.9,
    })),
    text: words.join(' '),
    startAt,
    endAt,
  };
}

function setup(settings: Partial<CaptionSettings> = {}) {
  const hub = createFakeSpeechHub();
  hub.setState({ phase: 'listening', language: 'auto' });
  const shown: (CaptionsShown | null)[] = [];
  const onFinalPhrase = vi.fn();
  const feed = createCaptionsFeed({
    hub,
    show: (c) => shown.push(c),
    onFinalPhrase,
    settings: () => ({ ...DEFAULT_CAPTION_SETTINGS, ...settings }),
    clearAfterMs: 6_000,
    minGapMs: 300,
  });
  const last = () => shown.at(-1) ?? null;
  return { hub, feed, shown, last, onFinalPhrase };
}

describe('live captions from the hub (Part 10)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('show the words as they are heard, partials replaced by their final, then the next phrase below', () => {
    const { hub, feed, last } = setup();
    feed.start();
    hub.say(phrase('s1', false, 'alpha beta'));
    expect(last()).toEqual({
      lines: ['alpha beta'],
      language: 'en',
      audience: false,
      size: 'medium',
      place: 'bottom',
    });
    vi.advanceTimersByTime(400);
    hub.say(phrase('s1', true, 'alpha beta gamma'));
    vi.advanceTimersByTime(400);
    expect(last()?.lines).toEqual(['alpha beta gamma']);
    hub.say(phrase('s2', false, 'delta'));
    vi.advanceTimersByTime(400);
    // The last phrase stays above the new one while it is spoken (roll-up), two lines at most.
    expect(last()?.lines).toEqual(['alpha beta gamma', 'delta']);
  });

  it('offers only settled phrases to the recorder while the captions feed is running', () => {
    const hub = createFakeSpeechHub();
    hub.setState({ phase: 'listening', language: 'auto' });
    const onFinalPhrase = vi.fn();
    const feed = createCaptionsFeed({
      hub,
      show: vi.fn(),
      onFinalPhrase,
      settings: () => DEFAULT_CAPTION_SETTINGS,
    });
    hub.say(phrase('s1', true, 'Before'));
    feed.start();
    hub.say(phrase('s2', false, 'Partial'));
    hub.say(phrase('s2', true, 'Generated placeholder'));
    feed.stop();
    hub.say(phrase('s3', true, 'After'));
    expect(onFinalPhrase).toHaveBeenCalledTimes(1);
    expect(onFinalPhrase).toHaveBeenCalledWith(expect.objectContaining({ text: 'Generated placeholder' }));
  });

  it('writes Sanskrit in Gujarati letters on the screens and in the timed draft', () => {
    const { hub, feed, last, onFinalPhrase } = setup();
    feed.start();
    hub.say(phrase('s1', false, 'कखग', 'sa'));
    expect(last()).toMatchObject({ lines: ['કખગ'], language: 'sa' });
    expect(onFinalPhrase).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    const final = phrase('s1', true, 'कखग १४ ऴ Latin। ક', 'sa');
    hub.say(final);
    const written = ['કખગ', '૧૪', 'ऴ', 'Latin।', 'ક'];
    expect(last()).toMatchObject({ lines: [written.join(' ')], language: 'sa' });
    expect(onFinalPhrase).toHaveBeenCalledTimes(1);
    expect(onFinalPhrase).toHaveBeenCalledWith({
      ...final,
      heardAt: Date.now(),
      text: written.join(' '),
      words: final.words.map((word, index) => ({ ...word, text: written[index] })),
    });

    vi.advanceTimersByTime(400);
    hub.say(phrase('s2', true, 'कखग', 'hi'));
    expect(last()).toMatchObject({ lines: ['कखग'], language: 'hi' });
    expect(onFinalPhrase).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'कखग' }));
  });

  it('change the screens at most every 300 ms (the last change always shown)', () => {
    const { hub, feed, shown, last } = setup();
    feed.start();
    hub.say(phrase('s1', false, 'alpha'));
    hub.say(phrase('s1', false, 'alpha beta'));
    hub.say(phrase('s1', false, 'alpha beta gamma'));
    expect(shown).toHaveLength(1);
    vi.advanceTimersByTime(300);
    expect(shown).toHaveLength(2);
    expect(last()?.lines).toEqual(['alpha beta gamma']);
  });

  it('go a few seconds after the last words, and at once when the hub stops listening', () => {
    const { hub, feed, last } = setup();
    feed.start();
    hub.say(phrase('s1', true, 'alpha'));
    vi.advanceTimersByTime(5_999);
    expect(last()?.lines).toEqual(['alpha']);
    vi.advanceTimersByTime(1);
    expect(last()).toBeNull();
    hub.say(phrase('s2', true, 'beta'));
    vi.advanceTimersByTime(400);
    expect(last()?.lines).toEqual(['beta']);
    hub.setState({ phase: 'held', reason: 'busy' });
    expect(last()).toBeNull();
  });

  it('follow the settings: on the audience only if chosen, the size and place, the line length by size', () => {
    const { hub, feed, last } = setup({ audience: true, size: 'large', place: 'top' });
    feed.start();
    hub.say(phrase('s1', true, 'alpha beta gamma delta epsilon zeta eta theta iota kappa'));
    vi.advanceTimersByTime(400);
    expect(last()).toMatchObject({ audience: true, size: 'large', place: 'top' });
    // Large: 32 letters a line.
    for (const line of last()?.lines ?? []) expect(line.length).toBeLessThanOrEqual(32);
  });

  it('stop listening when stopped, and take the captions off', () => {
    const { hub, feed, last } = setup();
    feed.start();
    hub.say(phrase('s1', true, 'alpha'));
    feed.stop();
    expect(last()).toBeNull();
    // The hub's own fake refuses nothing here: the feed simply no longer listens.
    hub.say(phrase('s2', true, 'beta'));
    vi.advanceTimersByTime(1_000);
    expect(last()).toBeNull();
  });
});
