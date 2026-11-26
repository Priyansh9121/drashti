import { describe, expect, it } from 'vitest';
import {
  CAPTION_LINE_CHARS,
  captionLines,
  captionsFor,
  DEFAULT_CAPTION_SETTINGS,
  DEFAULT_CAPTION_TIMING,
  parseCaptionSettings,
  parseCaptionTiming,
  type CaptionsShown,
} from './captions';

/* Live captions' lines (Session 55, Part 10): placeholder words only. */

describe('caption lines (Part 10)', () => {
  it('fill each line from the phrase’s start up to its length, whole words only, and keep the last two', () => {
    // Lines are filled from the start, so a line already shown never changes as more words come (roll-up).
    const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
    expect(captionLines(words, 16)).toEqual(['delta epsilon', 'zeta eta theta']);
    expect(captionLines(words, 16, 4)).toEqual(['alpha beta gamma', 'delta epsilon', 'zeta eta theta']);
    expect(captionLines(words.slice(0, 2), 16)).toEqual(['alpha beta']);
    expect(captionLines([], 16)).toEqual([]);
  });

  it('put a word longer than a line alone on its own line, never cut inside it', () => {
    expect(captionLines(['alpha', 'placeholderwordlonger', 'beta'], 10)).toEqual([
      'placeholderwordlonger',
      'beta',
    ]);
  });

  it('count letters, not bytes: Gujarati and Hindi placeholder words fit as their letters do', () => {
    // Each of these is 4 code points; 3 words and 2 spaces make 14.
    const gu = ['કખગઘ', 'ચછજઝ', 'ટઠડઢ'];
    expect(captionLines(gu, 14)).toEqual(['કખગઘ ચછજઝ ટઠડઢ']);
    expect(captionLines(gu, 13)).toEqual(['કખગઘ ચછજઝ', 'ટઠડઢ']);
    expect(CAPTION_LINE_CHARS.medium).toBeGreaterThanOrEqual(32);
  });
});

describe('caption settings (Part 10, migration 066)', () => {
  it('are read whole, and anything unknown falls back to the default, field by field', () => {
    expect(parseCaptionSettings(undefined)).toEqual(DEFAULT_CAPTION_SETTINGS);
    expect(DEFAULT_CAPTION_SETTINGS).toEqual({
      language: 'auto',
      audience: false,
      size: 'medium',
      place: 'bottom',
      captionLanguage: 'same',
    });
    expect(parseCaptionSettings({ language: 'gu', audience: true, size: 'large', place: 'top' })).toEqual({
      language: 'gu',
      audience: true,
      size: 'large',
      place: 'top',
      captionLanguage: 'same',
    });
    expect(parseCaptionSettings({ language: 'fr', audience: 'yes', size: 'huge', place: 'middle' })).toEqual(
      DEFAULT_CAPTION_SETTINGS,
    );
    expect(parseCaptionSettings({ language: 'sa' }).language).toBe('sa');
  });

  it('"Captions in" (alpha.24, migration 093): kept when known, the speaker’s own words otherwise', () => {
    expect(parseCaptionSettings({ language: 'gu', captionLanguage: 'hi' }).captionLanguage).toBe('hi');
    for (const t of ['same', 'gu', 'hi', 'en'])
      expect(parseCaptionSettings({ captionLanguage: t }).captionLanguage).toBe(t);
    for (const bad of ['sa', 'auto', 'fr', 1, null, undefined])
      expect(parseCaptionSettings({ captionLanguage: bad }).captionLanguage).toBe('same');
  });
});

describe('where captions show (Part 10)', () => {
  const shown: CaptionsShown = {
    lines: ['alpha'],
    language: 'en',
    audience: false,
    size: 'medium',
    place: 'bottom',
  };
  it('on the stream and the stage always, on the audience screens only when chosen', () => {
    expect(captionsFor(shown, 'stream')).toBe(shown);
    expect(captionsFor(shown, 'stage')).toBe(shown);
    expect(captionsFor(shown, 'hall')).toBeNull();
    const chosen = { ...shown, audience: true };
    expect(captionsFor(chosen, 'hall')).toBe(chosen);
    expect(captionsFor(null, 'stream')).toBeNull();
    expect(captionsFor(undefined, 'stage')).toBeNull();
    expect(captionsFor({ ...shown, lines: [] }, 'stream')).toBeNull();
  });

  it('alpha.24: while the others show a translation, the stage draws the speaker’s own words, or nothing', () => {
    const translated: CaptionsShown = {
      ...shown,
      fit: true,
      kind: 'translation',
      lines: ['Placeholder translated line'],
      language: 'hi',
      audience: true,
      page: { n: 1, of: 2 },
      stage: { lines: ['Placeholder spoken line'], language: 'gu', fit: true },
    };
    expect(captionsFor(translated, 'stream')).toBe(translated);
    expect(captionsFor(translated, 'hall')).toBe(translated);
    expect(captionsFor({ ...translated, audience: false }, 'hall')).toBeNull();
    expect(captionsFor(translated, 'stage')).toEqual({
      fit: true,
      lines: ['Placeholder spoken line'],
      language: 'gu',
      audience: true,
      size: 'medium',
      place: 'bottom',
    });
    // The speaker's words before any translation is ready: the stage only.
    const waiting: CaptionsShown = { ...translated, lines: [] };
    expect(captionsFor(waiting, 'stream')).toBeNull();
    expect(captionsFor(waiting, 'hall')).toBeNull();
    expect(captionsFor(waiting, 'stage')?.lines).toEqual(['Placeholder spoken line']);
    // Nothing for the stage now.
    expect(captionsFor({ ...translated, stage: null }, 'stage')).toBeNull();
    expect(captionsFor({ ...translated, stage: { lines: [], language: 'gu' } }, 'stage')).toBeNull();
    expect(captionsFor({ ...translated, stage: null }, 'stream')?.lines).toEqual([
      'Placeholder translated line',
    ]);
  });
});

describe('live timing (alpha.22)', () => {
  it('is read whole, and anything unknown falls back to the timing captions always had, field by field', () => {
    expect(parseCaptionTiming(undefined)).toEqual(DEFAULT_CAPTION_TIMING);
    expect(
      parseCaptionTiming({ stepMs: 1_000, pauseMs: 500, longestMs: 6_000, speech: 'quiet-room', threads: 1 }),
    ).toEqual({ stepMs: 1_000, pauseMs: 500, longestMs: 6_000, speech: 'quiet-room', threads: 1 });
    expect(
      parseCaptionTiming({ stepMs: 100, pauseMs: '500', longestMs: 6_000, speech: 'x', threads: 3 }),
    ).toEqual({ ...DEFAULT_CAPTION_TIMING, longestMs: 6_000 });
  });
});
