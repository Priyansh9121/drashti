import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CAPTION_CLEAN_EN,
  CAPTION_CLEAN_GU,
  CAPTION_CLEAN_HI,
  CAPTION_CLEAN_SA,
} from '../../shared/caption-clean/list';

/*
 * Drashti's own list of words left out of captions (alpha.24, QA24-CAPCLEAN-1, lead 2's QA24-CAPCLEAN-1a A): kept
 * in this public repo as hashes only (SHA-256 of Drashti's prefix and each word's key, scripts/caption-clean-hash.mjs),
 * never a word. Sanskrit has none of its own: every caption is checked against every language's words.
 */

const HEX = /^[0-9a-f]{64}$/u;
const LISTS = { gu: CAPTION_CLEAN_GU, hi: CAPTION_CLEAN_HI, sa: CAPTION_CLEAN_SA, en: CAPTION_CLEAN_EN };

describe('Drashti’s own list', () => {
  it('holds only hashes, sorted and once each, for Gujarati, Hindi and English', () => {
    for (const list of Object.values(LISTS)) {
      for (const entry of list) expect(entry).toMatch(HEX);
      expect([...list].sort()).toEqual(list);
      expect(new Set(list).size).toBe(list.length);
    }
    expect(CAPTION_CLEAN_GU.length).toBeGreaterThan(5);
    expect(CAPTION_CLEAN_HI.length).toBeGreaterThan(5);
    expect(CAPTION_CLEAN_EN.length).toBeGreaterThan(5);
    expect(CAPTION_CLEAN_SA).toEqual([]);
    const all = Object.values(LISTS).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('is a file with no word in it: its comment, then four lists of hashes', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'shared', 'caption-clean', 'list.ts'), 'utf8');
    const strings = [...source.matchAll(/'([^']*)'/gu)].map((m) => m[1] ?? '');
    expect(strings).toEqual(Object.values(LISTS).flat());
    expect(source).not.toMatch(/["`]/u);
    const skeleton = source
      .replace(/^\/\*[\s\S]*?\*\/\n/u, '')
      .replace(/'[0-9a-f]{64}',?/gu, '')
      .replace(/\[\s*\]/gu, '[]')
      .replace(/\s+/gu, ' ')
      .trim();
    expect(skeleton).toBe(
      ['GU', 'HI', 'SA', 'EN']
        .map((l) => `export const CAPTION_CLEAN_${l}: readonly string[] = [];`)
        .join(' '),
    );
  });
});
