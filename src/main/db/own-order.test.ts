import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlaylistItemInfo } from '../../shared/playlists';
import { type Db, openDatabase } from './database';
import { LATEST_VERSION, MIGRATIONS, schemaVersion } from './migrate';
import { PlaylistRepo } from './playlists';
import { PresentationRepo } from './presentations';

/*
 * Session 55, Part 4b (migration 55): a playlist item's own order of its presentation's slides, kept with the item
 * (`playlist_items.own_order`), never in the library's presentation. A slide's row dragged out of its deck becomes an
 * item of its own, the deck's item keeping the rest, in one write. Duplicate and the templates copy the order; the
 * engine plays it as the order "item:<id>". An older library (schema 49) opens with every item as it was.
 * Placeholder names only.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-own-order-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A library with a deck of four slides in a playlist (the deck, then a header). */
function library(db: Db = openDatabase(':memory:')) {
  const presentations = new PresentationRepo(db);
  const playlists = new PlaylistRepo(db);
  const deck = presentations.insert({
    libraryId: presentations.ensureLibrary('Placeholder library'),
    name: 'Placeholder deck',
    groups: [{ name: '', slides: [{ elements: [] }, { elements: [] }, { elements: [] }, { elements: [] }] }],
  });
  const slideIds = (presentations.get(deck)?.groups[0]?.slides ?? []).map((s) => s.id);
  const list = playlists.create('Placeholder Sunday', null, false) ?? '';
  const [item = '', header = ''] = playlists.addItems(list, null, [
    { kind: 'presentation', presentationId: deck },
    { kind: 'header', label: 'Placeholder part' },
  ]);
  return { db, presentations, playlists, deck, slideIds, list, item, header };
}

const orderOf = (playlists: PlaylistRepo, list: string, id: string) =>
  (playlists.itemsOf(list).find((i) => i.id === id) as Extract<PlaylistItemInfo, { kind: 'presentation' }>)
    .order;

describe('an item’s own order of slides', () => {
  it('is kept with the item, read back as it was, and played by the engine as "item:<id>"', () => {
    const { playlists, list, item, slideIds } = library();
    const [s1 = '', s2 = '', s3 = '', s4 = ''] = slideIds;
    const own = { mode: 'slides' as const, slideIds: [s3, s1, s2, s4], known: slideIds };
    expect(playlists.setItemOrder(item, own)).toBe(true);
    expect(orderOf(playlists, list, item)).toEqual(own);
    expect(playlists.playItems(list)?.[0]).toMatchObject({
      kind: 'presentation',
      arrangementId: `item:${item}`,
    });
    // The item's own order, read for the engine by its id.
    expect(playlists.ownOrder(item)).toEqual({ presentationId: expect.any(String), order: own });
    // Back to the presentation's own order: the own order goes.
    expect(playlists.setItemOrder(item, { mode: 'presentation' })).toBe(true);
    expect(orderOf(playlists, list, item)).toEqual({ mode: 'presentation' });
    expect(playlists.ownOrder(item)).toBeNull();
  });

  it('never changes the library’s presentation', () => {
    const { presentations, playlists, item, deck, slideIds } = library();
    const before = JSON.stringify(presentations.get(deck));
    playlists.setItemOrder(item, { mode: 'slides', slideIds: [...slideIds].reverse(), known: slideIds });
    expect(JSON.stringify(presentations.get(deck))).toBe(before);
  });

  it('takes a slide out of its deck into an item of its own, where it was dropped, the deck keeping the rest', () => {
    const { playlists, list, item, header, slideIds, deck } = library();
    const [s1 = '', s2 = '', s3 = '', s4 = ''] = slideIds;
    const rest = { mode: 'slides' as const, slideIds: [s1, s3, s4], known: slideIds };
    const alone = { mode: 'slides' as const, slideIds: [s2] };
    // Dropped after the header (the end).
    const made = playlists.splitItem(item, rest, alone, 2);
    expect(made).not.toBeNull();
    const items = playlists.itemsOf(list);
    expect(items.map((i) => i.id)).toEqual([item, header, made]);
    expect(items[2]).toMatchObject({ kind: 'presentation', presentationId: deck, label: 'Placeholder deck' });
    expect(orderOf(playlists, list, made ?? '')).toEqual(alone);
    expect(orderOf(playlists, list, item)).toEqual(rest);
    // Only an own order of slides can be given; a gone item takes nothing.
    expect(playlists.splitItem(item, { mode: 'all' }, alone, 0)).toBeNull();
    expect(playlists.splitItem('missing', rest, alone, 0)).toBeNull();
  });

  it('is copied by Duplicate and kept by a template and the playlists made from it', () => {
    const { playlists, list, item, slideIds } = library();
    const own = { mode: 'slides' as const, slideIds: [...slideIds].reverse(), known: slideIds };
    playlists.setItemOrder(item, own);
    const copy = playlists.duplicate(list) ?? '';
    expect(playlists.itemsOf(copy)[0]).toMatchObject({ kind: 'presentation', order: own });
    const template = playlists.saveAsTemplate(list, 'Placeholder template', []) ?? '';
    expect(playlists.itemsOf(template)[0]).toMatchObject({ order: own });
    const fromTemplate = playlists.newFromTemplate(template, 'Placeholder from template', null) ?? '';
    expect(playlists.itemsOf(fromTemplate)[0]).toMatchObject({ order: own });
  });

  it('upgrades an older library (schema 49): the column is there, empty, every item playing as it did', () => {
    const file = join(dir, 'library.sqlite');
    const v49 = openDatabase(
      file,
      MIGRATIONS.filter((m) => m.version <= 49),
    );
    expect(schemaVersion(v49)).toBe(49);
    const old = library(v49);
    // Every slide in order, as an older Drashti writes it.
    v49.prepare("UPDATE playlist_items SET order_mode = 'all' WHERE id = ?").run(old.item);
    const columns = (db: Db) =>
      (db.prepare('PRAGMA table_info(playlist_items)').all() as { name: string }[]).map((c) => c.name);
    expect(columns(v49)).not.toContain('own_order');
    v49.close();
    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(columns(db)).toContain('own_order');
    const playlists = new PlaylistRepo(db);
    expect(orderOf(playlists, old.list, old.item)).toEqual({ mode: 'all' });
    expect(playlists.playItems(old.list)?.[0]).toMatchObject({ arrangementId: null });
    db.close();
  });
});
