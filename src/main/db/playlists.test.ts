import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYLIST_IDS_MAX, SHASTRA_SLOT, slotCategoryName } from '../../shared/playlists';
import { type Db, openDatabase } from './database';
import { PlaylistRepo } from './playlists';
import { PresentationRepo } from './presentations';
import { EXAMPLE_TEMPLATES, seedTemplates } from './seed';

let db: Db;
let playlists: PlaylistRepo;
let presentations: PresentationRepo;
let hymn: string;
let dhun: string;

beforeEach(() => {
  db = openDatabase(':memory:');
  playlists = new PlaylistRepo(db);
  presentations = new PresentationRepo(db);
  const lib = presentations.ensureLibrary('Kirtans');
  hymn = presentations.insert({
    libraryId: lib,
    name: 'Placeholder Hymn',
    groups: [
      { name: 'Verse', slides: [{ elements: [] }] },
      { name: 'Chorus', slides: [{ elements: [] }] },
    ],
    arrangements: [{ name: 'Usual', groups: [0, 1, 0] }],
  });
  dhun = presentations.insert({
    libraryId: lib,
    name: 'Placeholder Dhun',
    groups: [{ name: 'A', slides: [{ elements: [] }] }],
  });
  db.prepare(
    "INSERT INTO media (id, kind, name, path, playable, format) VALUES ('loop', 'video', 'Placeholder loop.mp4', 'ab/x.mp4', 1, 'H.264 video (MP4)')",
  ).run();
  db.prepare(
    "INSERT INTO media (id, kind, name, path, playable, format) VALUES ('prores', 'video', 'Placeholder old.mov', 'cd/y.mov', 0, 'ProRes 422 video (QuickTime)')",
  ).run();
});

const labels = (id: string) => playlists.itemsOf(id).map((i) => i.label);

describe('playlists the operator edits', () => {
  it('give a media row its file’s own name beside its label, read from the library, never kept twice (C18, FT-2)', () => {
    const id = playlists.create('Placeholder Sunday', null, false) ?? '';
    playlists.addItems(id, null, [{ kind: 'media', mediaId: 'loop' }]);
    const itemId = playlists.itemsOf(id)[0]?.id ?? '';
    // A label of the row's own (an import's, a folder's), then the file renamed in the library: each as it is.
    db.prepare('UPDATE playlist_items SET label = ? WHERE id = ?').run('Placeholder row label', itemId);
    db.prepare("UPDATE media SET name = 'Placeholder renamed.mp4' WHERE id = 'loop'").run();
    expect(playlists.itemsOf(id)[0]).toMatchObject({
      kind: 'media',
      label: 'Placeholder row label',
      mediaName: 'Placeholder renamed.mp4',
    });
  });

  it('say on each card what an item is: a deck, its slides, a video’s length (Session 26a)', () => {
    const id = playlists.create('Placeholder Sunday', null, false) ?? '';
    db.prepare("UPDATE presentations SET source_kind = 'pictures' WHERE id = ?").run(dhun);
    db.prepare("UPDATE media SET duration_ms = 65000 WHERE id = 'loop'").run();
    playlists.addItems(id, null, [
      { kind: 'presentation', presentationId: hymn },
      { kind: 'presentation', presentationId: dhun },
      { kind: 'media', mediaId: 'loop' },
      { kind: 'media', mediaId: 'prores' },
    ]);
    expect(
      playlists
        .itemsOf(id)
        .map((i) =>
          i.kind === 'presentation' ? [i.slideCount, i.deck] : i.kind === 'media' ? [i.durationMs] : [],
        ),
    ).toEqual([[2, false], [1, true], [65000], [null]]);
  });

  it('makes playlists and folders, nested, in order, and renames them', () => {
    const folder = playlists.create('Sabhas', null, true) ?? '';
    const sunday = playlists.create('Ravi Sabha', folder, false) ?? '';
    const loose = playlists.create('Loose', null, false) ?? '';
    expect(playlists.create('Nowhere', sunday, false)).toBeNull(); // a playlist is not a folder
    expect(playlists.tree().map((p) => [p.name, p.isFolder, p.parentId])).toEqual([
      ['Sabhas', true, null],
      ['Ravi Sabha', false, folder],
      ['Loose', false, null],
    ]);
    expect(playlists.rename(sunday, 'Ravi Sabha (Sunday)')).toBe(true);
    expect(playlists.tree()[1]?.name).toBe('Ravi Sabha (Sunday)');
    expect(playlists.tree().map((p) => p.id)).toEqual([folder, sunday, loose]);
  });

  it('adds presentations, media and headers where asked, named after what they are', () => {
    const id = playlists.create('Ravi Sabha', null, false) ?? '';
    playlists.addItems(id, null, [
      { kind: 'presentation', presentationId: hymn },
      { kind: 'media', mediaId: 'loop' },
    ]);
    playlists.addItems(id, 0, [{ kind: 'header', label: 'Opening' }]);
    playlists.addItems(id, 2, [{ kind: 'presentation', presentationId: dhun }]);
    expect(labels(id)).toEqual(['Opening', 'Placeholder Hymn', 'Placeholder Dhun', 'Placeholder loop.mp4']);
    // Something that does not exist: nothing is added.
    expect(
      playlists.addItems(id, null, [
        { kind: 'media', mediaId: 'loop' },
        { kind: 'presentation', presentationId: 'gone' },
      ]),
    ).toEqual([]);
    expect(labels(id)).toHaveLength(4);
    expect(playlists.tree()[0]?.itemCount).toBe(4);
  });

  it('describes each item: order, removed presentations, media that cannot play', () => {
    const id = playlists.create('Ravi Sabha', null, false) ?? '';
    const [a, b, m] = playlists.addItems(id, null, [
      { kind: 'presentation', presentationId: hymn },
      { kind: 'presentation', presentationId: dhun },
      { kind: 'media', mediaId: 'prores' },
    ]);
    const usual = presentations.get(hymn)?.arrangements[0]?.id ?? '';
    expect(playlists.setItemOrder(a ?? '', { mode: 'arrangement', arrangementId: usual })).toBe(true);
    // Another presentation's arrangement is refused.
    expect(playlists.setItemOrder(b ?? '', { mode: 'arrangement', arrangementId: usual })).toBe(false);
    expect(playlists.setItemOrder(b ?? '', { mode: 'all' })).toBe(true);
    presentations.remove([dhun]);
    expect(playlists.itemsOf(id)).toEqual([
      {
        id: a,
        kind: 'presentation',
        label: 'Placeholder Hymn',
        presentationId: hymn,
        presentationName: 'Placeholder Hymn',
        order: { mode: 'arrangement', arrangementId: usual },
        arrangementName: 'Usual',
        timers: [],
        // What its card says (Session 26a).
        slideCount: 2,
        deck: false,
      },
      {
        id: b,
        kind: 'presentation',
        label: 'Placeholder Dhun',
        presentationId: dhun,
        presentationName: null,
        order: { mode: 'all' },
        arrangementName: null,
        timers: [],
        slideCount: 1,
        deck: false,
      },
      {
        id: m,
        kind: 'media',
        label: 'Placeholder old.mov',
        mediaId: 'prores',
        media: 'video',
        missing: false,
        unplayable: 'ProRes 422 video (QuickTime)',
        timers: [],
        durationMs: null,
      },
    ]);
  });

  it('moves items, and removes them so Undo puts them back where they were', () => {
    const id = playlists.create('Ravi Sabha', null, false) ?? '';
    const [h1, p1, p2, m1] = playlists.addItems(id, null, [
      { kind: 'header', label: 'Opening' },
      { kind: 'presentation', presentationId: hymn },
      { kind: 'presentation', presentationId: dhun },
      { kind: 'media', mediaId: 'loop' },
    ]);
    expect(playlists.moveItems(id, [m1 ?? ''], 1)).toBe(true);
    expect(labels(id)).toEqual(['Opening', 'Placeholder loop.mp4', 'Placeholder Hymn', 'Placeholder Dhun']);
    expect(playlists.moveItems(id, [h1 ?? '', p2 ?? ''], 99)).toBe(true);
    expect(labels(id)).toEqual(['Placeholder loop.mp4', 'Placeholder Hymn', 'Opening', 'Placeholder Dhun']);
    expect(playlists.moveItems(id, ['someone else'], 0)).toBe(false);
    expect(playlists.removeItems([p1 ?? '', 'gone'])).toEqual([p1]);
    expect(labels(id)).toEqual(['Placeholder loop.mp4', 'Opening', 'Placeholder Dhun']);
    expect(playlists.playlistOf(p1 ?? '')).toBe(id);
    expect(playlists.restoreItems([p1 ?? ''])).toEqual([p1]);
    expect(labels(id)).toEqual(['Placeholder loop.mp4', 'Placeholder Hymn', 'Opening', 'Placeholder Dhun']);
  });

  it('removes a folder with everything in it, and Undo brings it all back', () => {
    const folder = playlists.create('Sabhas', null, true) ?? '';
    const inner = playlists.create('Festivals', folder, true) ?? '';
    const list = playlists.create('Diwali', inner, false) ?? '';
    const other = playlists.create('Other', null, false) ?? '';
    const removed = playlists.remove([folder]);
    expect(removed.sort()).toEqual([folder, inner, list].sort());
    expect(playlists.tree().map((p) => p.id)).toEqual([other]);
    expect(playlists.restore(removed).sort()).toEqual(removed.sort());
    expect(playlists.tree().map((p) => p.name)).toEqual(['Sabhas', 'Festivals', 'Diwali', 'Other']);
    // Removed long enough ago: gone for good.
    playlists.remove([other]);
    expect(playlists.purgeRemoved(new Date(Date.now() + 1000).toISOString())).toBe(1);
    expect(playlists.restore([other])).toEqual([]);
  });

  it('says what an id is, a deleted one too, and whether a playlist (never a template) lists a file, for Simple Mode’s bounds (Session 56)', () => {
    const folder = playlists.create('Placeholder week', null, true) ?? '';
    const list = playlists.create('Placeholder sabha', folder, false) ?? '';
    const template = playlists.create('Placeholder template', null, false, true) ?? '';
    expect([folder, list, template, 'nowhere'].map((id) => playlists.kindOf(id))).toEqual([
      'folder',
      'playlist',
      'template',
      null,
    ]);
    playlists.addItems(template, null, [
      { kind: 'presentation', presentationId: dhun },
      { kind: 'media', mediaId: 'prores' },
    ]);
    // Only a template has them: no playlist lists them.
    expect(playlists.listsPresentation(dhun)).toBe(false);
    expect(playlists.listsMedia('prores')).toBe(false);
    const [hymnRow] = playlists.addItems(list, null, [
      { kind: 'presentation', presentationId: hymn },
      { kind: 'media', mediaId: 'loop' },
    ]);
    expect(playlists.listsPresentation(hymn)).toBe(true);
    expect(playlists.listsMedia('loop')).toBe(true);
    // A row taken out, or its playlist deleted (a folder with it): no longer listed; the deleted are still named.
    playlists.removeItems([hymnRow ?? '']);
    expect(playlists.listsPresentation(hymn)).toBe(false);
    playlists.remove([folder]);
    expect(playlists.listsMedia('loop')).toBe(false);
    expect([folder, list].map((id) => playlists.kindOf(id))).toEqual(['folder', 'playlist']);
  });

  it('prepares its look-up of what an id is once, so a phone’s Undo of 1,000 playlists in Simple Mode makes one statement, not 1,000 (Session 57)', () => {
    const folder = playlists.create('Placeholder week', null, true) ?? '';
    const list = playlists.create('Placeholder sabha', folder, false) ?? '';
    const template = playlists.create('Placeholder template', null, false, true) ?? '';
    const deleted = playlists.create('Placeholder deleted', null, false) ?? '';
    playlists.remove([deleted]);
    const kinds: Record<string, 'folder' | 'playlist' | 'template'> = {
      [folder]: 'folder',
      [list]: 'playlist',
      [template]: 'template',
      [deleted]: 'playlist',
    };
    // As many ids as a phone's restore may send: each of the four above in turn, then one naming none.
    const named = [folder, list, template, deleted];
    const ids = Array.from({ length: PLAYLIST_IDS_MAX }, (_, i) => named[i % 5] ?? `nowhere-${i}`);
    const expected = ids.map((id) => kinds[id] ?? null);
    // A repo that has looked up no id yet, as Main's is at its first request.
    const repo = new PlaylistRepo(db);
    const prepare = vi.spyOn(db, 'prepare');
    try {
      expect(ids.map((id) => repo.kindOf(id))).toEqual(expected);
      expect(prepare).toHaveBeenCalledTimes(1);
      // The next request's look-ups prepare nothing more.
      expect(ids.map((id) => repo.kindOf(id))).toEqual(expected);
      expect(prepare).toHaveBeenCalledTimes(1);
    } finally {
      prepare.mockRestore();
    }
  });

  it('hands the show engine what each item plays, and why the others are stepped over', () => {
    const id = playlists.create('Ravi Sabha', null, false) ?? '';
    const [header, own, all, arranged, gone, video, old] = playlists.addItems(id, null, [
      { kind: 'header', label: 'Opening' },
      { kind: 'presentation', presentationId: hymn },
      { kind: 'presentation', presentationId: hymn },
      { kind: 'presentation', presentationId: hymn },
      { kind: 'presentation', presentationId: dhun },
      { kind: 'media', mediaId: 'loop' },
      { kind: 'media', mediaId: 'prores' },
    ]);
    const usual = presentations.get(hymn)?.arrangements[0]?.id ?? '';
    playlists.setItemOrder(all ?? '', { mode: 'all' });
    playlists.setItemOrder(arranged ?? '', { mode: 'arrangement', arrangementId: usual });
    presentations.remove([dhun]);
    expect(playlists.playItems(id)).toEqual([
      // Headers and presentations carry their names, for a stage screen's "coming up".
      { id: header, kind: 'skip', why: 'A header has nothing to show', label: 'Opening', header: true },
      {
        id: own,
        kind: 'presentation',
        presentationId: hymn,
        arrangementId: undefined,
        label: 'Placeholder Hymn',
        timers: [],
      },
      {
        id: all,
        kind: 'presentation',
        presentationId: hymn,
        arrangementId: null,
        label: 'Placeholder Hymn',
        timers: [],
      },
      {
        id: arranged,
        kind: 'presentation',
        presentationId: hymn,
        arrangementId: usual,
        label: 'Placeholder Hymn',
        timers: [],
      },
      { id: gone, kind: 'skip', why: '“Placeholder Dhun” is no longer in the library' },
      {
        id: video,
        kind: 'media',
        mediaId: 'loop',
        media: 'video',
        label: 'Placeholder loop.mp4',
        timers: [],
      },
      {
        id: old,
        kind: 'skip',
        why: 'Drashti cannot play “Placeholder old.mov” (ProRes 422 video (QuickTime))',
      },
    ]);
    // A removed playlist plays nothing.
    playlists.remove([id]);
    expect(playlists.playItems(id)).toBeNull();
  });

  it('fills a placeholder with a presentation, and renames headers only', () => {
    const id = playlists.create('Ravi Sabha', null, false) ?? '';
    db.prepare(
      "INSERT INTO playlist_items (id, playlist_id, position, kind, label, hint) VALUES ('ph', ?, 5, 'placeholder', 'Missing Song', 'Not found when the playlist was imported.')",
    ).run(id);
    const [header] = playlists.addItems(id, 0, [{ kind: 'header', label: 'Opening' }]);
    // The playlist list counts what the import could not find.
    expect(playlists.tree()[0]).toMatchObject({ itemCount: 2, placeholders: 1 });
    expect(playlists.fillPlaceholder('ph', 'gone')).toBe(false);
    expect(playlists.fillPlaceholder('ph', hymn)).toBe(true);
    expect(playlists.tree()[0]).toMatchObject({ itemCount: 2, placeholders: 0 });
    expect(playlists.itemsOf(id)[1]).toMatchObject({
      kind: 'presentation',
      label: 'Placeholder Hymn',
      presentationId: hymn,
    });
    // Only a placeholder can be filled.
    expect(playlists.fillPlaceholder('ph', dhun)).toBe(false);
    expect(playlists.renameHeader(header ?? '', 'Welcome')).toBe(true);
    expect(playlists.renameHeader('ph', 'Not a header')).toBe(false);
    expect(labels(id)).toEqual(['Welcome', 'Placeholder Hymn']);
  });
});

describe('sabha templates', () => {
  /** A week's playlist: a header, the dhun (a kirtan), the hymn, a picture and a placeholder from an import. */
  function week(): string {
    const rows = presentations.content(dhun);
    if (!rows) throw new Error('missing');
    presentations.setContent({
      ...rows,
      kirtan: { row: { category: 'Dhun', kavi: null, raag: null, occasions: '[]', audio_media_id: null } },
    });
    const id = playlists.create('This Sunday', null, false) ?? '';
    playlists.addItems(id, null, [
      { kind: 'header', label: 'Opening' },
      { kind: 'presentation', presentationId: dhun },
      { kind: 'presentation', presentationId: hymn },
      { kind: 'media', mediaId: 'loop' },
    ]);
    return id;
  }

  it('saves a playlist as a template, apart from the playlists: kept items, and slots named by category', () => {
    const id = week();
    const [, dhunItem] = playlists.itemsOf(id);
    const template = playlists.saveAsTemplate(id, 'Sunday template', [dhunItem?.id ?? '']) ?? '';
    // Kept apart: not in the playlists' tree, and listed as a template.
    expect(playlists.tree().map((p) => p.name)).toEqual(['This Sunday']);
    expect(playlists.tree(true).map((p) => [p.name, p.template, p.itemCount])).toEqual([
      ['Sunday template', true, 4],
    ]);
    expect(playlists.itemsOf(template)).toEqual([
      expect.objectContaining({ kind: 'header', label: 'Opening' }),
      expect.objectContaining({ kind: 'placeholder', label: 'Dhun', hint: null, category: 'Dhun' }),
      expect.objectContaining({ kind: 'presentation', presentationId: hymn }),
      expect.objectContaining({ kind: 'media', mediaId: 'loop' }),
    ]);
    // The week's playlist is unchanged.
    expect(labels(id)).toEqual(['Opening', 'Placeholder Dhun', 'Placeholder Hymn', 'Placeholder loop.mp4']);
  });

  it('is never run, and makes playlists with its slots ready to fill', () => {
    const template = playlists.saveAsTemplate(week(), 'Sunday template', []) ?? '';
    playlists.addSlot(template, 1, 'Kirtan', 'Kirtan');
    expect(playlists.playItems(template)).toBeNull();
    const folder = playlists.create('Sabhas', null, true) ?? '';
    const next = playlists.newFromTemplate(template, 'Next Sunday', folder) ?? '';
    expect(playlists.tree().map((p) => [p.name, p.parentId])).toEqual([
      ['This Sunday', null],
      ['Sabhas', null],
      ['Next Sunday', folder],
    ]);
    const items = playlists.itemsOf(next);
    expect(items.map((i) => [i.kind, i.label])).toEqual([
      ['header', 'Opening'],
      ['placeholder', 'Kirtan'],
      ['presentation', 'Placeholder Dhun'],
      ['presentation', 'Placeholder Hymn'],
      ['media', 'Placeholder loop.mp4'],
    ]);
    // An empty slot is stepped over in the show, and filling it makes it the presentation.
    const slot = items[1];
    expect(playlists.playItems(next)?.[1]).toMatchObject({
      kind: 'skip',
      why: '“Kirtan” is not filled in yet',
    });
    expect(playlists.fillPlaceholder(slot?.id ?? '', hymn)).toBe(true);
    expect(playlists.itemsOf(next)[1]).toMatchObject({ kind: 'presentation', presentationId: hymn });
    // The template keeps its slot.
    expect(playlists.itemsOf(template)[1]).toMatchObject({ kind: 'placeholder', label: 'Kirtan' });
    expect(playlists.newFromTemplate(next, 'Not from a playlist', null)).toBeNull();
  });

  it('counts only what an import could not find as missing in the playlist list, never a slot waiting to be filled (Session 55)', () => {
    const template = playlists.saveAsTemplate(week(), 'Sunday template', []) ?? '';
    playlists.addSlot(template, 1, 'Kirtan', 'Kirtan');
    const next = playlists.newFromTemplate(template, 'Next Sunday', null) ?? '';
    // Its slot and the template's own wait to be filled: nothing is missing.
    expect(playlists.tree().find((p) => p.id === next)).toMatchObject({ itemCount: 5, placeholders: 0 });
    expect(playlists.tree(true).find((p) => p.id === template)).toMatchObject({ placeholders: 0 });
    // An item an import could not find is.
    db.prepare(
      "INSERT INTO playlist_items (id, playlist_id, position, kind, label, hint) VALUES ('lost', ?, 9, 'placeholder', 'Missing Song', 'Not found when the playlist was imported.')",
    ).run(next);
    expect(playlists.tree().find((p) => p.id === next)).toMatchObject({ itemCount: 6, placeholders: 1 });
  });

  it('keeps an item’s timer cues in its template and the playlists made from it; a slot is renamed and re-categorised', () => {
    const id = week();
    const [, , hymnItem, loopItem] = playlists.itemsOf(id);
    expect(playlists.setTimers(hymnItem?.id ?? '', [{ timerId: 'pravachan', action: 'start' }])).toBe(true);
    expect(playlists.setTimers(loopItem?.id ?? '', [{ timerId: 'clock', action: 'show' }])).toBe(true);
    // Headers have nothing to go up: no cues.
    expect(playlists.setTimers(playlists.itemsOf(id)[0]?.id ?? '', [{ timerId: 'x', action: 'start' }])).toBe(
      false,
    );
    expect(playlists.playItems(id)?.[2]).toMatchObject({
      timers: [{ timerId: 'pravachan', action: 'start' }],
    });
    const template = playlists.saveAsTemplate(id, 'Sunday template', []) ?? '';
    const slot = playlists.addSlot(template, null, 'Kirtan', 'Kirtan') ?? '';
    const next = playlists.newFromTemplate(template, 'Next Sunday', null) ?? '';
    const cuesOf = (playlistId: string) =>
      playlists
        .itemsOf(playlistId)
        .map((i) => ('timers' in i ? i.timers.map((c) => `${c.action}:${c.timerId}`) : []));
    expect(cuesOf(template)).toEqual([[], [], ['start:pravachan'], ['show:clock'], []]);
    expect(cuesOf(next)).toEqual([[], [], ['start:pravachan'], ['show:clock'], []]);
    // None takes them away.
    expect(playlists.setTimers(playlists.itemsOf(next)[2]?.id ?? '', [])).toBe(true);
    expect(cuesOf(next)[2]).toEqual([]);
    // A slot: a new name and category (a passage from a book, then none).
    expect(playlists.editSlot(slot, 'Pravachan reading', 'Shastra')).toBe(true);
    expect(playlists.itemsOf(template).at(-1)).toMatchObject({
      kind: 'placeholder',
      label: 'Pravachan reading',
      category: 'Shastra',
    });
    expect(playlists.editSlot(slot, 'Pravachan reading', null)).toBe(true);
    expect(playlists.itemsOf(template).at(-1)).toMatchObject({ category: null });
    // Only a slot: not a presentation item, not a placeholder an import left.
    expect(playlists.editSlot(hymnItem?.id ?? '', 'Renamed', null)).toBe(false);
  });

  // alpha.15 (the owner's words, 3 Nov 2026): Books is the name a person reads; a slot asking for a passage is stored
  // as libraries always stored it, so one saved before alpha.15 loads unchanged.
  it('reads a slot asking for a passage as a library saved it before alpha.15 ("Shastra"), and shows it as Books', () => {
    const template = playlists.saveAsTemplate(week(), 'Sunday template', []) ?? '';
    // As an older library has it: written straight into its table, as alpha.14 wrote it.
    db.prepare(
      "INSERT INTO playlist_items (id, playlist_id, position, kind, label, category) VALUES ('reading', ?, 9, 'placeholder', 'Placeholder reading', 'Shastra')",
    ).run(template);
    const slot = playlists.itemsOf(template).find((i) => i.id === 'reading');
    expect(slot).toMatchObject({
      kind: 'placeholder',
      label: 'Placeholder reading',
      hint: null,
      category: 'Shastra',
    });
    // Still the value a slot asking for a passage is known by (filling it opens Books), and read as Books.
    expect(SHASTRA_SLOT).toBe('Shastra');
    const category = slot?.kind === 'placeholder' ? slot.category : null;
    expect(category).toBe(SHASTRA_SLOT);
    expect(slotCategoryName(category ?? '')).toBe('Books');
    // A playlist made from it asks for a passage too; a kirtan's category reads as it is.
    const next = playlists.newFromTemplate(template, 'Next Sunday', null) ?? '';
    expect(playlists.itemsOf(next).at(-1)).toMatchObject({ kind: 'placeholder', category: SHASTRA_SLOT });
    expect(slotCategoryName('Dhun')).toBe('Dhun');
    // A passage whose book is not loaded here: the show goes past it, saying why in the new words.
    db.prepare(
      "INSERT INTO playlist_items (id, playlist_id, position, kind, label, passage) VALUES ('passage', ?, 10, 'shastra', 'Placeholder Granth 14', ?)",
    ).run(next, JSON.stringify({ text: 'pg', sections: [], from: 14, to: 14 }));
    expect(playlists.itemsOf(next).at(-1)).toMatchObject({ kind: 'shastra', missing: true });
    expect(playlists.playItems(next)?.at(-1)).toMatchObject({
      kind: 'skip',
      why: '“Placeholder Granth 14”: its book is not loaded',
    });
  });

  it('starts every library with the example templates, once', () => {
    expect(seedTemplates(db)).toBe(true);
    expect(seedTemplates(db)).toBe(false);
    const made = playlists.tree(true);
    expect(made.map((t) => t.name)).toEqual(EXAMPLE_TEMPLATES.map((t) => t.name));
    const ravi = playlists.itemsOf(made[0]?.id ?? '');
    expect(ravi.flatMap((i) => (i.kind === 'placeholder' ? [i.category] : []))).toContain('Arti');
    expect(playlists.tree()).toEqual([]);
  });
});
