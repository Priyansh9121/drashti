import { describe, expect, it } from 'vitest';
import type { ShastraFile } from '../../shared/shastra';
import { readShastraFile, resolveReference } from '../../shared/shastra';
import { openDatabase } from './database';
import { ShastraRepo } from './shastra';

/* Shastra texts in the library (placeholder texts only). */

const granth = (verses: number[], extra: Partial<ShastraFile> = {}): ShastraFile => ({
  format: 'drashti-shastra',
  version: 1,
  name: 'Placeholder Granth',
  abbreviation: 'PG',
  items: verses.map((n) => ({
    number: n,
    text: { sa: `नमूना श्लोकः ${n}`, en: `Placeholder meaning ${n}.` },
  })),
  ...extra,
});

const vachan: ShastraFile = {
  format: 'drashti-shastra',
  version: 1,
  name: 'Placeholder Vachan',
  abbreviation: 'Vach',
  sections: [
    {
      label: 'Placeholder Pratham',
      abbreviation: 'P.Pr.',
      items: [1, 2].map((n) => ({
        number: n,
        text: { gu: `નમૂના વચન ${n} સમજણ`, en: `Placeholder talk ${n}.` },
      })),
    },
  ],
};

function loaded(file: ShastraFile) {
  const read = readShastraFile(file);
  if (!read.ok) throw new Error(read.message);
  return read.text;
}

describe('ShastraRepo', () => {
  it('loads a text, making the other Sanskrit script and the transliteration, marked as made', () => {
    const repo = new ShastraRepo(openDatabase(':memory:'));
    const result = repo.load(
      loaded(granth([1, 2, 3])),
      { path: '/placeholder/pg.json', hash: 'h1' },
      'plain',
    );
    expect(result).toMatchObject({ outcome: 'added', items: 3, made: { translit: 3, script: 3 } });
    expect(repo.list()).toEqual([
      expect.objectContaining({
        name: 'Placeholder Granth',
        abbreviation: 'PG',
        itemCount: 3,
        languages: { en: 3, translit: 3, sa: 3, 'sa-gu': 3 },
      }),
    ]);
    const passage = repo.passage({ text: 'pg', sections: [], from: 2, to: 2 });
    const { translit, ...given } = passage?.items[0]?.texts ?? {};
    expect(given).toEqual({ sa: 'नमूना श्लोकः 2', 'sa-gu': 'નમૂના શ્લોકઃ 2', en: 'Placeholder meaning 2.' });
    // Sanskrit keeps every "a" (namūnā, not namūn).
    expect(translit?.toLowerCase()).toContain('namuna');
  });

  it('loads the same file again without changing anything, and a changed one in place', () => {
    const repo = new ShastraRepo(openDatabase(':memory:'));
    const first = repo.load(loaded(granth([1, 2, 3])), { path: 'pg.json', hash: 'h1' }, 'plain');
    expect(repo.load(loaded(granth([1, 2, 3])), { path: 'pg.json', hash: 'h1' }, 'plain').outcome).toBe(
      'unchanged',
    );
    const before = repo.passage({ text: 'pg', sections: [], from: 1, to: 3 });
    // Verse 3 goes, 4 comes, 1 changes its words: the same text, verses 1 and 2 keep their ids.
    const changed = granth([1, 2, 4]);
    const updated = repo.load(loaded(changed), { path: 'pg.json', hash: 'h2' }, 'plain');
    expect(updated).toMatchObject({ outcome: 'updated', textId: first.textId, items: 3 });
    expect(repo.list()).toHaveLength(1);
    const after = repo.passage({ text: 'pg', sections: [], from: 1, to: 4 });
    expect(after?.items.map((i) => i.number)).toEqual([1, 2, 4]);
    expect(after?.items.slice(0, 2).map((i) => i.id)).toEqual(before?.items.slice(0, 2).map((i) => i.id));
  });

  it('resolves references against the texts loaded, sections included', () => {
    const repo = new ShastraRepo(openDatabase(':memory:'));
    repo.load(loaded(granth([1, 14, 15, 16])), { path: null, hash: null }, 'plain');
    repo.load(loaded(vachan), { path: null, hash: null }, 'plain');
    const texts = repo.refTexts();
    expect(resolveReference('PG 14-16', texts)).toMatchObject({
      ok: true,
      display: 'Placeholder Granth 14–16',
    });
    const v = resolveReference('Vach P.Pr. 2', texts);
    if (!v.ok) throw new Error(v.message);
    expect(v.key).toEqual({ text: 'vach', sections: ['ppr'], from: 2, to: 2 });
    expect(repo.passage(v.key)).toMatchObject({
      sectionLabels: ['Placeholder Pratham'],
      items: [{ number: 2, texts: { gu: 'નમૂના વચન 2 સમજણ', en: 'Placeholder talk 2.' } }],
    });
    expect(repo.passage({ text: 'vach', sections: ['nope'], from: 1, to: 1 })).toBeNull();
    expect(repo.tree(repo.list()[1]?.id ?? '')).toMatchObject({
      sections: [{ label: 'Placeholder Pratham', items: [{ number: 1 }, { number: 2 }] }],
    });
  });

  it('finds passages by their words in each language, accents ignored', () => {
    const repo = new ShastraRepo(openDatabase(':memory:'));
    repo.load(loaded(granth([1, 2])), { path: null, hash: null }, 'iso');
    repo.load(loaded(vachan), { path: null, hash: null }, 'plain');
    expect(repo.search('meaning 2').map((h) => h.reference)).toEqual(['Placeholder Granth 2']);
    expect(
      repo
        .search('સમજણ')
        .map((h) => h.reference)
        .sort(),
    ).toEqual(['Placeholder Vachan Placeholder Pratham 1', 'Placeholder Vachan Placeholder Pratham 2']);
    const sanskrit = repo.search('श्लोकः')[0];
    expect(sanskrit?.lang).toBe('sa');
    expect(sanskrit?.passageId).toMatch(/^shastra:pg#/u);
    // Transliteration made with accent marks is found without them.
    expect(repo.search('slokah').length).toBe(2);
    expect(repo.search('nowhere')).toEqual([]);
  });

  it('removes a text, its words and its search entries', () => {
    const db = openDatabase(':memory:');
    const repo = new ShastraRepo(db);
    const { textId } = repo.load(loaded(granth([1, 2])), { path: null, hash: null }, 'plain');
    expect(repo.remove(textId)).toBe(true);
    expect(repo.list()).toEqual([]);
    expect(repo.search('meaning')).toEqual([]);
    expect((db.prepare('SELECT COUNT(*) AS n FROM shastra_item_texts').get() as { n: number }).n).toBe(0);
  });
});
