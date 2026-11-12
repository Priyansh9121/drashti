import { describe, expect, it } from 'vitest';
import type { TextElement } from '../../shared/model';
import { wordsOf } from '../library/words';
import { langsOfRows } from './content';
import { openDatabase } from './database';
import { PresentationRepo } from './presentations';
import { SearchIndex } from './search';

const visible: TextElement = {
  id: 'placeholder-visible',
  kind: 'text',
  frame: { x: 0, y: 0, width: 120, height: 48 },
  text: 'Placeholder turquoise',
  lang: 'en',
  style: {
    fontFamily: null,
    fontSize: 24,
    fontWeight: 400,
    color: '#ffffff',
    align: 'left',
    verticalAlign: 'top',
    lineHeight: 1.2,
    shadow: false,
  },
};

const hidden: TextElement = {
  ...visible,
  id: 'placeholder-hidden',
  text: 'નમૂના\nPlaceholder cobalt',
  lang: 'gu',
  runs: [
    { text: 'નમૂના\n', lang: 'gu' },
    { text: 'Placeholder cobalt', lang: 'en' },
  ],
  hidden: true,
};

function fixture() {
  const db = openDatabase(':memory:');
  const repo = new PresentationRepo(db);
  const id = repo.insert({
    libraryId: repo.ensureLibrary('Placeholder library'),
    name: 'Placeholder deck',
    groups: [{ name: '', slides: [{ elements: [visible, hidden] }] }],
  });
  const rows = repo.content(id);
  if (!rows) {
    db.close();
    throw new Error('The generated presentation was not stored.');
  }
  return { db, rows };
}

describe('hidden words in stored slide objects', () => {
  it('leaves hidden words out of the search index', () => {
    const { db } = fixture();
    try {
      const search = new SearchIndex(db);
      expect(search.search('turquoise').hits).toHaveLength(1);
      expect(search.search('cobalt').hits).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('leaves hidden language tracks out of the row summary', () => {
    const { db, rows } = fixture();
    try {
      expect(langsOfRows(rows.elements)).toEqual(['en']);
    } finally {
      db.close();
    }
  });

  it('leaves hidden objects out of Edit words and retains them in stored slide rows', () => {
    const { db, rows } = fixture();
    try {
      expect(wordsOf(rows)).toContain(visible.text);
      expect(wordsOf(rows)).not.toContain('cobalt');
      expect(rows.elements).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});
