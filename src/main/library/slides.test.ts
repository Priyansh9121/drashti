import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ShapeElement, TextElement } from '../../shared/model';
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
            enabled: true,
            transition: { kind: 'dissolve', durationMs: 600 },
            autoAdvanceMs: 4000,
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
