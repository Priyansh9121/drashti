import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeckSlide } from '../../shared/deck';
import { deckFromJson } from '../../shared/deck-schema';
import { applySlideEdit, editDocOf } from '../library/slides';
import { openDatabase } from './database';
import { LATEST_VERSION, MIGRATIONS, schemaVersion } from './migrate';
import { PresentationRepo } from './presentations';

/*
 * A deck shown as it was (Session 54, C2; migration 49): a slide made from a deck carries its steps, its own
 * transition and its real media in `slides.deck`. An alpha.12 library (schema 47), and a backup of one, gains the
 * column empty; a deck's slide reads back whole, and keeps it through the slide editor's saving and the content
 * written back by Undo, words and themes.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-deck-slides-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const DECK: DeckSlide = {
  transition: { name: 'p:push', durationMs: 1000, soundId: 'chime' },
  deckAdvanceMs: 6250,
  steps: [
    { clipId: 'enter', clipMs: 1900, transitionMs: 1000, lastId: 'enter-last' },
    { clipId: 'click-1', clipMs: 2400, lastId: 'click-1-last', holdId: 'click-1-hold', holdMs: 2000 },
  ],
  media: [
    {
      kind: 'video',
      mediaId: 'clip',
      box: { x: 0.2, y: 0.2, w: 0.6, h: 0.5 },
      posterId: 'poster',
      clip: { startMs: 1000, endMs: 4000 },
      loop: true,
      volume: 0.8,
      start: { step: 0, offsetMs: 1060 },
    },
    {
      kind: 'audio',
      mediaId: 'tone',
      box: { x: 0.7, y: 0.3, w: 0.08, h: 0.14 },
      loop: false,
      volume: 1,
      start: { clicked: true },
      acrossSlides: 2,
      hideWhenStopped: true,
    },
  ],
};

const picture = (mediaId: string) => ({
  id: 'picture',
  kind: 'image' as const,
  frame: { x: 0, y: 0, width: 1920, height: 1080 },
  mediaId,
  fit: 'fit' as const,
});

describe('a deck’s slide in the library (Session 54, C2)', () => {
  it('upgrades an alpha.12 library and a backup of one: the column is there, empty, every slide as it was', () => {
    const file = join(dir, 'library.sqlite');
    const v47 = openDatabase(
      file,
      MIGRATIONS.filter((m) => m.version <= 47),
    );
    expect(schemaVersion(v47)).toBe(47);
    const repo47 = new PresentationRepo(v47);
    const id = repo47.insert({
      libraryId: repo47.ensureLibrary('Default'),
      name: 'Placeholder deck',
      groups: [{ name: '', slides: [{ elements: [picture('page-1')] }, { elements: [picture('page-2')] }] }],
    });
    const columns = (db: typeof v47) =>
      (db.prepare('PRAGMA table_info(slides)').all() as { name: string }[]).map((c) => c.name);
    expect(columns(v47)).not.toContain('deck');
    v47.close();
    // A backup is a copy of the library's file, opened (and upgraded) as the library when it is restored.
    const backup = join(dir, 'backup.sqlite');
    copyFileSync(file, backup);
    for (const path of [file, backup]) {
      const db = openDatabase(path);
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
      expect(columns(db)).toContain('deck');
      expect(db.prepare('SELECT COUNT(*) AS n FROM slides WHERE deck IS NOT NULL').get()).toEqual({ n: 0 });
      const doc = new PresentationRepo(db).get(id);
      const slides = doc?.groups.flatMap((g) => g.slides) ?? [];
      expect(slides.map((s) => s.slide.elements.map((e) => (e.kind === 'image' ? e.mediaId : '')))).toEqual([
        ['page-1'],
        ['page-2'],
      ]);
      // A slide from no deck is the same data as before: no `deck` at all.
      expect(slides.every((s) => !('deck' in s.slide))).toBe(true);
      db.close();
    }
  });

  it('reads a deck’s slide back whole, and a slide from no deck without one', () => {
    const db = openDatabase(':memory:');
    const repo = new PresentationRepo(db);
    const id = repo.insert({
      libraryId: repo.ensureLibrary('Default'),
      name: 'Placeholder deck',
      groups: [
        {
          name: '',
          slides: [{ elements: [picture('click-1-last')], deck: DECK }, { elements: [picture('page')] }],
        },
      ],
    });
    const slides = repo.get(id)?.groups.flatMap((g) => g.slides) ?? [];
    expect(slides[0]?.slide.deck).toEqual(DECK);
    expect(slides[1]?.slide).not.toHaveProperty('deck');
  });

  it('reads back Drashti’s own transitions set on a deck’s slide and on a click, over or instead of the deck’s', () => {
    const db = openDatabase(':memory:');
    const repo = new PresentationRepo(db);
    const own: DeckSlide = {
      ...DECK,
      drashti: { transition: { kind: 'dissolve', durationMs: 600 }, mode: 'over' },
      stepTransitions: { 1: { transition: { kind: 'cut', durationMs: 0 }, mode: 'instead' } },
    };
    const id = repo.insert({
      libraryId: repo.ensureLibrary('Default'),
      name: 'Placeholder deck',
      groups: [{ name: '', slides: [{ elements: [picture('click-1-last')], deck: own }] }],
    });
    expect(repo.get(id)?.groups[0]?.slides[0]?.slide.deck).toEqual(own);
  });

  it('a stored deck that does not read leaves the slide without one, its picture still there', () => {
    const db = openDatabase(':memory:');
    const repo = new PresentationRepo(db);
    const id = repo.insert({
      libraryId: repo.ensureLibrary('Default'),
      name: 'Placeholder deck',
      groups: [{ name: '', slides: [{ elements: [picture('last')], deck: DECK }] }],
    });
    db.prepare('UPDATE slides SET deck = ?').run(JSON.stringify({ steps: 'none', media: [] }));
    const slide = repo.get(id)?.groups[0]?.slides[0]?.slide;
    expect(slide).not.toHaveProperty('deck');
    expect(slide?.elements).toHaveLength(1);
    expect(deckFromJson('not json')).toBeNull();
    // A newer Drashti's own fields are kept as they are.
    expect(deckFromJson(JSON.stringify({ ...DECK, later: 1 }))).toEqual({ ...DECK, later: 1 });
  });

  it('keeps a deck’s slide through the slide editor’s saving and the content written back', () => {
    const db = openDatabase(':memory:');
    const repo = new PresentationRepo(db);
    const id = repo.insert({
      libraryId: repo.ensureLibrary('Default'),
      name: 'Placeholder deck',
      groups: [
        { name: '', slides: [{ elements: [picture('click-1-last')], deck: DECK, notes: 'Placeholder' }] },
      ],
    });
    const before = repo.content(id);
    if (!before) throw new Error('no content');
    // The words of its notes changed in the editor, and a new slide added after it.
    const { doc } = editDocOf(before, 'Placeholder deck');
    const group = doc.groups[0];
    const first = group?.slides[0];
    if (!group || !first) throw new Error('no slide');
    group.slides = [
      { ...first, notes: 'Placeholder, changed' },
      { ...first, id: 'new-slide', elements: [], notes: '' },
    ];
    repo.setContent(applySlideEdit(before, doc));
    const after = repo.get(id)?.groups.flatMap((g) => g.slides) ?? [];
    expect(after.map((s) => s.notes)).toEqual(['Placeholder, changed', '']);
    expect(after[0]?.slide.deck).toEqual(DECK);
    // A slide made in the editor is no deck's.
    expect(after[1]?.slide).not.toHaveProperty('deck');
    // Content read and written back as it is (Undo, a theme, words) keeps it too.
    const rows = repo.content(id);
    if (!rows) throw new Error('no content');
    repo.setContent(rows);
    expect(repo.get(id)?.groups[0]?.slides[0]?.slide.deck).toEqual(DECK);
  });
});
