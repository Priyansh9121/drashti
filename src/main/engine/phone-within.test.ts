import { describe, expect, it } from 'vitest';
import type { DeckSlide } from '../../shared/deck';
import type { RenderSlide } from '../../shared/model';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import { MemorySlideSource } from './slide-source';
import { RecordingTransport, textSlide } from './testing';

/*
 * A phone's Next, Previous and Back (alpha.23, QA23-PHONE-1: the owner's "Only PPT and PDF"): with `within`, the
 * presentation live, they stay inside it, its clicks and its slides only: never what was cued, the playlist's next or
 * previous item, or what was up before the last Next; at either end, and once another presentation is live, nothing
 * changes. Without it, every Next, Previous and Back is as it was. Placeholder names and made-up ids only.
 */

/** A deck's slide of `steps` clicks, each clip a second long (as deck-steps.test.ts makes them). */
function deckSlide(id: string, steps: number): RenderSlide {
  const deck: DeckSlide = {
    transition: { name: 'push', durationMs: 400 },
    steps: Array.from({ length: steps }, (_, i) => ({
      clipId: `${id}-clip${String(i)}`,
      clipMs: 1000,
      lastId: `${id}-last${String(i)}`,
      ...(i === 0 ? { transitionMs: 400 } : {}),
    })),
    media: [],
  };
  return {
    id,
    width: 1920,
    height: 1080,
    background: null,
    elements: [
      {
        id: `${id}-picture`,
        kind: 'image',
        frame: { x: 0, y: 0, width: 1920, height: 1080 },
        mediaId: `${id}-last${String(steps - 1)}`,
        fit: 'fit',
      },
    ],
    deck,
  };
}

/**
 * A playlist: a song before the deck, the deck (a slide of two clicks, then a picture page), and a song after; and
 * another presentation that can be cued.
 */
function setup() {
  const source = new MemorySlideSource();
  source.set('before', [
    textSlide('b1', 'Placeholder before one'),
    textSlide('b2', 'Placeholder before two'),
  ]);
  source.set('deck', [deckSlide('d1', 2), textSlide('d2', 'Placeholder page two')]);
  source.set('after', [textSlide('a1', 'Placeholder after')]);
  source.set('arti', [textSlide('c1', 'Placeholder cued')]);
  const playlists = new MemoryPlaylistSource();
  playlists.set('sabha', [
    { id: 'i-before', kind: 'presentation', presentationId: 'before', arrangementId: undefined },
    { id: 'i-deck', kind: 'presentation', presentationId: 'deck', arrangementId: undefined },
    { id: 'i-after', kind: 'presentation', presentationId: 'after', arrangementId: undefined },
  ]);
  let clock = 50_000;
  const engine = new ShowEngine(source, new RecordingTransport(), () => (clock += 10), playlists, {
    schedule: () => () => undefined,
  });
  return { engine };
}

const at = (e: ShowEngine) => ({
  presentationId: e.current.live.presentationId,
  slideIndex: e.current.live.slideIndex,
  item: e.current.live.playlist?.itemId ?? null,
  slide: e.current.layers.slide?.slide.id ?? null,
  step: e.current.layers.slide?.step ?? null,
});

describe('a phone’s Next, Previous and Back inside its deck (QA23-PHONE-1)', () => {
  it('Next goes through the deck’s clicks and slides, then stops at its end: never into the next item', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'playItem', playlistId: 'sabha', itemId: 'i-deck' });
    expect(at(engine)).toMatchObject({ presentationId: 'deck', slideIndex: 0, step: 0 });
    expect(engine.dispatch({ type: 'next', within: 'deck' })).toMatchObject({ ok: true, changed: true });
    expect(at(engine)).toMatchObject({ slideIndex: 0, slide: 'd1', step: 1 });
    engine.dispatch({ type: 'next', within: 'deck' });
    expect(at(engine)).toMatchObject({ slideIndex: 1, slide: 'd2', item: 'i-deck' });
    const before = engine.current;
    expect(engine.dispatch({ type: 'next', within: 'deck' })).toMatchObject({ ok: true, changed: false });
    expect(engine.current).toBe(before);
    expect(at(engine)).toMatchObject({ presentationId: 'deck', slideIndex: 1, item: 'i-deck' });
  });

  it('Previous and Back step back inside it, then stop at its start: never into the item before', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'playItem', playlistId: 'sabha', itemId: 'i-deck' });
    engine.dispatch({ type: 'next', within: 'deck' });
    engine.dispatch({ type: 'next', within: 'deck' });
    expect(at(engine)).toMatchObject({ slideIndex: 1 });
    engine.dispatch({ type: 'previous', within: 'deck' });
    // Back in at the slide's last click.
    expect(at(engine)).toMatchObject({ slideIndex: 0, slide: 'd1', step: 1 });
    engine.dispatch({ type: 'back', within: 'deck' });
    expect(at(engine)).toMatchObject({ slideIndex: 0, slide: 'd1', step: 0 });
    for (const type of ['previous', 'back'] as const) {
      const before = engine.current;
      expect(engine.dispatch({ type, within: 'deck' }), type).toMatchObject({ ok: true, changed: false });
      expect(engine.current).toBe(before);
    }
    expect(at(engine)).toMatchObject({ presentationId: 'deck', item: 'i-deck' });
  });

  it('Back with it is one step back, never what was up before the last Next', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'playItem', playlistId: 'sabha', itemId: 'i-deck' });
    engine.dispatch({ type: 'next', within: 'deck' });
    const shownAt = engine.current.layers.slide?.shownAt;
    // The operator's Next onto the page: Back without `within` would put back exactly what was up before it.
    engine.dispatch({ type: 'next' });
    expect(at(engine)).toMatchObject({ slideIndex: 1 });
    engine.dispatch({ type: 'back', within: 'deck' });
    expect(at(engine)).toMatchObject({ slideIndex: 0, slide: 'd1', step: 1 });
    // Shown again, from the step before: not the layer that was up before the Next.
    expect(engine.current.layers.slide?.shownAt).not.toBe(shownAt);
  });

  it('never plays what was cued, and does nothing once another presentation, or none, is live', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'playItem', playlistId: 'sabha', itemId: 'i-deck' });
    engine.dispatch({ type: 'cueNext', presentationId: 'arti', label: 'Placeholder arti' });
    engine.dispatch({ type: 'next', within: 'deck' });
    expect(at(engine)).toMatchObject({ presentationId: 'deck', step: 1 });
    expect(engine.current.cue?.presentationId).toBe('arti');
    // The operator moved on to another presentation: the phone's Next for the deck does nothing.
    engine.dispatch({ type: 'playItem', playlistId: 'sabha', itemId: 'i-after' });
    const before = engine.current;
    for (const type of ['next', 'previous', 'back'] as const)
      expect(engine.dispatch({ type, within: 'deck' }), type).toMatchObject({ ok: true, changed: false });
    expect(engine.current).toBe(before);
    engine.dispatch({ type: 'clearAll' });
    const { engine: idle } = setup();
    expect(idle.dispatch({ type: 'next', within: 'deck' })).toMatchObject({ ok: true, changed: false });
  });

  it('without it, Next, Previous and Back are as they were: the cue, the next item, the exact Back', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'playItem', playlistId: 'sabha', itemId: 'i-deck' });
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'next' });
    expect(at(engine)).toMatchObject({ slideIndex: 1, item: 'i-deck' });
    // At the deck's end, Next goes on to the next item.
    engine.dispatch({ type: 'next' });
    expect(at(engine)).toMatchObject({ presentationId: 'after', slideIndex: 0, item: 'i-after' });
    // Back undoes that Next exactly: the very layer that was up before it.
    engine.dispatch({ type: 'previous' });
    expect(at(engine)).toMatchObject({ presentationId: 'deck', slideIndex: 1, item: 'i-deck' });
    const page = engine.current.layers.slide?.shownAt;
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'back' });
    expect(at(engine)).toMatchObject({ presentationId: 'deck', slideIndex: 1, item: 'i-deck' });
    expect(engine.current.layers.slide?.shownAt).toBe(page);
    // Previous at the deck's start goes back to the item before, at its last slide.
    engine.dispatch({ type: 'playItem', playlistId: 'sabha', itemId: 'i-deck' });
    engine.dispatch({ type: 'previous' });
    expect(at(engine)).toMatchObject({ presentationId: 'before', slideIndex: 1, item: 'i-before' });
    // Next plays what was cued.
    engine.dispatch({ type: 'cueNext', presentationId: 'arti', label: 'Placeholder arti' });
    engine.dispatch({ type: 'next' });
    expect(at(engine)).toMatchObject({ presentationId: 'arti', slideIndex: 0 });
  });
});
