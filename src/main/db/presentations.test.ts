import { beforeEach, describe, expect, it } from 'vitest';
import { summariesOf } from '../../shared/library';
import type { SlideElement, TextElement } from '../../shared/model';
import { readContent, writeContent } from './content';
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
      groups: [
        { name: 'G', slides: [{ elements: [text('gu', 'એક'), { ...text('tr', 'ek'), lang: 'translit' }] }] },
      ],
      kirtan: { category: 'Kirtan' },
    });
    const list = repo.list();
    expect(list.map((p) => [p.name, p.slideCount, p.kirtanTracks])).toEqual([
      ['A kirtan', 1, ['gu', 'translit']],
      ['b plain', 2, null],
    ]);
    // A kirtan's details come with it (as stored, read in the operator window), to filter the library by.
    expect(summariesOf(list).map((p) => p.kirtan)).toEqual([
      { category: 'Kirtan', kavi: null, raag: null, occasions: [] },
      null,
    ]);
  });

  it('returns a kirtan’s details, and its tracks from its words', () => {
    const id = repo.insert({
      libraryId,
      name: 'K',
      groups: [
        {
          name: 'G',
          slides: [
            { elements: [{ ...text('en', 'one'), lang: 'en' }, text('gu', 'એક')] },
            { elements: [{ ...text('hi', 'दो'), lang: 'hi' }] },
          ],
        },
      ],
      kirtan: { category: 'Dhun', kavi: 'Placeholder Kavi', raag: 'Placeholder Raag', occasions: ['Diwali'] },
    });
    const doc = repo.get(id);
    expect(doc?.kirtan).toEqual({
      category: 'Dhun',
      kavi: 'Placeholder Kavi',
      raag: 'Placeholder Raag',
      occasions: ['Diwali'],
      audioMediaId: null,
      tracks: ['en', 'gu', 'hi'],
    });
    // Its slides are marked, so each screen shows them in its own languages; other slides are not.
    expect(doc?.groups[0]?.slides.map((s) => s.slide.kirtan)).toEqual([true, true]);
    const plain = repo.insert({ libraryId, name: 'P', groups: [{ name: 'G', slides: [{ elements: [] }] }] });
    expect(repo.get(plain)?.groups[0]?.slides[0]?.slide.kirtan).toBeUndefined();
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
    expect(source.order(id)?.slides).toHaveLength(2);
    expect(source.order(id)?.slides[1]?.slide.elements[0]).toMatchObject({ text: 'b' });
    expect(source.order(id)?.slides[2]).toBeUndefined();
    expect(source.order('missing')).toBeNull();
    db.prepare('DELETE FROM presentations WHERE id = ?').run(id);
    expect(source.order(id)?.slides).toHaveLength(2);
    source.invalidate(id);
    expect(source.order(id)).toBeNull();
  });
});

describe('slide cues', () => {
  const addMedia = (id: string, kind: string, name: string, missing = false) =>
    db
      .prepare('INSERT INTO media (id, kind, name, path, missing) VALUES (?, ?, ?, ?, ?)')
      .run(id, kind, name, missing ? '' : `ab/${id}`, missing ? 1 : 0);

  it('loads background and audio cues with their media, and leaves out cues Drashti does not run yet', () => {
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
          unplayable: null,
          background: { kind: 'media', mediaId: 'm-video', media: 'video', fit: 'fill', loop: true },
        },
      ],
      [
        {
          kind: 'background',
          label: '',
          name: 'Placeholder gone.jpg',
          missing: true,
          unplayable: null,
          background: { kind: 'media', mediaId: 'm-gone', media: 'image', fit: 'stretch', loop: false },
        },
        {
          kind: 'audio',
          label: 'Tone',
          name: 'Placeholder tone.mp3',
          missing: false,
          unplayable: null,
          mediaId: 'm-audio',
          volume: 0.5,
          loop: false,
        },
      ],
      [],
    ]);
    // The engine sees the same cues, by slide position.
    const source = new DbSlideSource(repo);
    expect(source.order(id)?.slides[0]?.cues).toEqual(slides[0]?.cues);
    expect(source.order(id)?.slides[9]).toBeUndefined();
    expect(source.order('nobody')).toBeNull();
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
    // A cue whose media item is gone, or of a kind Drashti does not run yet, does not run.
    expect(cueFromRow({ ...row, media_id: null })).toBeNull();
    expect(cueFromRow({ ...row, media_kind: null })).toBeNull();
    expect(cueFromRow({ ...row, kind: 'message' })).toBeNull();
    // Audio: a sound file or a video's sound; volume kept between 0 and 1.
    const audio = { ...row, kind: 'audio', media_kind: 'audio' };
    expect(cueFromRow({ ...audio, props: '{"volume":0.4,"loop":true}' })).toMatchObject({
      volume: 0.4,
      loop: true,
    });
    expect(cueFromRow({ ...audio, props: '{"volume":3}' })).toMatchObject({ volume: 1, loop: false });
    expect(cueFromRow({ ...audio, props: '{"volume":"loud"}' })).toMatchObject({ volume: 1 });
    expect(cueFromRow({ ...audio, media_kind: 'video' })).toMatchObject({ kind: 'audio' });
    expect(cueFromRow({ ...audio, media_kind: 'image' })).toBeNull();
    // Media found at import to be unplayable says what it is.
    expect(
      cueFromRow({ ...row, media_playable: 0, media_format: 'ProRes 422 video (QuickTime)' }),
    ).toMatchObject({
      unplayable: 'ProRes 422 video (QuickTime)',
    });
    expect(cueFromRow({ ...row, media_playable: 1, media_format: 'H.264 video (MP4)' })).toMatchObject({
      unplayable: null,
    });
  });
});

describe('what the slide editor adds', () => {
  /** Every new kind of thing an element can have, on placeholder content. */
  const elements: SlideElement[] = [
    {
      ...text('words', 'Placeholder words'),
      rotation: 12.5,
      style: {
        ...text('x', '').style,
        shadow: { color: '#000000aa', blur: 8, x: 3, y: 4 },
        outline: { color: '#ff0000', width: 2 },
        shrinkToFit: true,
      },
      runs: [
        { text: 'Placeholder ', shadow: true, outline: null },
        {
          text: 'words',
          shadow: { color: '#112233', blur: 0, x: -2, y: 2 },
          outline: { color: '#00ff00', width: 1 },
        },
      ],
    },
    {
      id: 'oval',
      kind: 'shape',
      shape: 'ellipse',
      frame: { x: 100, y: 100, width: 300, height: 200 },
      fill: null,
      cornerRadius: 0,
      opacity: 0.8,
      outline: { color: '#ffffff', width: 6 },
    },
    {
      id: 'rule',
      kind: 'shape',
      shape: 'line',
      frame: { x: 100, y: 600, width: 800, height: 20 },
      rotation: -30,
      fill: null,
      cornerRadius: 0,
      opacity: 1,
      outline: { color: '#e5484d', width: 4 },
    },
    {
      id: 'clip',
      kind: 'video',
      frame: { x: 1200, y: 100, width: 640, height: 360 },
      rotation: 90,
      mediaId: 'placeholder-media',
      fit: 'fill',
      loop: true,
      volume: 0.4,
    },
  ];

  it('keeps rotation, shapes, outlines, shadows, shrink-to-fit and a video’s sound', () => {
    const id = repo.insert({
      libraryId,
      name: 'Placeholder look',
      groups: [{ name: 'A', slides: [{ elements }] }],
    });
    const shown = repo.get(id)?.groups[0]?.slides[0]?.slide.elements ?? [];
    expect(shown.map(({ id: _id, ...rest }) => rest)).toEqual(elements.map(({ id: _id, ...rest }) => rest));
    // Rotation lives in its own column, never inside the element's own data.
    const rows = db.prepare('SELECT rotation, props FROM elements ORDER BY position').all() as {
      rotation: number;
      props: string;
    }[];
    expect(rows.map((r) => r.rotation)).toEqual([12.5, 0, -30, 90]);
    expect(rows.every((r) => !('rotation' in (JSON.parse(r.props) as object)))).toBe(true);
  });

  it('keeps each slide’s transition and auto-advance, and the presentation’s transition and loop', () => {
    const id = repo.insert({
      libraryId,
      name: 'Placeholder timed',
      transition: { kind: 'dissolve', durationMs: 800 },
      loop: true,
      groups: [
        {
          name: 'A',
          slides: [
            { elements: [], transition: { kind: 'cut', durationMs: 0 }, autoAdvanceMs: 5000 },
            { elements: [], transition: { kind: 'dissolve', durationMs: 1500 } },
            { elements: [] },
          ],
        },
      ],
    });
    const doc = repo.get(id);
    expect(doc).toMatchObject({ transition: { kind: 'dissolve', durationMs: 800 }, loop: true });
    expect(doc?.groups[0]?.slides.map((sl) => [sl.transition, sl.autoAdvanceMs])).toEqual([
      [{ kind: 'cut', durationMs: 0 }, 5000],
      [{ kind: 'dissolve', durationMs: 1500 }, null],
      [null, null],
    ]);
    // Written back as rows (the editor, Undo), nothing is lost.
    const rows = readContent(db, id);
    expect(rows).toMatchObject({ loop: 1, transition: '{"kind":"dissolve","durationMs":800}' });
    if (!rows) return;
    writeContent(db, { ...rows, loop: 0, transition: null });
    expect(repo.get(id)).toMatchObject({ transition: null, loop: false });
    writeContent(db, rows);
    expect(repo.get(id)).toMatchObject({ transition: { kind: 'dissolve', durationMs: 800 }, loop: true });
    expect(readContent(db, id)).toEqual(rows);
  });

  it('reads a transition it cannot use as none', () => {
    const id = repo.insert({
      libraryId,
      name: 'Placeholder odd',
      groups: [{ name: 'A', slides: [{ elements: [] }] }],
    });
    db.prepare(`UPDATE slides SET transition = '{"kind":"spin","durationMs":5}'`).run();
    db.prepare(`UPDATE presentations SET transition = '{"kind":"dissolve","durationMs":-1}'`).run();
    const doc = repo.get(id);
    expect(doc?.transition).toBeNull();
    expect(doc?.groups[0]?.slides[0]?.transition).toBeNull();
  });
});
