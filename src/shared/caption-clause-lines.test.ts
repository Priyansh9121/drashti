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

it('never truncates or splits a translated clause to make two lines', async () => {
  const { captionTranslationLines } = await import('./caption-clause-lines');
  expect(captionTranslationLines('A blue box', 40)).toEqual(['A blue box']);
  expect(captionTranslationLines('W'.repeat(80), 40)).toBeNull();
  expect(captionTranslationLines('A round shape beside the green box '.repeat(10), 40)).toBeNull();
});
