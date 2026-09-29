import { beforeEach, describe, expect, it } from 'vitest';
import type { TextElement } from '../../shared/model';
import { type Db, openDatabase } from './database';
import { cueFromRow, DbSlideSource, elementFromRow, PresentationRepo } from './presentations';

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

  it('stores arrangements, notes and disabled slides; a disabled slide is not shown', () => {
    const id = repo.insert({
      libraryId,
      name: 'Arranged',
      notes: 'Placeholder notes',
      groups: [
        {
          name: 'Verse',
          slides: [{ elements: [text('v', 'v')] }, { enabled: false, elements: [text('x', 'x')] }],
        },
        { name: 'Chorus', slides: [{ elements: [text('c', 'c')] }] },
      ],
      arrangements: [{ name: 'Usual', groups: [0, 1, 0, 1, 7] }],
    });
    expect(repo.get(id)?.groups.map((g) => g.slides.length)).toEqual([1, 1]);
    expect(db.prepare('SELECT notes FROM presentations WHERE id = ?').get(id)).toEqual({
      notes: 'Placeholder notes',
    });
    const order = db
      .prepare(
        `SELECT g.name FROM arrangement_groups ag JOIN slide_groups g ON g.id = ag.group_id
          JOIN arrangements a ON a.id = ag.arrangement_id WHERE a.presentation_id = ? ORDER BY ag.position`,
      )
      .all(id) as { name: string }[];
    // An index with no group behind it is left out.
    expect(order.map((r) => r.name)).toEqual(['Verse', 'Chorus', 'Verse', 'Chorus']);
  });

  it('replaces content in place, keeping the id and name', () => {
    const id = repo.insert({
      libraryId,
      name: 'Kept name',
      groups: [{ name: 'Old', slides: [{ elements: [] }] }],
    });
    const replaced = repo.replace(id, {
      libraryId,
      name: 'Ignored',
      groups: [{ name: 'New', slides: [{ elements: [text('n', 'new')] }, { elements: [] }] }],
      sourceHash: 'abc',
    });
    expect(replaced).toBe(true);
    const doc = repo.get(id);
    expect(doc?.name).toBe('Kept name');
    expect(doc?.groups.map((g) => [g.name, g.slides.length])).toEqual([['New', 2]]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM slide_groups').get()).toEqual({ n: 1 });
    expect(repo.replace('missing', { libraryId, name: 'x', groups: [] })).toBe(false);
  });

  it('removes presentations so they can be restored, and purges them later', () => {
    const a = repo.insert({ libraryId, name: 'A', groups: [] });
    const b = repo.insert({
      libraryId,
      name: 'B',
      groups: [],
      source: { kind: 'text', path: '/b.txt', ref: null, importedAt: null },
      sourceHash: 'h',
    });
    expect(repo.remove([a, b, 'missing'])).toEqual([a, b]);
    expect(repo.remove([a])).toEqual([]);
    expect(repo.list()).toEqual([]);
    expect(repo.get(a)).toBeNull();
    // A removed presentation is not an earlier import: importing the file again brings it in anew.
    expect(repo.findImported('text', null, '/b.txt')).toEqual([]);
    expect(repo.findByHash('text', 'h')).toBeNull();
    expect(repo.uniqueName(libraryId, 'A')).toBe('A');
    expect(repo.replace(a, { libraryId, name: 'A', groups: [] })).toBe(false);

    expect(repo.restore([a, 'missing'])).toEqual([a]);
    expect(repo.list().map((p) => p.name)).toEqual(['A']);
    expect(repo.purgeRemoved('2000-01-01T00:00:00Z')).toBe(0);
    expect(repo.purgeRemoved('9999-01-01T00:00:00Z')).toBe(1);
    expect(repo.restore([b])).toEqual([]);
    expect(db.prepare('SELECT name FROM presentations').all()).toEqual([{ name: 'A' }]);
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

describe('slide cues', () => {
  const addMedia = (id: string, kind: string, name: string, missing = false) =>
    db
      .prepare('INSERT INTO media (id, kind, name, path, missing) VALUES (?, ?, ?, ?, ?)')
      .run(id, kind, name, missing ? '' : `ab/${id}`, missing ? 1 : 0);

  it('loads background cues with their media, and leaves out cues Drashti does not run yet', () => {
    addMedia('m-video', 'video', 'Placeholder clouds.mp4');
    addMedia('m-gone', 'image', 'Placeholder gone.jpg', true);
    addMedia('m-audio', 'audio', 'Placeholder tone.mp3');
    const id = repo.insert({
      libraryId,
      name: 'Cues',
      groups: [
        {
          name: 'A',
          slides: [
            {
              elements: [],
              cues: [
                {
                  kind: 'background',
                  label: 'Clouds',
                  mediaId: 'm-video',
                  props: { media: 'video', fit: 'fill', loop: true },
                },
              ],
            },
            {
              elements: [],
              cues: [
                { kind: 'background', label: '', mediaId: 'm-gone', props: { fit: 'stretch' } },
                { kind: 'audio', label: 'Tone', mediaId: 'm-audio', props: { volume: 0.5 } },
              ],
            },
            {
              elements: [],
              cues: [
                { kind: 'background', label: 'Not a picture', mediaId: 'm-audio', props: {} },
                { kind: 'clear', label: 'Clear', mediaId: null, props: {} },
              ],
            },
          ],
        },
      ],
    });
    const slides = repo.get(id)?.groups[0]?.slides ?? [];
    expect(slides.map((s) => s.cues)).toEqual([
      [
        {
          kind: 'background',
          label: 'Clouds',
          name: 'Placeholder clouds.mp4',
          missing: false,
          background: { kind: 'media', mediaId: 'm-video', media: 'video', fit: 'fill', loop: true },
        },
      ],
      [
        {
          kind: 'background',
          label: '',
          name: 'Placeholder gone.jpg',
          missing: true,
          background: { kind: 'media', mediaId: 'm-gone', media: 'image', fit: 'stretch', loop: false },
        },
      ],
      [],
    ]);
    // The engine sees the same cues, by slide index.
    const source = new DbSlideSource(repo);
    expect(source.cues(id, 0)).toEqual(slides[0]?.cues);
    expect(source.cues(id, 9)).toEqual([]);
    expect(source.cues('nobody', 0)).toEqual([]);
  });

  it('reads cue settings defensively', () => {
    const row = {
      slide_id: 's',
      kind: 'background',
      label: '',
      props: 'not json',
      media_id: 'm',
      media_name: 'x.mp4',
      media_kind: 'video',
      media_missing: 0,
    };
    expect(cueFromRow(row)).toMatchObject({ background: { fit: 'fit', loop: false } });
    expect(cueFromRow({ ...row, props: '{"fit":"zoom","loop":"yes"}' })).toMatchObject({
      background: { fit: 'fit', loop: false },
    });
    expect(cueFromRow({ ...row, media_kind: 'image', props: '{"loop":true}' })).toMatchObject({
      background: { media: 'image', loop: false },
    });
    // A cue whose media item is gone, or that is not a background, does not run.
    expect(cueFromRow({ ...row, media_id: null })).toBeNull();
    expect(cueFromRow({ ...row, media_kind: null })).toBeNull();
    expect(cueFromRow({ ...row, kind: 'message' })).toBeNull();
  });
});
