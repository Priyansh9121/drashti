import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MediaElement, ShapeElement, TextElement } from '../../shared/model';
import type { EditDoc } from '../../shared/slide-edit';
import { editDocSchema, slidesOf } from '../../shared/slide-edit';
import type { ContentRows } from '../db/content';
import { type Db, openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import { PresentationRepo } from '../db/presentations';
import { MediaStore } from '../import/media-store';
import { runImport } from '../import/pipeline';
import { cocoaRtf, pp6Presentation } from '../import/testing/pp6-fixtures';
import { pp7Presentation } from '../import/testing/pp7-fixtures';
import { applySlideEdit, editDocOf } from './slides';

/** What the window sends and the main process checks: the document as validated data. */
const asSaved = (doc: EditDoc): EditDoc => editDocSchema.parse(JSON.parse(JSON.stringify(doc)));

const line = (text: string) => cocoaRtf([[text, 72, [255, 255, 255]]]);

/** Import placeholder files into a fresh library; returns it and the presentations' ids. */
async function imported(files: Record<string, string | Uint8Array>): Promise<{ db: Db; ids: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-slides-'));
  const source = join(dir, 'source');
  mkdirSync(source);
  mkdirSync(join(dir, 'Media'));
  mkdirSync(join(dir, 'temp'));
  const db = openDatabase(join(dir, 'drashti.sqlite'));
  const media = new MediaStore(db, { dir: join(dir, 'Media'), freeBytes: () => 1024 ** 4, reserveBytes: 0 });
  const paths = Object.entries(files).map(([name, content]) => {
    const path = join(source, name);
    writeFileSync(path, content);
    return path;
  });
  const run = await runImport({
    db,
    media,
    runId: randomUUID(),
    paths,
    options: {},
    tempDir: join(dir, 'temp'),
    progressEveryMs: 0,
  });
  const report = new ImportRepo(db).report(run.id);
  const ids = paths.map((p) => report?.items.find((i) => i.sourcePath === p)?.target?.id ?? '');
  return { db, ids };
}

/** Each row that differs between two copies of a presentation's content, as "table id". */
function differences(a: ContentRows, b: ContentRows): string[] {
  const out: string[] = [];
  const tables = ['groups', 'slides', 'elements', 'cues', 'arrangements', 'arrangementEntries'] as const;
  for (const table of tables) {
    const left = a[table] as { id?: string; arrangement_id?: string; position: number }[];
    const right = b[table] as { id?: string; arrangement_id?: string; position: number }[];
    const key = (r: { id?: string; arrangement_id?: string; position: number }) =>
      r.id ?? `${r.arrangement_id ?? ''}#${r.position}`;
    const byKey = new Map(right.map((r) => [key(r), r]));
    for (const row of left) {
      const other = byKey.get(key(row));
      if (!other) out.push(`${table} ${key(row)} gone`);
      else if (JSON.stringify(row) !== JSON.stringify(other)) out.push(`${table} ${key(row)}`);
      byKey.delete(key(row));
    }
    for (const k of byKey.keys()) out.push(`${table} ${k} new`);
  }
  for (const k of ['transition', 'loop', 'selectedArrangementId', 'themeId', 'kirtan'] as const)
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  return out;
}

describe('the slide editor’s document', () => {
  it('round-trips a ProPresenter 6 import losslessly, moving one element and nothing else', async () => {
    const { db, ids } = await imported({
      'Placeholder Six.pro6': pp6Presentation({
        uuid: 'SIX',
        groups: [
          {
            name: 'Verse',
            uuid: 'G-V',
            slides: [
              {
                label: 'One',
                notes: 'Placeholder note',
                text: [
                  { rtf: line('Placeholder first'), outline: { color: '1 0 0 1', width: 2 }, rotation: 10 },
                ],
                shapes: [{ kind: 'circle', rect: [10, 10, 100, 100], fill: '0 0 1 1' }],
                transition: { type: 0, seconds: 1 },
                timer: { seconds: 5 },
                clear: true,
              },
              { text: [{ rtf: line('Placeholder second') }], transition: { type: 12, seconds: 0.5 } },
            ],
          },
          { name: 'Chorus', uuid: 'G-C', slides: [{ text: [{ rtf: line('Placeholder chorus') }] }] },
        ],
        arrangements: [{ name: 'Sung', groups: ['G-V', 'G-C', 'G-V'] }],
        selectedArrangement: 0,
      }),
    });
    const repo = new PresentationRepo(db);
    const id = ids[0] ?? '';
    const before = repo.content(id);
    if (!before) throw new Error('not imported');
    const { doc, unreadable } = editDocOf(before, 'Placeholder Six');
    expect(unreadable).toBe(0);
    // Nothing changed: every row exactly as it was.
    expect(differences(before, applySlideEdit(before, asSaved(doc)))).toEqual([]);

    // Move one text box.
    const moved = structuredClone(doc);
    const box = slidesOf(moved)[0]?.elements.find((e) => e.kind === 'text');
    if (!box) throw new Error('no text box');
    box.frame = { ...box.frame, x: box.frame.x + 40, y: box.frame.y - 25 };
    const after = applySlideEdit(before, asSaved(moved));
    expect(differences(before, after)).toEqual([`elements ${box.id}`]);
    const was = before.elements.find((e) => e.id === box.id);
    const now = after.elements.find((e) => e.id === box.id);
    // Only its place: its own data is the very same text.
    expect({ ...now, x: was?.x, y: was?.y }).toEqual(was);
    expect([now?.x, now?.y]).toEqual([(was?.x ?? 0) + 40, (was?.y ?? 0) - 25]);
    // Stored and read back, it is still exactly that.
    repo.setContent(after);
    expect(differences(after, repo.content(id) ?? before)).toEqual([]);
    db.close();
  });

  it('round-trips a ProPresenter 7 import losslessly, moving one element and nothing else', async () => {
    const { db, ids } = await imported({
      'Placeholder Seven.pro': pp7Presentation({
        uuid: 'SEVEN',
        name: 'Placeholder Seven',
        transition: { seconds: 0.7, effect: 'Dissolve' },
        groups: [
          {
            name: 'Verse',
            uuid: 'G-V',
            slides: [
              {
                id: 'a',
                text: [
                  {
                    rtf: line('Placeholder seven'),
                    stroke: { width: 3, color: [1, 1, 1, 1] },
                    shadow: { angle: 315, offset: 4, radius: 2 },
                    scale: 2,
                    rotation: 5,
                  },
                ],
                shapes: [
                  { rect: [10, 10, 200, 100], path: { type: 11, roundness: 0.2 }, fill: [0, 0, 0, 0.5] },
                ],
                transition: { seconds: 1 },
                completion: { target: 1, action: 3, seconds: 3 },
              },
              { id: 'b', text: [{ rtf: line('Placeholder eight') }] },
            ],
          },
        ],
      }),
    });
    const repo = new PresentationRepo(db);
    const id = ids[0] ?? '';
    const before = repo.content(id);
    if (!before) throw new Error('not imported');
    const { doc } = editDocOf(before, 'Placeholder Seven');
    expect(differences(before, applySlideEdit(before, asSaved(doc)))).toEqual([]);
    const moved = structuredClone(doc);
    const shape = slidesOf(moved)[0]?.elements.find(
      (e): e is ShapeElement => e.kind === 'shape' && e.fill !== null,
    );
    if (!shape) throw new Error('no shape');
    shape.frame = { ...shape.frame, x: 300 };
    const after = applySlideEdit(before, asSaved(moved));
    expect(differences(before, after)).toEqual([`elements ${shape.id}`]);
    db.close();
  });
});

describe('putting edited slides back', () => {
  /** A small presentation stored the usual way, with an element that cannot be read and data Drashti does not know. */
  function stored() {
    const db = openDatabase(':memory:');
    const repo = new PresentationRepo(db);
    const libraryId = repo.ensureLibrary('Default');
    const text = (value: string): TextElement => ({
      id: 'x',
      kind: 'text',
      frame: { x: 0, y: 0, width: 800, height: 200 },
      text: value,
      lang: 'en',
      style: {
        fontFamily: null,
        fontSize: 72,
        fontWeight: 400,
        color: '#ffffff',
        align: 'center',
        verticalAlign: 'middle',
        lineHeight: 1.2,
        shadow: true,
      },
    });
    const id = repo.insert({
      libraryId,
      name: 'Placeholder edit',
      groups: [
        { name: 'Verse', slides: [{ elements: [text('Placeholder one'), text('Placeholder two')] }] },
        { name: 'Chorus', slides: [{ elements: [text('Placeholder chorus')] }] },
      ],
      arrangements: [{ name: 'Sung', groups: [0, 1, 0, 1] }],
      selectedArrangement: 0,
    });
    const slide = (db.prepare('SELECT s.id FROM slides s ORDER BY s.rowid LIMIT 1').get() as { id: string })
      .id;
    // Something a newer Drashti wrote, and an element that cannot be read.
    db.prepare(
      `UPDATE elements SET props = json_set(props, '$.future', 'kept') WHERE id = (SELECT id FROM elements WHERE slide_id = ? ORDER BY position LIMIT 1)`,
    ).run(slide);
    db.prepare(
      `INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, props) VALUES ('odd', ?, 1, 'shape', 0, 0, 10, 10, '{"fill": 7}')`,
    ).run(slide);
    db.prepare('UPDATE elements SET position = 2 WHERE slide_id = ? AND id != ? AND position = 1').run(
      slide,
      'odd',
    );
    return { db, repo, id };
  }

  it('keeps editor guides with the slide through validation, storage and Undo; old slides have none', () => {
    const { db, repo, id } = stored();
    try {
      const columns = db.pragma('table_info(slides)') as { name: string }[];
      expect(columns.map((column) => column.name)).toContain('editor_guides');
      const before = repo.content(id);
      if (!before) throw new Error('missing');
      const { doc } = editDocOf(before, 'Placeholder guides');
      const first = slidesOf(doc)[0];
      if (!first) throw new Error('missing slide');
      expect(first).not.toHaveProperty('guides');
      const guides = { x: [240, 960], y: [180] };
      Object.assign(first, { guides });
      repo.setContent(applySlideEdit(before, asSaved(doc)));
      const after = repo.content(id);
      if (!after) throw new Error('missing stored slide');
      expect(slidesOf(editDocOf(after, 'Placeholder guides').doc)[0]).toHaveProperty('guides', guides);
      repo.setContent(before);
      const restored = repo.content(id);
      if (!restored) throw new Error('missing restored slide');
      expect(slidesOf(editDocOf(restored, 'Placeholder guides').doc)[0]).not.toHaveProperty('guides');
    } finally {
      db.close();
    }
  });

  it('keeps a slide’s darkening behind the words, for the editor and the screens; a slide made before has none (Sessions 31–36, SLD-3)', () => {
    const { repo, id } = stored();
    const before = repo.content(id);
    if (!before) throw new Error('missing');
    const { doc } = editDocOf(before, 'Placeholder edit');
    const [first, second] = slidesOf(doc);
    expect(first?.darken).toBeNull();
    if (first) first.darken = { kind: 'whole', strength: 0.8 };
    repo.setContent(applySlideEdit(before, asSaved(doc)));
    const stored2 = repo.content(id);
    if (!stored2) throw new Error('missing');
    // The editor reads it back; the other slide still has none.
    const again = slidesOf(editDocOf(stored2, 'Placeholder edit').doc);
    expect(again.map((s) => s.darken)).toEqual([{ kind: 'whole', strength: 0.8 }, null]);
    expect(second?.darken).toBeNull();
    // The screens get it with the slide; a slide without it has no darken at all (the same data as before).
    const shown = repo.get(id)?.groups.flatMap((g) => g.slides.map((s) => s.slide));
    expect(shown?.[0]?.darken).toEqual({ kind: 'whole', strength: 0.8 });
    expect(shown?.[1]).not.toHaveProperty('darken');
  });

  it('keeps the Words group’s looks: underlined, struck through, glowing words and lines of a list, for the editor and the screens (Session 55, Part 17a)', () => {
    const { repo, id } = stored();
    const before = repo.content(id);
    if (!before) throw new Error('missing');
    const { doc } = editDocOf(before, 'Placeholder edit');
    const box = slidesOf(doc)[1]?.elements[0];
    if (box?.kind !== 'text') throw new Error('no box');
    const styled: TextElement = {
      ...box,
      text: 'Placeholder one\nPlaceholder two',
      style: { ...box.style, glow: { color: '#00ffcc', size: 20 } },
      runs: [
        { text: 'Placeholder one\n', underline: true, strike: true, list: 'gu' },
        { text: 'Placeholder two', glow: null, list: 'gu', level: 1 },
      ],
    };
    const slide = slidesOf(doc)[1];
    if (slide) slide.elements = [styled];
    repo.setContent(applySlideEdit(before, asSaved(doc)));
    const after = repo.content(id);
    if (!after) throw new Error('missing');
    // The editor reads them back, and the screens get them with the slide.
    expect(slidesOf(editDocOf(after, 'Placeholder edit').doc)[1]?.elements[0]).toEqual(styled);
    const shown = repo.get(id)?.groups.flatMap((g) => g.slides.map((s) => s.slide));
    expect(shown?.[1]?.elements[0]).toMatchObject({ style: styled.style, runs: styled.runs });
  });

  it('keeps a deck’s slide as its import stored it, saving only Drashti’s transitions on it and its clicks (Session 54, C2)', () => {
    const { repo, id } = stored();
    const before = repo.content(id);
    if (!before) throw new Error('missing');
    // As C2's import keeps it (its own column): a deck's steps and media, and something a newer Drashti wrote.
    const deck = {
      transition: { name: 'push', durationMs: 500 },
      steps: [
        { clipId: 'clip0', clipMs: 1000, transitionMs: 500, lastId: 'last0' },
        { clipId: 'clip1', clipMs: 800, lastId: 'last1' },
      ],
      media: [],
      future: 'kept',
    };
    const storedDeck = JSON.stringify(deck);
    const rows: ContentRows = {
      ...before,
      slides: before.slides.map((r, i) => (i === 0 ? { ...r, deck: storedDeck } : r)),
    };
    const { doc } = editDocOf(rows, 'Placeholder edit');
    const [first, second] = slidesOf(doc);
    expect(first?.deck?.steps.map((st) => st.clipId)).toEqual(['clip0', 'clip1']);
    expect(second).not.toHaveProperty('deck');
    // Unchanged: stored exactly as it was.
    expect(applySlideEdit(rows, asSaved(doc)).slides[0]?.deck).toBe(storedDeck);
    // Drashti's own over the deck's, and a click's instead of its own; a step the window changed is not taken.
    if (first?.deck) {
      first.deck = {
        ...first.deck,
        drashti: { transition: { kind: 'dissolve', durationMs: 700 }, mode: 'over' },
        stepTransitions: { 1: { transition: { kind: 'fade-black', durationMs: 400 }, mode: 'instead' } },
        steps: [{ clipId: 'elsewhere', clipMs: 5, lastId: 'elsewhere' }],
      };
    }
    const saved = applySlideEdit(rows, asSaved(doc)).slides;
    expect(JSON.parse(saved[0]?.deck ?? 'null')).toEqual({
      ...deck,
      drashti: { transition: { kind: 'dissolve', durationMs: 700 }, mode: 'over' },
      stepTransitions: { 1: { transition: { kind: 'fade-black', durationMs: 400 }, mode: 'instead' } },
    });
    // The other slide has none to keep; and taken off again, the deck is as the import stored it.
    expect(saved[1]?.deck ?? null).toBeNull();
    if (first?.deck) {
      const { drashti: _d, stepTransitions: _s, ...plain } = first.deck;
      first.deck = plain;
    }
    expect(JSON.parse(applySlideEdit(rows, asSaved(doc)).slides[0]?.deck ?? 'null')).toEqual(deck);
  });

  it('stores the native timeline accepted by Main for an edited source slide and its copy', () => {
    const { db, repo, id } = stored();
    try {
      const before = repo.content(id);
      if (!before) throw new Error('Missing placeholder presentation');
      const { doc } = editDocOf(before, 'Placeholder native playback');
      const group = doc.groups[0];
      const source = group?.slides[0];
      if (!group || !source) throw new Error('Missing placeholder slide');
      const deck = {
        steps: [],
        media: [],
        motion: { approximate: false, stepsMs: [0], effects: [] },
      };
      source.deck = deck;
      source.documentPage = { sha256: '0'.repeat(64), ext: 'pptx', page: 0, edited: true };
      const copy = structuredClone(source);
      copy.id = 'placeholder-copy';
      copy.elements = copy.elements.map((element, i) => ({ ...element, id: `copy-element-${i}` }));
      copy.cues = copy.cues.map((cue, i) => ({ ...cue, id: `copy-cue-${i}` }));
      group.slides.push(copy);
      const rows = {
        ...before,
        slides: before.slides.map((row) =>
          row.id === source.id
            ? {
                ...row,
                deck: JSON.stringify({
                  ...deck,
                  steps: [{ clipId: 'placeholder-clip', clipMs: 400, lastId: 'placeholder-still' }],
                }),
              }
            : row,
        ),
      };
      const saved = applySlideEdit(rows, asSaved(doc));
      expect(JSON.parse(saved.slides[0]?.deck ?? 'null')).toEqual(deck);
      expect(JSON.parse(saved.slides[group.slides.length - 1]?.deck ?? 'null')).toEqual(deck);
    } finally {
      db.close();
    }
  });

  it('keeps data it does not know, and elements it cannot read in their place', () => {
    const { repo, id } = stored();
    const before = repo.content(id);
    if (!before) throw new Error('missing');
    const { doc, unreadable } = editDocOf(before, 'Placeholder edit');
    expect(unreadable).toBe(1);
    const first = slidesOf(doc)[0];
    // Change the words of the box with the unknown data.
    const box = first?.elements[0] as TextElement;
    box.text = 'Placeholder changed';
    const after = applySlideEdit(before, asSaved(doc));
    const row = after.elements.find((e) => e.id === box.id);
    expect(JSON.parse(row?.props ?? '{}')).toMatchObject({ text: 'Placeholder changed', future: 'kept' });
    expect(
      after.elements
        .filter((e) => e.slide_id === first?.id)
        .sort((a, b) => a.position - b.position)
        .map((e) => e.id),
    ).toEqual([box.id, 'odd', first?.elements[1]?.id]);
  });

  const savedPlacement = {
    motion: { in: { kind: 'fade', delayMs: 0, durationMs: 600 } },
    groupId: 'placeholder-placement-group',
    flipX: true,
    flipY: true,
  };
  const placementCases = [
    ...Object.entries(savedPlacement).flatMap(([key, value]) =>
      (['text', 'shape', 'image', 'video', 'timer'] as const).map((kind) => ({ kind, key, value })),
    ),
    ...(['image', 'video'] as const).map((kind) => ({
      kind,
      key: 'crop',
      value: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    })),
  ];

  it.each(placementCases)(
    'removes saved $key from a $kind while retaining unknown data and untouched JSON',
    ({ kind, key, value }) => {
      const { db, repo, id } = stored();
      try {
        const initial = repo.content(id);
        const target = initial?.elements.find((row) => row.kind === 'text');
        if (!initial || !target) throw new Error('missing placeholder element');
        const original = JSON.parse(target.props) as Record<string, unknown>;
        const byKind: Record<typeof kind, Record<string, unknown>> = {
          text: original,
          shape: { shape: 'rectangle', fill: '#123456', cornerRadius: 0, opacity: 1 },
          image: { mediaId: 'placeholder-picture', fit: 'fill' },
          video: { mediaId: 'placeholder-video', fit: 'fill' },
          timer: { timerId: 'placeholder-timer', style: original['style'] },
        };
        const future = { note: 'Placeholder future data', nested: [1, 2, 3] };
        const savedJson = JSON.stringify({ ...byKind[kind], [key]: value, future }, null, 2);
        db.prepare('UPDATE elements SET kind = ?, props = ? WHERE id = ?').run(kind, savedJson, target.id);
        const before = repo.content(id);
        if (!before) throw new Error('missing saved placeholder');
        const { doc } = editDocOf(before, 'Placeholder placement removal');
        const slide = slidesOf(doc).find((s) => s.elements.some((el) => el.id === target.id));
        const el = slide?.elements.find((e) => e.id === target.id);
        if (!slide || !el) throw new Error('saved placeholder could not be read');
        expect(el).toHaveProperty(key, value);

        // An untouched read/save must preserve the original JSON bytes, including its formatting.
        const unchanged = applySlideEdit(before, asSaved(doc));
        expect(unchanged.elements.find((row) => row.id === target.id)?.props).toBe(savedJson);

        // Match the UI's removal semantics: the optional property is absent, rather than false or undefined.
        slide.elements = slide.elements.map((element) =>
          element.id === target.id
            ? (Object.fromEntries(Object.entries(element).filter(([name]) => name !== key)) as typeof element)
            : element,
        );
        const after = applySlideEdit(before, asSaved(doc));
        const row = after.elements.find((e) => e.id === target.id);
        if (!row) throw new Error('missing edited row');
        const props = JSON.parse(row.props) as Record<string, unknown>;
        expect(props).not.toHaveProperty(key);
        expect(props['future']).toEqual(future);
        for (const untouched of before.elements.filter((e) => e.id !== target.id))
          expect(after.elements.find((e) => e.id === untouched.id)).toEqual(untouched);

        // Exercise the actual write/read path too: it must not resurrect the cleared setting.
        repo.setContent(after);
        const reopened = repo.content(id);
        if (!reopened) throw new Error('missing reopened placeholder');
        const reopenedElement = slidesOf(editDocOf(reopened, 'Placeholder placement removal').doc)
          .flatMap((s) => s.elements)
          .find((element) => element.id === target.id);
        expect(reopenedElement).not.toHaveProperty(key);
        expect(JSON.parse(reopened.elements.find((e) => e.id === target.id)?.props ?? '{}')).toHaveProperty(
          'future',
          future,
        );
        expect(
          repo
            .get(id)
            ?.groups.flatMap((g) => g.slides)
            .flatMap((s) => s.slide.elements)
            .find((element) => element.id === target.id),
        ).not.toHaveProperty(key);
      } finally {
        db.close();
      }
    },
  );

  it('unticks a video’s play bar on the screens: a setting Drashti knows is never kept as unknown data (Session 54)', () => {
    const db = openDatabase(':memory:');
    const repo = new PresentationRepo(db);
    const libraryId = repo.ensureLibrary('Default');
    const video: MediaElement = {
      id: 'v',
      kind: 'video',
      mediaId: 'placeholder-media',
      frame: { x: 0, y: 0, width: 640, height: 360 },
      fit: 'fit',
      playBar: true,
    };
    const id = repo.insert({
      libraryId,
      name: 'Placeholder play bar',
      groups: [{ name: 'Verse', slides: [{ elements: [video] }] }],
    });
    const before = repo.content(id);
    if (!before) throw new Error('missing');
    const { doc } = editDocOf(before, 'Placeholder play bar');
    const shown = slidesOf(doc)[0]?.elements[0] as MediaElement;
    expect(shown.playBar).toBe(true);
    // Unticked in the slide editor: its stored data has no play bar, and the screens draw none.
    delete shown.playBar;
    const after = applySlideEdit(before, asSaved(doc));
    const row = after.elements.find((e) => e.id === shown.id);
    expect(JSON.parse(row?.props ?? '{}')).not.toHaveProperty('playBar');
    repo.setContent(after);
    expect(repo.get(id)?.groups[0]?.slides[0]?.slide.elements[0]).not.toHaveProperty('playBar');
    // Ticked again: kept.
    const again = repo.content(id);
    if (!again) throw new Error('missing');
    const next = editDocOf(again, 'Placeholder play bar').doc;
    const el = slidesOf(next)[0]?.elements[0] as MediaElement;
    el.playBar = true;
    repo.setContent(applySlideEdit(again, asSaved(next)));
    expect(repo.get(id)?.groups[0]?.slides[0]?.slide.elements[0]).toMatchObject({ playBar: true });
  });

  it('gives new things ids of its own, and keeps arrangements to the groups that are left', () => {
    const { repo, id } = stored();
    const before = repo.content(id);
    if (!before) throw new Error('missing');
    const { doc } = editDocOf(before, 'Placeholder edit');
    const [verse] = doc.groups;
    if (!verse) throw new Error('no verse');
    // A new group with a new slide and a new element, from ids the window made up.
    doc.groups = [
      verse,
      {
        id: 'window-group',
        name: 'Bridge',
        color: '#8e4ec6',
        slides: [
          {
            id: 'window-slide',
            label: '',
            notes: '',
            background: null,
            darken: null,
            enabled: true,
            transition: { kind: 'dissolve', durationMs: 600 },
            autoAdvanceMs: 4000,
            macroId: null,
            elements: [{ ...(verse.slides[0]?.elements[0] as TextElement), id: 'window-element' }],
            cues: [],
          },
        ],
      },
    ];
    doc.loop = true;
    let n = 0;
    const after = applySlideEdit(before, asSaved(doc), () => `made-${++n}`);
    expect(after.groups.map((g) => [g.id === verse.id, g.name])).toEqual([
      [true, 'Verse'],
      [false, 'Bridge'],
    ]);
    const ids = [...after.groups, ...after.slides, ...after.elements].map((r) => r.id);
    expect(ids.filter((i) => i.startsWith('window-'))).toEqual([]);
    expect(ids.filter((i) => i.startsWith('made-'))).toHaveLength(3);
    expect(after.slides.find((s) => s.label === '' && s.auto_advance_ms === 4000)).toMatchObject({
      transition: '{"kind":"dissolve","durationMs":600}',
    });
    expect(after.loop).toBe(1);
    // The chorus is gone, so the arrangement keeps only the verse (sung twice).
    expect(after.arrangementEntries.map((e) => e.group_id)).toEqual([verse.id, verse.id]);
  });
});
