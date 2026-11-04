import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readShastraFile, passageId } from '../../shared/shastra';
import { openDatabase } from './database';
import { ShastraRepo } from './shastra';

function setup() {
  const db = openDatabase(':memory:');
  const books = new ShastraRepo(db);
  const input = readShastraFile({
    format: 'drashti-shastra',
    version: 1,
    name: 'Placeholder Harbour Book',
    abbreviation: 'PHB',
    sections: [
      {
        label: 'Invented Harbour',
        abbreviation: 'IH',
        items: [
          { number: 1, text: { en: 'The lantern guides a small boat beside the harbour.' } },
          { number: 2, text: { en: 'A glowing beacon leads the little vessel safely home.' } },
          { number: 3, text: { gu: 'નમૂના હોડી પાસે દીવો છે.', hi: 'नमूना नाव के पास दीपक है।' } },
        ],
      },
    ],
  });
  if (!input.ok) throw new Error(input.message);
  books.load(input.text, { path: null, hash: 'invented-v1' }, 'plain');
  function hint(number: number, lang = 'en') {
    const row = db
      .prepare(
        `SELECT i.id, x.loaded_at, x.source_hash, t.text FROM shastra_items i
      JOIN shastra_texts x ON x.id=i.text_id JOIN shastra_item_texts t ON t.item_id=i.id
      WHERE i.number=? AND t.lang=?`,
      )
      .get(number, lang) as { id: string; loaded_at: string; source_hash: string; text: string };
    return {
      itemId: row.id,
      lang,
      stamp: createHash('sha256')
        .update([row.id, row.loaded_at, row.source_hash, row.text].join('\0'))
        .digest('hex'),
      score: 0.95,
    };
  }
  return { db, books, hint };
}
describe('Book helper hints are only current loaded passages', () => {
  it('rehydrates a meaning hint to the exact stored words and reference', () => {
    const s = setup();
    try {
      const hits = s.books.search('light helping a vessel reach home', 10, [s.hint(2)]);
      expect(hits).toEqual([
        {
          passageId: passageId({ text: 'phb', sections: ['ih'], from: 2, to: 2 }),
          reference: 'Placeholder Harbour Book Invented Harbour 2',
          snippet: 'A glowing beacon leads the little vessel safely home.',
          lang: 'en',
        },
      ]);
    } finally {
      s.db.close();
    }
  });
  it('keeps exact words first, deduplicates and obeys the combined limit', () => {
    const s = setup();
    try {
      const exact = s.books.search('lantern', 10);
      const combined = s.books.search('lantern', 2, [s.hint(2), s.hint(1), s.hint(2)]);
      expect(combined).toHaveLength(2);
      expect(combined[0]).toEqual(exact[0]);
      expect(combined[1]?.reference).toBe('Placeholder Harbour Book Invented Harbour 2');
      expect(s.books.search('lantern', 1, [s.hint(2)])).toEqual(exact.slice(0, 1));
    } finally {
      s.db.close();
    }
  });
  it('ignores invented, stale, removed and wrong-language hints and supplied words', () => {
    const s = setup();
    try {
      const hint = s.hint(2);
      expect(
        s.books.search('unmatched', 10, [
          { ...hint, itemId: 'invented-foreign' },
          { ...hint, stamp: 'stale' },
          { ...hint, lang: 'gu' },
        ]),
      ).toEqual([]);
      const result = s.books.search('unmatched', 10, [
        { ...hint, reference: 'INVENTED', snippet: 'INVENTED' },
      ]);
      expect(result[0]?.snippet).toBe('A glowing beacon leads the little vessel safely home.');
      s.db.prepare('DELETE FROM shastra_texts').run();
      expect(s.books.search('unmatched', 10, [hint])).toEqual([]);
    } finally {
      s.db.close();
    }
  });
  it('returns the actual loaded Gujarati or Hindi line without translation', () => {
    const s = setup();
    try {
      expect(s.books.search('invented translated query', 10, [s.hint(3, 'gu')])[0]).toMatchObject({
        snippet: 'નમૂના હોડી પાસે દીવો છે.',
        lang: 'gu',
      });
      expect(s.books.search('invented translated query', 10, [s.hint(3, 'hi')])[0]).toMatchObject({
        snippet: 'नमूना नाव के पास दीपक है।',
        lang: 'hi',
      });
    } finally {
      s.db.close();
    }
  });
});
