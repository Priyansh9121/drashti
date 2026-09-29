import { beforeEach, describe, expect, it } from 'vitest';
import type { TextElement, TextRun } from '../../shared/model';
import { type Db, openDatabase } from './database';
import { PresentationRepo } from './presentations';
import { SearchIndex } from './search';

/* Placeholder text only: "sample line" and the like, written here. */

let db: Db;
let repo: PresentationRepo;
let index: SearchIndex;
let lib: string;

const text = (value: string, runs?: TextRun[]): TextElement => ({
  id: 'x',
  kind: 'text',
  frame: { x: 0, y: 0, width: 100, height: 100 },
  text: value,
  lang: null,
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
  ...(runs ? { runs } : {}),
});

function add(name: string, lines: string[][], extra: { runs?: TextRun[] } = {}): string {
  return repo.insert({
    libraryId: lib,
    name,
    groups: [
      {
        name: 'Verse',
        slides: lines.map((boxes, i) => ({
          elements: boxes.map((b) => text(b, i === 0 ? extra.runs : undefined)),
        })),
      },
    ],
  });
}

const names = (q: string) => index.search(q).hits.map((h) => h.name);

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new PresentationRepo(db);
  index = new SearchIndex(db);
  lib = repo.ensureLibrary('Kirtans');
  add('Placeholder Morning Song', [['Placeholder sample line one'], ['Second sample line']]);
  add('Placeholder Gujarati Kirtan', [['નમૂના પંક્તિ એક\nNamūnā pankti ek'], ['બીજી પંક્તિ']]);
  add('Placeholder Hindi Bhajan', [['नमूना पंक्ति\nPlaceholder English line']]);
});

describe('library search', () => {
  it('finds titles and slide text in English, Gujarati, Hindi and transliteration', () => {
    expect(names('morning')).toEqual(['Placeholder Morning Song']);
    expect(names('second sample')).toEqual(['Placeholder Morning Song']);
    expect(names('નમૂના')).toEqual(['Placeholder Gujarati Kirtan']);
    expect(names('પંક્')).toEqual(['Placeholder Gujarati Kirtan']);
    expect(names('नमूना')).toEqual(['Placeholder Hindi Bhajan']);
    // Accents do not matter, and a word can be typed in part.
    expect(names('namuna pank')).toEqual(['Placeholder Gujarati Kirtan']);
    expect(names('NAMŪNĀ')).toEqual(['Placeholder Gujarati Kirtan']);
    expect(names('nothing like this')).toEqual([]);
  });

  it('says where it matched: the title first, else the line as written, with its slide', () => {
    const [kirtan] = index.search('pankti ek').hits;
    expect(kirtan).toMatchObject({
      name: 'Placeholder Gujarati Kirtan',
      libraryName: 'Kirtans',
      match: { kind: 'text', line: 'Namūnā pankti ek' },
    });
    const doc = repo.get(kirtan?.presentationId ?? '');
    expect(kirtan?.match.kind === 'text' && kirtan.match.slideId).toBe(doc?.groups[0]?.slides[0]?.id);
    // The title wins over the text, and ranks first.
    const hits = index.search('placeholder').hits;
    expect(hits.every((h) => h.match.kind === 'title')).toBe(true);
    const english = index.search('english');
    expect(english.hits[0]?.match).toEqual(expect.objectContaining({ line: 'Placeholder English line' }));
  });

  it('leaves out text in legacy fonts, and counts the presentations that have it', () => {
    expect(index.search('anything').legacyCount).toBe(0);
    add('Placeholder Old Kirtan', [['ignored'], ['Readable placeholder line']], {
      runs: [{ text: 'Rkk{kk ', legacy: true, font: 'Gopika' }, { text: 'Readable part' }],
    });
    const result = index.search('rkk');
    expect(result.hits).toEqual([]);
    expect(result.legacyCount).toBe(1);
    expect(names('readable')).toEqual(['Placeholder Old Kirtan']);
    expect(index.legacyPresentations().map((p) => p.name)).toEqual(['Placeholder Old Kirtan']);
  });

  it('follows the library: replaced text, removed and restored presentations', () => {
    const id = add('Placeholder Changing', [['Old placeholder words']]);
    expect(names('old placeholder')).toEqual(['Placeholder Changing']);
    repo.replace(id, {
      libraryId: lib,
      name: 'Placeholder Changing',
      groups: [{ name: 'G', slides: [{ elements: [text('New placeholder words')] }] }],
    });
    expect(names('old placeholder')).toEqual([]);
    expect(names('new placeholder')).toEqual(['Placeholder Changing']);
    repo.remove([id]);
    expect(names('new placeholder')).toEqual([]);
    // A removed presentation is out of the full-text index (so ranking never needs to skip it).
    expect((db.prepare('SELECT COUNT(*) AS n FROM search_fts').get() as { n: number }).n).toBe(3);
    repo.restore([id]);
    expect(names('new placeholder')).toEqual(['Placeholder Changing']);
    // Purged for good: its index entry goes with it.
    repo.remove([id]);
    repo.purgeRemoved('9999-01-01T00:00:00Z');
    expect((db.prepare('SELECT COUNT(*) AS n FROM search_fts').get() as { n: number }).n).toBe(3);
  });

  it('finds kirtan language lines too', () => {
    repo.insert({
      libraryId: lib,
      name: 'Placeholder Tracks',
      groups: [{ name: 'G', slides: [{ elements: [] }] }],
      kirtan: { tracks: ['gu', 'translit'], lines: [{ gu: 'ટ્રેક પંક્તિ', translit: 'Ṭrek pankti' }] },
    });
    expect(names('trek')).toEqual(['Placeholder Tracks']);
    expect(names('ટ્રેક')).toEqual(['Placeholder Tracks']);
  });

  it('is rebuilt once for a library indexed by another version', () => {
    db.prepare('DELETE FROM search_docs').run();
    db.prepare("DELETE FROM app_meta WHERE key = 'search.version'").run();
    expect(names('morning')).toEqual([]);
    expect(index.rebuildIfStale()).toBe(true);
    expect(names('morning')).toEqual(['Placeholder Morning Song']);
    expect(index.rebuildIfStale()).toBe(false);
  });
});
