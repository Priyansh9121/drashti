import { describe, expect, it } from 'vitest';
import { captionClauseLines } from './caption-clause-lines';

describe('two-line clauses', () => {
  it('bounds an unbroken wide word without breaking Gujarati vowel clusters', () => {
    const cluster = 'કિ';
    const lines = captionClauseLines(cluster.repeat(60), 31);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(Array.from(line).length).toBeLessThanOrEqual(31);
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

it('alpha.24: pages a long translation two lines at a time, whole words, never dropped; null only for a word wider than a line', async () => {
  const { captionTranslationPages } = await import('./caption-clause-lines');
  expect(captionTranslationPages('A blue box', 40)).toEqual([['A blue box']]);
  const long = 'A round shape beside the green box '.repeat(4).trim();
  const pages = captionTranslationPages(long, 40);
  expect(pages).not.toBeNull();
  for (const page of pages ?? []) {
    expect(page.length).toBeGreaterThanOrEqual(1);
    expect(page.length).toBeLessThanOrEqual(2);
    for (const line of page) expect(Array.from(line).length).toBeLessThanOrEqual(40);
  }
  expect((pages ?? []).flat().join(' ')).toBe(long);
  expect(pages).toHaveLength(2);
  expect(captionTranslationPages('W'.repeat(41), 40)).toBeNull();
  expect(captionTranslationPages('   ', 40)).toBeNull();
});
