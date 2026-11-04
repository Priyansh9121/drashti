import { describe, expect, it } from 'vitest';
import { CAPTION_LINE_CHARS, captionLines, DEFAULT_CAPTION_SETTINGS, parseCaptionSettings } from './captions';

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
    });
    expect(parseCaptionSettings({ language: 'gu', audience: true, size: 'large', place: 'top' })).toEqual({
      language: 'gu',
      audience: true,
      size: 'large',
      place: 'top',
    });
    expect(parseCaptionSettings({ language: 'fr', audience: 'yes', size: 'huge', place: 'middle' })).toEqual(
      DEFAULT_CAPTION_SETTINGS,
    );
  });
});
