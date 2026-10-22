import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SlideElement, TimerElement } from '../../shared/model';
import { DRASHTI_TIMER_LOOK, timerLayoutElements } from '../../shared/timer-slides';
import { applySlideEdit, editDocOf } from '../library/slides';
import { openDatabase } from './database';
import { LATEST_VERSION, MIGRATIONS, schemaVersion } from './migrate';
import { DbSlideSource, PresentationRepo } from './presentations';

/*
 * A Timer on a slide in the library (Session 50, migration 46): an element may be a timer, every row kept as
 * it was; a slide with one is saved from the slide editor, read back for it, and played, as it was.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-timer-elements-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const shape: SlideElement = {
  id: 'shape',
  kind: 'shape',
  frame: { x: 0, y: 0, width: 10, height: 10 },
  fill: '#3e63dd',
  cornerRadius: 0,
  opacity: 1,
};

const withoutIds = (els: readonly SlideElement[]) => els.map(({ id: _id, ...rest }) => rest);

describe('a Timer on a slide in the library', () => {
  it('migration 46: an element may be a timer, and every element stays as it was', () => {
    const file = join(dir, 'library.sqlite');
    const v45 = openDatabase(file, MIGRATIONS.slice(0, 45));
    expect(schemaVersion(v45)).toBe(45);
    const repo45 = new PresentationRepo(v45);
    repo45.insert({
      libraryId: repo45.ensureLibrary('Default'),
      name: 'Placeholder',
      groups: [{ name: '', slides: [{ elements: [shape] }, { elements: [shape] }] }],
    });
    const rows = (db: typeof v45) =>
      db
        .prepare('SELECT rowid, id, slide_id, position, kind, x, y, props FROM elements ORDER BY rowid')
        .all();
    const before = rows(v45);
    const indexes = (db: typeof v45) =>
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'elements' ORDER BY name",
        )
        .all();
    const indexesBefore = indexes(v45);
    expect(indexesBefore).toContainEqual({ name: 'elements_by_slide' });
    // Before: a timer could not be kept.
    const slideId = (v45.prepare('SELECT id FROM slides LIMIT 1').get() as { id: string }).id;
    const insert = (db: typeof v45, id: string, kind: string) =>
      db
        .prepare(
          "INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, props) VALUES (?, ?, 9, ?, 0, 0, 1, 1, '{}')",
        )
        .run(id, slideId, kind);
    expect(() => insert(v45, 'early', 'timer')).toThrow();
    v45.close();

    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(rows(db)).toEqual(before);
    insert(db, 'timer', 'timer');
    expect(() => insert(db, 'odd', 'odd')).toThrow();
    expect(indexes(db)).toEqual(indexesBefore);
    // A slide removed takes its elements with it, the timer too.
    db.prepare('DELETE FROM slides WHERE id = ?').run(slideId);
    expect(db.prepare('SELECT COUNT(*) AS n FROM elements WHERE slide_id = ?').get(slideId)).toEqual({
      n: 0,
    });
    db.close();
  });

  it('a slide with a Timer is saved from the slide editor, read back and played as it was', () => {
    const db = openDatabase(':memory:');
    const repo = new PresentationRepo(db);
    const id = repo.insert({
      libraryId: repo.ensureLibrary('Default'),
      name: 'Placeholder',
      groups: [{ name: 'Verse', slides: [{ elements: [shape] }] }],
    });
    const rows = repo.content(id);
    if (!rows) throw new Error('no content');
    const { doc } = editDocOf(rows, 'Placeholder');
    let n = 0;
    const made = timerLayoutElements('words', 't1', DRASHTI_TIMER_LOOK, doc, () => `new-${String(++n)}`);
    const timer = { ...(made[1] as TimerElement), lastMinute: { color: '#f5a524' }, atZero: 'next' as const };
    const elements = [made[0] as SlideElement, timer];
    const group = doc.groups[0];
    const first = group?.slides[0];
    if (!group || !first) throw new Error('no slide');
    const edited = {
      ...doc,
      groups: [{ ...group, slides: [first, { ...first, id: 'new-slide', elements, cues: [] }] }],
    };
    repo.setContent(applySlideEdit(rows, edited));
    const back = repo.content(id);
    if (!back) throw new Error('no content');
    const read = editDocOf(back, 'Placeholder');
    expect(read.unreadable).toBe(0);
    expect(withoutIds(read.doc.groups[0]?.slides[1]?.elements ?? [])).toEqual(withoutIds(elements));
    // Played: the slide carries its Timer, for every screen to draw.
    const played = new DbSlideSource(repo).order(id)?.slides[1]?.slide.elements ?? [];
    expect(withoutIds(played)).toEqual(withoutIds(elements));
    db.close();
  });
});
