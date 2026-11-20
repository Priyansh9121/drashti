import { describe, expect, it } from 'vitest';
import { dayWords, playedWords, resumeWords } from './play-history';

/* Resume where it stopped, last played and play counts (alpha.20): their words. */

describe('the plays’ words', () => {
  it('the offer, and a file’s plays', () => {
    expect(resumeWords(6 * 60_000)).toBe('Resume at 6:00');
    expect(resumeWords(62 * 60_000 + 10_000)).toBe('Resume at 1:02:10');
    expect(playedWords(0, null)).toBe('Not yet');
    expect(playedWords(1, '2026-11-20T12:00:00.000Z', 'en-GB')).toBe('Once, last on 20 Nov 2026');
    expect(playedWords(12, '2026-11-20T12:00:00.000Z', 'en-GB')).toBe('12 times, last on 20 Nov 2026');
    expect(playedWords(3, null)).toBe('3 times');
    expect(dayWords('2026-11-20T12:00:00.000Z', true, 'en-GB')).toBe('20 Nov');
    expect(dayWords('not a time')).toBeNull();
  });
});
