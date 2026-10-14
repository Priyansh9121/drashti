import { describe, expect, it } from 'vitest';
import type { Transition } from '../../shared/model';
import type { RepeatSettings } from '../../shared/repeat';
import { DEFAULT_REPEAT, isRepeatId, repeatPresentationId } from '../../shared/repeat';
import { RepeatSlides } from '../playlists/repeat-slides';
import { savedFrom } from '../recovery/live-state';
import type { PlayItem } from './playlist-source';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import type { SlideSource } from './slide-source';
import { MemorySlideSource } from './slide-source';
import { RecordingTransport, textSlide } from './testing';

/*
 * Repeat Slides in the engine (Session 26d): a playlist's pictures and
 * slides going round by themselves, each for its seconds, the last back to
 * the first, timed by the engine's clock (injected here). Stop and Esc leave
 * the slide up; anything else going up, Clear all or the slide cleared stop
 * it; black-out and the logo cover it as it goes on; a settings change takes
 * effect from the next slide; recovery carries it on.
 */

const LIST = 'lobby';
const ID = repeatPresentationId(LIST);

function setup(options: { items?: PlayItem[]; clock?: { now: number } } = {}) {
  const source = new MemorySlideSource();
  source.set('deck', [textSlide('d1', 'Page one'), textSlide('d2', 'Page two')], [], {
    // A deck's own transition and times are left out when it goes round.
    transitions: [{ kind: 'slide', durationMs: 500 }, null],
    autoAdvance: [2000, null],
  });
  source.set('words', [textSlide('w1', 'Placeholder words')]);
  source.set('other', [textSlide('o1', 'Another presentation')]);
  const settings: { now: RepeatSettings | null } = { now: DEFAULT_REPEAT };
  const items: PlayItem[] = options.items ?? [
    { id: 'pic', kind: 'media', mediaId: 'm1', media: 'image', label: 'Darshan.png' },
    { id: 'head', kind: 'skip', why: 'A header has nothing to show', label: 'Morning', header: true },
    { id: 'deckItem', kind: 'presentation', presentationId: 'deck', arrangementId: undefined, label: 'Deck' },
    { id: 'clip', kind: 'media', mediaId: 'v1', media: 'video', label: 'Clip.mp4' },
    {
      id: 'wordsItem',
      kind: 'presentation',
      presentationId: 'words',
      arrangementId: undefined,
      label: 'Words',
    },
  ];
  const repeat = new RepeatSlides({
    playlist: (id) =>
      id === LIST && settings.now ? { name: 'Lobby pictures', settings: settings.now } : null,
    items: (id) => (id === LIST && settings.now ? items : null),
    slides: source,
  });
  const playable: SlideSource = {
    order: (id, arrangementId) => (isRepeatId(id) ? repeat.order(id) : source.order(id, arrangementId)),
  };
  const playlists = new MemoryPlaylistSource();
  playlists.set('week', [{ id: 'i1', kind: 'presentation', presentationId: 'other', arrangementId: null }]);
  const clock = options.clock ?? { now: 100_000 };
  const waiting: { at: number; run: () => void; cancelled: boolean }[] = [];
  const engine = new ShowEngine(playable, new RecordingTransport(), () => clock.now, playlists, {
    schedule: (delay, run) => {
      const job = { at: clock.now + delay, run, cancelled: false };
      waiting.push(job);
      return () => {
        job.cancelled = true;
      };
    },
    repeatName: (id) => (id === LIST && settings.now ? 'Lobby pictures' : null),
  });
  /** Let time pass, running what comes due on the way, in order. */
  const elapse = (ms: number) => {
    const until = clock.now + ms;
    for (;;) {
      const due = waiting.filter((j) => !j.cancelled && j.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      waiting.splice(waiting.indexOf(due), 1);
      clock.now = due.at;
      due.run();
    }
    clock.now = until;
  };
  const step = () => engine.current.layers.slide?.slide.id ?? null;
  return { engine, elapse, step, clock, settings, repeat };
}

describe('Repeat Slides', () => {
  it('goes round its pictures and slides, each for its seconds by its transition, the last back to the first', () => {
    const { engine, elapse, step, clock } = setup();
    expect(engine.dispatch({ type: 'startRepeat', playlistId: LIST })).toMatchObject({ ok: true });
    expect(engine.current.repeat).toEqual({ playlistId: LIST, name: 'Lobby pictures' });
    // The picture first, as a slide of its own; the header and the video are stepped over.
    expect(step()).toBe('pic/picture');
    expect(engine.current.layers.slide).toMatchObject({ presentationId: ID, slideIndex: 0 });
    expect(engine.current.autoAdvance).toEqual({ startedAt: clock.now, durationMs: 15_000 });
    elapse(14_999);
    expect(step()).toBe('pic/picture');
    elapse(1);
    // The deck's pages, by the playlist's fade (not the deck's own slide), each for 15 s.
    expect(step()).toBe('deckItem/0');
    expect(engine.current.layers.slide?.transition).toEqual({ kind: 'dissolve', durationMs: 1000 });
    expect(engine.current.autoAdvance).toEqual({ startedAt: clock.now, durationMs: 15_000 });
    elapse(15_000);
    expect(step()).toBe('deckItem/1');
    elapse(15_000);
    expect(step()).toBe('wordsItem/0');
    // After the last, the first again; and on.
    elapse(15_000);
    expect(step()).toBe('pic/picture');
    expect(engine.current.repeat).not.toBeNull();
    elapse(15_000);
    expect(step()).toBe('deckItem/0');
  });

  it('starts from a slide of its own put up, and Next shows the next step, the first after the last', () => {
    const { engine, step } = setup();
    engine.dispatch({ type: 'goLive', presentationId: ID, slideIndex: 3 });
    expect(step()).toBe('wordsItem/0');
    expect(engine.current.repeat).toEqual({ playlistId: LIST, name: 'Lobby pictures' });
    expect(engine.current.next).toMatchObject({ kind: 'slide', presentationId: ID, slideIndex: 0 });
    // By hand too it goes round, both ways.
    engine.dispatch({ type: 'next' });
    expect(step()).toBe('pic/picture');
    engine.dispatch({ type: 'previous' });
    expect(step()).toBe('wordsItem/0');
    expect(engine.current.repeat).not.toBeNull();
  });

  it('Stop leaves the slide on the screens, and nothing moves on after', () => {
    const { engine, elapse, step } = setup();
    engine.dispatch({ type: 'startRepeat', playlistId: LIST });
    elapse(15_000);
    const up = engine.current.layers.slide;
    expect(engine.dispatch({ type: 'stopRepeat' })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.repeat).toBeNull();
    expect(engine.current.autoAdvance).toBeNull();
    expect(engine.current.layers.slide).toBe(up);
    elapse(60_000);
    expect(step()).toBe('deckItem/0');
    expect(engine.dispatch({ type: 'stopRepeat' })).toMatchObject({ ok: false, error: 'not-repeating' });
    // Next by hand still steps through it, without setting it going.
    engine.dispatch({ type: 'next' });
    expect(step()).toBe('deckItem/1');
    expect(engine.current.repeat).toBeNull();
    expect(engine.current.autoAdvance).toBeNull();
  });

  it('stops when anything else goes up, at Clear all (Put it back sets it going again) and when the slide is cleared', () => {
    const { engine, elapse, step } = setup();
    engine.dispatch({ type: 'startRepeat', playlistId: LIST });
    engine.dispatch({ type: 'playItem', playlistId: 'week', itemId: 'i1' });
    expect(step()).toBe('o1');
    expect(engine.current.repeat).toBeNull();

    engine.dispatch({ type: 'startRepeat', playlistId: LIST });
    elapse(15_000);
    engine.dispatch({ type: 'clearAll' });
    expect(engine.current.repeat).toBeNull();
    expect(engine.current.layers.slide).toBeNull();
    elapse(30_000);
    engine.dispatch({ type: 'putBack' });
    expect(step()).toBe('deckItem/0');
    expect(engine.current.repeat).toEqual({ playlistId: LIST, name: 'Lobby pictures' });
    elapse(15_000);
    expect(step()).toBe('deckItem/1');

    engine.dispatch({ type: 'clearLayer', layer: 'slide' });
    expect(engine.current.repeat).toBeNull();
    expect(engine.current.autoAdvance).toBeNull();
  });

  it('black-out and the logo cover it while it goes on underneath', () => {
    const { engine, elapse, step } = setup();
    engine.dispatch({ type: 'startRepeat', playlistId: LIST });
    engine.dispatch({ type: 'setBlackout', on: true });
    elapse(15_000);
    expect(step()).toBe('deckItem/0');
    expect(engine.current.blackout).toBe(true);
    engine.dispatch({ type: 'showLogo', prop: { id: 'logo', name: 'Logo', elements: [] } });
    elapse(15_000);
    expect(step()).toBe('deckItem/1');
    expect(engine.current.repeat).not.toBeNull();
  });

  it('a change to its settings takes effect from the next slide', () => {
    const { engine, elapse, step, settings, clock } = setup();
    engine.dispatch({ type: 'startRepeat', playlistId: LIST });
    const counting = engine.current.autoAdvance;
    const slide: Transition = { kind: 'slide', durationMs: 600 };
    settings.now = { secondsEach: 5, transition: slide };
    // Something changing the show meanwhile (black-out on and off) keeps this slide's count.
    engine.dispatch({ type: 'toggleBlackout' });
    engine.dispatch({ type: 'toggleBlackout' });
    expect(engine.current.autoAdvance).toEqual(counting);
    elapse(15_000);
    expect(step()).toBe('deckItem/0');
    expect(engine.current.layers.slide?.transition).toEqual(slide);
    expect(engine.current.autoAdvance).toEqual({ startedAt: clock.now, durationMs: 5000 });
    elapse(5000);
    expect(step()).toBe('deckItem/1');
  });

  it('a slow zoom zooms until the next slide has come on', () => {
    const { engine, settings } = setup();
    settings.now = { secondsEach: 15, transition: { kind: 'zoom', durationMs: 1000 } };
    engine.dispatch({ type: 'startRepeat', playlistId: LIST });
    expect(engine.current.layers.slide?.transition).toEqual({
      kind: 'zoom',
      durationMs: 1000,
      spanMs: 16_000,
    });
  });

  it('carries on after an unexpected restart, with the time its slide had left', () => {
    const clock = { now: 100_000 };
    const first = setup({ clock });
    first.engine.dispatch({ type: 'startRepeat', playlistId: LIST });
    first.elapse(15_000 + 5000);
    expect(first.step()).toBe('deckItem/0');
    const saved = savedFrom(first.engine.current, first.engine.session, new Date(clock.now));
    expect(saved.repeat).toEqual({ playlistId: LIST });
    first.engine.dispose();
    // Drashti starts again two seconds later.
    clock.now += 2000;
    const again = setup({ clock });
    again.engine.restore(saved);
    expect(again.step()).toBe('deckItem/0');
    expect(again.engine.current.repeat).toEqual({ playlistId: LIST, name: 'Lobby pictures' });
    expect(again.engine.current.autoAdvance?.durationMs).toBe(15_000);
    // It had 10 s left when saved (the moments it was down are not counted again).
    again.elapse(9999);
    expect(again.step()).toBe('deckItem/0');
    again.elapse(1);
    expect(again.step()).toBe('deckItem/1');
  });

  it('a stopped one comes back stopped; one with nothing to show, or gone, does not start', () => {
    const first = setup();
    first.engine.dispatch({ type: 'startRepeat', playlistId: LIST });
    first.engine.dispatch({ type: 'stopRepeat' });
    const saved = savedFrom(first.engine.current, first.engine.session);
    expect(saved.repeat).toBeNull();
    const again = setup();
    again.engine.restore(saved);
    expect(again.step()).toBe('pic/picture');
    expect(again.engine.current.repeat).toBeNull();

    const empty = setup({
      items: [{ id: 'clip', kind: 'media', mediaId: 'v1', media: 'video', label: 'Clip.mp4' }],
    });
    expect(empty.engine.dispatch({ type: 'startRepeat', playlistId: LIST })).toMatchObject({
      ok: false,
      error: 'not-playable',
    });
    const gone = setup();
    gone.settings.now = null;
    expect(gone.engine.dispatch({ type: 'startRepeat', playlistId: LIST })).toMatchObject({
      ok: false,
      error: 'unknown-item',
    });
  });

  it('shows its steps as a presentation of their own, a group for each picture or presentation', () => {
    const { repeat } = setup();
    const doc = repeat.doc(ID);
    expect(doc?.repeat).toEqual({ playlistId: LIST });
    expect(doc?.groups.map((g) => [g.name, g.slides.map((s) => s.index)])).toEqual([
      ['Darshan.png', [0]],
      ['Deck', [1, 2]],
      ['Words', [3]],
    ]);
    expect(repeat.doc('deck')).toBeNull();
  });
});
