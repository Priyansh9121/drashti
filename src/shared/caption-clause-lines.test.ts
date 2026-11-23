import { describe, expect, it } from 'vitest';
import { captionClauseLines } from './caption-clause-lines';

describe('two-line clauses', () => {
  it('bounds an unbroken wide word without breaking Gujarati vowel clusters', () => {
    const cluster = 'કિ';
    const lines = captionClauseLines(cluster.repeat(60), 31);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect([...line].length).toBeLessThanOrEqual(31);
      expect(line.startsWith('ક')).toBe(true);
      expect(line.endsWith('િ')).toBe(true);
    }
  });
  it('keeps only the last two fitted lines from a very long clause', () => {
    const lines = captionClauseLines('W'.repeat(250), 40);
    expect(lines).toEqual(['W'.repeat(40), 'W'.repeat(10)]);
  });
});
