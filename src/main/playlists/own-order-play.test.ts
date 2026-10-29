import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { PlaylistRepo } from '../db/playlists';
import { DbSlideSource, PresentationRepo } from '../db/presentations';
import { ShowEngine } from '../engine/show-engine';
import { RecordingTransport } from '../engine/testing';
import { repeatPresentationId } from '../../shared/repeat';
import { RepeatSlides } from './repeat-slides';

/*
 * Session 55, Part 4b: a playlist item's own order of slides, played by the show engine from the library (the slide
 * source reads the order the item keeps, as "item:<id>"). Next and Back follow it; a slide's row dragged while its
 * slide is on the screens leaves the screens as they are, and the live place follows the slide: within its deck, to its
 * new place; out of it, into its own item, so Next goes on from there. Placeholder names only.
 */

function show() {
  const db = openDatabase(':memory:');
  const presentations = new PresentationRepo(db);
  const playlists = new PlaylistRepo(db);
  const source = new DbSlideSource(presentations, (itemId) => playlists.ownOrder(itemId));
  const libraryId = presentations.ensureLibrary('Placeholder library');
  const deck = presentations.insert({
    libraryId,
    name: 'Placeholder deck',
    groups: [
      {
        name: '',
        slides: [1, 2, 3, 4].map((n) => ({ elements: [], notes: `Placeholder note ${String(n)}` })),
      },
    ],
  });
  const other = presentations.insert({
    libraryId,
    name: 'Placeholder other',
    groups: [{ name: '', slides: [{ elements: [] }] }],
  });
  const ids = (presentations.get(deck)?.groups[0]?.slides ?? []).map((s) => s.id);
  const otherSlide = presentations.get(other)?.groups[0]?.slides[0]?.id ?? '';
  const list = playlists.create('Placeholder Sunday', null, false) ?? '';
  const [item = '', next = ''] = playlists.addItems(list, null, [
    { kind: 'presentation', presentationId: deck },
    { kind: 'presentation', presentationId: other },
  ]);
  let clock = 1000;
  const engine = new ShowEngine(source, new RecordingTransport(), () => (clock += 10), {
    items: (id) => playlists.playItems(id),
  });
  const shown = () => engine.current.layers.slide?.slide.id ?? null;
  const name = (id: string | null) =>
    id === otherSlide ? 'other' : id === null ? '-' : `s${String(ids.indexOf(id) + 1)}`;
  return { db, presentations, playlists, source, engine, deck, ids, list, item, next, shown, name };
}

describe('an item’s own order of slides, on the screens', () => {
  it('is what the engine plays: Next and Back follow it, then on into the next item', () => {
    const { playlists, engine, ids, list, item, next, shown, name } = show();
    const [s1 = '', s2 = '', s3 = '', s4 = ''] = ids;
    playlists.setItemOrder(item, { mode: 'slides', slideIds: [s3, s1, s2, s4], known: ids });
    engine.dispatch({ type: 'playItem', playlistId: list, itemId: item });
    expect(engine.current.live).toMatchObject({
      slideIndex: 0,
      slideCount: 4,
      arrangementId: `item:${item}`,
    });
    const seen = [name(shown())];
    for (let i = 0; i < 4; i++) {
      engine.dispatch({ type: 'next' });
      seen.push(name(shown()));
    }
    expect(seen).toEqual(['s3', 's1', 's2', 's4', 'other']);
    expect(engine.current.live.playlist).toEqual({ playlistId: list, itemId: next });
    engine.dispatch({ type: 'previous' });
    expect([name(shown()), engine.current.live.playlist?.itemId]).toEqual(['s4', item]);
    // A click on a row (goLive with the order its rows show) plays from there in the same order.
    engine.dispatch({
      type: 'goLive',
      presentationId: engine.current.live.presentationId ?? '',
      slideIndex: 1,
      arrangementId: `item:${item}`,
      playlist: { playlistId: list, itemId: item },
    });
    engine.dispatch({ type: 'next' });
    expect(name(shown())).toBe('s2');
  });

  it('keeps the slide on the screens when its row is dragged within the deck: Next goes on from its new place', () => {
    const { playlists, engine, ids, list, item, shown, name } = show();
    const [s1 = '', s2 = '', s3 = '', s4 = ''] = ids;
    engine.dispatch({ type: 'playItem', playlistId: list, itemId: item });
    engine.dispatch({ type: 'next' });
    expect(name(shown())).toBe('s2');
    const shownAt = engine.current.layers.slide?.shownAt;
    // s2 dragged to the end: s1, s3, s4, s2.
    playlists.setItemOrder(item, { mode: 'slides', slideIds: [s1, s3, s4, s2], known: ids });
    engine.reorderLive();
    expect(engine.current.live).toMatchObject({
      slideIndex: 3,
      slideCount: 4,
      arrangementId: `item:${item}`,
    });
    expect(engine.current.layers.slide?.shownAt).toBe(shownAt);
    expect(name(shown())).toBe('s2');
    // s2 at the end of its item: Next goes on into the next item.
    engine.dispatch({ type: 'next' });
    expect(name(shown())).toBe('other');
    engine.dispatch({ type: 'previous' });
    engine.dispatch({ type: 'previous' });
    expect(name(shown())).toBe('s4');
  });

  it('follows the slide on the screens dragged out of its deck into its own item: Next goes on after that item', () => {
    const { playlists, engine, ids, list, item, next, shown, name } = show();
    const [s1 = '', s2 = '', s3 = '', s4 = ''] = ids;
    engine.dispatch({ type: 'playItem', playlistId: list, itemId: item });
    engine.dispatch({ type: 'next' });
    const shownAt = engine.current.layers.slide?.shownAt;
    // s2 dragged out, after the other presentation: the deck keeps s1, s3, s4.
    const alone =
      playlists.splitItem(
        item,
        { mode: 'slides', slideIds: [s1, s3, s4], known: ids },
        { mode: 'slides', slideIds: [s2] },
        2,
      ) ?? '';
    engine.reorderLive();
    expect(engine.current.live).toMatchObject({
      slideIndex: 0,
      slideCount: 1,
      arrangementId: `item:${alone}`,
      playlist: { playlistId: list, itemId: alone },
    });
    expect([name(shown()), engine.current.layers.slide?.shownAt]).toEqual(['s2', shownAt]);
    // Nothing after it: Next stays; Back goes to the item before it (the other presentation), then the deck's end.
    expect(engine.dispatch({ type: 'next' })).toMatchObject({ changed: false });
    engine.dispatch({ type: 'previous' });
    expect([name(shown()), engine.current.live.playlist?.itemId]).toEqual(['other', next]);
    engine.dispatch({ type: 'previous' });
    expect([name(shown()), engine.current.live.playlist?.itemId]).toEqual(['s4', item]);
  });

  it('plays the presentation’s own order for an item whose own order has gone (set back, or the item removed)', () => {
    const { playlists, source, deck, ids, item } = show();
    const [s1 = '', s2 = '', s3 = '', s4 = ''] = ids;
    playlists.setItemOrder(item, { mode: 'slides', slideIds: [s2, s1, s4, s3], known: ids });
    expect(source.order(deck, `item:${item}`)?.slides.map((s) => s.id)).toEqual([s2, s1, s4, s3]);
    playlists.setItemOrder(item, { mode: 'presentation' });
    expect(source.order(deck, `item:${item}`)).toMatchObject({ arrangementId: null });
    expect(source.order(deck, `item:${item}`)?.slides.map((s) => s.id)).toEqual(ids);
    // An item of another presentation's never gives this one its order.
    expect(source.order(deck, 'item:missing')?.slides.map((s) => s.id)).toEqual(ids);
  });

  it('goes round a Repeat Slides playlist in an item’s own order too', () => {
    const { playlists, source, deck, ids } = show();
    const [, s2 = '', , s4 = ''] = ids;
    const repeat = playlists.createRepeat('Placeholder going round', null) ?? '';
    const [item = ''] = playlists.addItems(repeat, null, [{ kind: 'presentation', presentationId: deck }]);
    playlists.setItemOrder(item, { mode: 'slides', slideIds: [s4, s2] });
    const round = new RepeatSlides({
      playlist: (id) => playlists.repeatPlaylist(id),
      items: (id) => playlists.playItems(id),
      slides: source,
    });
    expect(round.order(repeatPresentationId(repeat))?.slides.map((s) => s.notes)).toEqual([
      'Placeholder note 4',
      'Placeholder note 2',
    ]);
  });

  it('never changes the library: the presentation plays from the library in its own order', () => {
    const { playlists, presentations, engine, deck, ids, item, shown, name } = show();
    playlists.setItemOrder(item, { mode: 'slides', slideIds: [...ids].reverse(), known: ids });
    engine.dispatch({ type: 'goLive', presentationId: deck, slideIndex: 0 });
    expect(name(shown())).toBe('s1');
    expect(presentations.get(deck)?.groups[0]?.slides.map((s) => s.id)).toEqual(ids);
  });
});
