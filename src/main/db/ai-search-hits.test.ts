import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SearchResult } from '../../shared/search';
import type { Lang, TextElement } from '../../shared/model';
import { type Db, openDatabase } from './database';
import { PresentationRepo } from './presentations';
import { SearchIndex } from './search';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../docs/examples/placeholder-ai.json'), 'utf8'),
) as {
  library: { key: string; name: string; text: string; lang: Lang }[];
  queries: { meaning: string; typo: string; romanGu: string; romanGuTypo: string };
};
interface Hint {
  presentationId: string;
  slideId: string;
  stamp: string;
  kind: 'meaning' | 'spelling';
  score: number;
}
let db: Db;
let repo: PresentationRepo;
let index: SearchIndex;
let docs: Record<string, Hint>;
const sourceText = (value: string, lang: Lang): TextElement => ({
  id: 'placeholder',
  kind: 'text',
  text: value,
  lang,
  frame: { x: 0, y: 0, width: 960, height: 540 },
  style: {
    fontFamily: null,
    fontSize: 60,
    fontWeight: 400,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.2,
    shadow: false,
  },
});
const ask = (query: string, hints: Hint[], limit = 50): SearchResult =>
  Reflect.apply(index.search, index, [query, limit, hints]) as SearchResult;
beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new PresentationRepo(db);
  index = new SearchIndex(db);
  const libraryId = repo.ensureLibrary('Placeholder helper library');
  docs = {};
  for (const item of fixture.library) {
    const id = repo.insert({
      libraryId,
      name: item.name,
      groups: [{ name: '', slides: [{ elements: [sourceText(item.text, item.lang)] }] }],
    });
    const row = db
      .prepare(
        `SELECT s.id AS slide, p.updated_at, p.content_rev FROM presentations p JOIN slide_groups g ON g.presentation_id=p.id JOIN slides s ON s.group_id=g.id WHERE p.id=?`,
      )
      .get(id) as { slide: string; updated_at: string; content_rev: number };
    docs[item.key] = {
      presentationId: id,
      slideId: row.slide,
      stamp: row.updated_at + '#' + String(row.content_rev),
      kind: 'meaning',
      score: 0.9,
    };
  }
});
afterEach(() => db.close());
function doc(key: string): Hint {
  const result = docs[key];
  if (!result) throw new Error('Placeholder fixture missing');
  return result;
}

describe('hydrating offline helper search suggestions from current library sources', () => {
  it('adds a worker meaning match using the exact stored line and reference', () => {
    const target = doc('boat');
    const result = ask(fixture.queries.meaning, [target]);
    expect(result.hits).toMatchObject([
      {
        presentationId: target.presentationId,
        match: { kind: 'text', slideId: target.slideId, line: fixture.library[0]?.text },
        suggestion: 'meaning',
      },
    ]);
  });
  it.each(['typo', 'romanGuTypo'] as const)(
    'hydrates a %s spelling match without rewriting the saved words',
    (query) => {
      const target = { ...doc(query === 'typo' ? 'boat' : 'gu'), kind: 'spelling' as const };
      const original = fixture.library.find((p) => p.key === (query === 'typo' ? 'boat' : 'gu'));
      expect(ask(fixture.queries[query], [target]).hits).toMatchObject([
        {
          presentationId: target.presentationId,
          match: { kind: 'text', line: original?.text },
          suggestion: 'spelling',
        },
      ]);
    },
  );
  it('keeps exact matches first and removes repeated suggestions under the existing result limit', () => {
    const exact = doc('exact');
    const boat = doc('boat');
    expect(ask('water', [boat, exact, boat], 2).hits.map((p) => p.presentationId)).toEqual([
      exact.presentationId,
      boat.presentationId,
    ]);
  });
  it('keeps the existing search result identical when there are no suggestions', () => {
    expect(ask('water', [])).toEqual(index.search('water'));
    expect(ask('', [doc('boat')]).hits).toEqual([]);
  });
  it('ignores stale, removed, foreign-slide and invented references rather than inventing a result', () => {
    const boat = doc('boat');
    const stones = doc('stones');
    db.prepare("UPDATE presentations SET deleted_at = '2026-01-01' WHERE id = ?").run(stones.presentationId);
    const hints = [
      { ...boat, stamp: 'stale' },
      stones,
      { ...boat, slideId: stones.slideId },
      { ...boat, presentationId: 'placeholder-invented-id' },
    ];
    expect(ask(fixture.queries.meaning, hints).hits).toEqual([]);
  });
});
