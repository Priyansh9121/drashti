import { beforeEach, describe, expect, it } from 'vitest';
import type { TextElement } from '../../shared/model';
import { type Db, openDatabase } from './database';
import { DbSlideSource, elementFromRow, PresentationRepo } from './presentations';

let db: Db;
let repo: PresentationRepo;
let libraryId: string;

const text = (id: string, value: string): TextElement => ({
  id,
  kind: 'text',
  frame: { x: 10, y: 20, width: 300, height: 40 },
  text: value,
  lang: 'gu',
  style: {
    fontFamily: null,
    fontSize: 48,
    fontWeight: 400,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.2,
    shadow: false,
  },
});

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new PresentationRepo(db);
  libraryId = repo.ensureLibrary('Default');
});

describe('PresentationRepo', () => {
  it('reuses a library by name', () => {
    expect(repo.ensureLibrary('Default')).toBe(libraryId);
  });

  it('round-trips a presentation with groups, slides and elements in order', () => {
    const id = repo.insert({
      libraryId,
      name: 'Two groups',
      width: 1280,
      height: 720,
      groups: [
        {
          name: 'Verse',
          color: '#3e63dd',
          slides: [{ label: 'a', elements: [text('t1', 'એક')] }, { elements: [] }],
        },
        {
          name: 'Chorus',
          slides: [{ background: '#112233', notes: 'n', elements: [text('t2', 'બે'), text('t3', 'ત્રણ')] }],
        },
      ],
      source: {
        kind: 'pp6',
        path: '/Users/x/Documents/ProPresenter6/Song.pro6',
        ref: 'UUID-1',
        importedAt: '2026-01-01T00:00:00Z',
      },
    });
    const doc = repo.get(id);
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(doc.groups.map((g) => g.name)).toEqual(['Verse', 'Chorus']);
    expect(doc.groups.flatMap((g) => g.slides.map((s) => s.index))).toEqual([0, 1, 2]);
    const last = doc.groups[1]?.slides[0];
    expect(last?.notes).toBe('n');
    expect(last?.slide).toMatchObject({ width: 1280, height: 720, background: '#112233' });
    expect(last?.slide.elements.map((e) => (e.kind === 'text' ? e.text : ''))).toEqual(['બે', 'ત્રણ']);
    expect(last?.slide.elements[0]).toMatchObject({
      kind: 'text',
      frame: { x: 10, y: 20, width: 300, height: 40 },
      lang: 'gu',
    });
    expect(doc.source).toEqual({
      kind: 'pp6',
      path: '/Users/x/Documents/ProPresenter6/Song.pro6',
      ref: 'UUID-1',
      importedAt: '2026-01-01T00:00:00Z',
    });
    expect(doc.kirtan).toBeNull();
  });

  it('lists presentations with slide counts and kirtan tracks', () => {
    repo.insert({
      libraryId,
      name: 'b plain',
      groups: [{ name: 'G', slides: [{ elements: [] }, { elements: [] }] }],
    });
    repo.insert({
      libraryId,
      name: 'A kirtan',
      groups: [{ name: 'G', slides: [{ elements: [] }] }],
      kirtan: { tracks: ['translit', 'gu'], lines: [{ gu: 'એક', translit: 'ek' }] },
    });
    const list = repo.list();
    expect(list.map((p) => [p.name, p.slideCount, p.kirtanTracks])).toEqual([
      ['A kirtan', 1, ['gu', 'translit']],
      ['b plain', 2, null],
    ]);
  });

  it('returns kirtan lines per slide and language', () => {
    const id = repo.insert({
      libraryId,
      name: 'K',
      groups: [{ name: 'G', slides: [{ elements: [] }, { elements: [] }] }],
      kirtan: {
        category: 'dhun',
        kavi: 'Placeholder',
        tracks: ['en', 'gu', 'hi', 'translit'],
        lines: [{ en: 'one', gu: 'એક' }, { hi: 'दो' }],
      },
    });
    const doc = repo.get(id);
    const [s1, s2] = doc?.groups[0]?.slides ?? [];
    expect(doc?.kirtan?.tracks).toEqual(['en', 'gu', 'hi', 'translit']);
    expect(doc?.kirtan?.category).toBe('dhun');
    expect(s1 && doc?.kirtan?.lines[s1.id]).toEqual({ en: 'one', gu: 'એક' });
    expect(s2 && doc?.kirtan?.lines[s2.id]).toEqual({ hi: 'दो' });
  });

  it('skips stored elements that are invalid, and reports them', () => {
    const id = repo.insert({
      libraryId,
      name: 'P',
      groups: [{ name: 'G', slides: [{ elements: [text('ok', 'fine')] }] }],
    });
    const slideId = (db.prepare('SELECT id FROM slides').get() as { id: string }).id;
    db.prepare(
      "INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, props) VALUES ('bad', ?, 1, 'text', 0, 0, 1, 1, '{\"text\": 5}')",
    ).run(slideId);
    db.prepare(
      "INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, props) VALUES ('img', ?, 2, 'image', 0, 0, 1, 1, '{}')",
    ).run(slideId);
    const doc = repo.get(id);
    expect(doc?.groups[0]?.slides[0]?.slide.elements.map((e) => e.id)).toHaveLength(1);
    expect(repo.skippedElements).toEqual(['bad']);
  });

  it('returns null for an unknown id', () => {
    expect(repo.get('nope')).toBeNull();
  });
});

describe('elementFromRow', () => {
  it('rejects rows whose props are not an object', () => {
    const row = { id: 'e', slide_id: 's', kind: 'text', x: 0, y: 0, width: 1, height: 1 };
    expect(elementFromRow({ ...row, props: 'null' })).toBeNull();
    expect(elementFromRow({ ...row, props: 'not json' })).toBeNull();
  });
});

describe('DbSlideSource', () => {
  it('serves slides in presentation order and caches until invalidated', () => {
    const id = repo.insert({
      libraryId,
      name: 'P',
      groups: [
        { name: 'A', slides: [{ elements: [text('a', 'a')] }] },
        { name: 'B', slides: [{ elements: [text('b', 'b')] }] },
      ],
    });
    const source = new DbSlideSource(repo);
    expect(source.slideCount(id)).toBe(2);
    expect(source.slide(id, 1)?.elements[0]).toMatchObject({ text: 'b' });
    expect(source.slide(id, 2)).toBeNull();
    expect(source.slideCount('missing')).toBeNull();
    db.prepare('DELETE FROM presentations WHERE id = ?').run(id);
    expect(source.slideCount(id)).toBe(2);
    source.invalidate(id);
    expect(source.slideCount(id)).toBeNull();
  });
});
