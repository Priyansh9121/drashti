import { describe, expect, it } from 'vitest';
import type { AnnouncementsView, Announcement } from '../../shared/announcements';
import type { DeckEffect, DeckSlide } from '../../shared/deck';
import { initialEngineState, type EngineState, type SlideLayer } from '../../shared/engine/state';
import type { RenderSlide, TextElement, TextRun } from '../../shared/model';
import type { StreamStatus } from '../../shared/stream';
import { announcementEvents, engineEvents, screenEvents, streamEvents } from './sources';

/*
 * What the show makes as events out (Session 28): a slide going up (again counts) or off, with the Repeat
 * Slides flag; the playlist item; black-out and the logo; the stream and recording; screens stopping and
 * coming back; announcements waiting. Words apart from ids, always.
 */

const slide = (shownAt: number, text = 'Placeholder line'): SlideLayer => ({
  presentationId: 'p1',
  slideIndex: 2,
  shownAt,
  notes: '',
  slide: {
    id: 's1',
    elements: [{ kind: 'text', text, x: 0, y: 0, width: 100, height: 100 }],
  } as unknown as SlideLayer['slide'],
});

const withSlide = (s: EngineState, layer: SlideLayer | null): EngineState => ({
  ...s,
  layers: { ...s.layers, slide: layer },
  live: {
    ...s.live,
    presentationId: layer?.presentationId ?? null,
    slideIndex: layer?.slideIndex ?? null,
    slideCount: 5,
  },
});

describe('events from the show', () => {
  it('a slide going up, again, and off; ids apart from its words; nothing on the first state', () => {
    const empty = initialEngineState();
    const up = withSlide(empty, slide(1000));
    expect(engineEvents(null, up)).toEqual([]);
    expect(engineEvents(empty, up)).toEqual([
      {
        kind: 'slide.changed',
        data: {
          presentationId: 'p1',
          slideIndex: 2,
          slideCount: 5,
          playlistId: null,
          itemId: null,
          repeat: false,
        },
        words: { text: 'Placeholder line' },
      },
    ]);
    // The same slide shown again is a change; the same showing is not.
    expect(engineEvents(up, withSlide(empty, slide(2000)))).toHaveLength(1);
    expect(engineEvents(up, { ...up })).toEqual([]);
    expect(engineEvents(up, withSlide(empty, null))).toMatchObject([
      { kind: 'slide.changed', data: { presentationId: null, slideIndex: null } },
    ]);
  });

  it('a slide from a Repeat Slides run says so; its words are cut to 200 characters', () => {
    const empty = initialEngineState();
    const long = 'x'.repeat(300);
    const run = { ...withSlide(empty, slide(1000, long)), repeat: { playlistId: 'r1', name: 'Lobby' } };
    const [e] = engineEvents(empty, run);
    expect(e?.data['repeat']).toBe(true);
    expect(e?.words?.['text']).toHaveLength(200);
  });

  it('the playlist item, black-out and the Wallpaper (the logo until Session 55)', () => {
    const s = initialEngineState();
    const item = { ...s, live: { ...s.live, playlist: { playlistId: 'pl', itemId: 'i2' } } };
    expect(engineEvents(s, item)).toEqual([
      { kind: 'item.changed', data: { playlistId: 'pl', itemId: 'i2' } },
    ]);
    expect(engineEvents(s, { ...s, blackout: true })).toEqual([
      { kind: 'blackout.changed', data: { on: true } },
    ]);
    const wallpaper = { ...s, wallpaper: true };
    expect(engineEvents(s, wallpaper)).toEqual([{ kind: 'wallpaper.changed', data: { on: true } }]);
    expect(engineEvents(wallpaper, s)).toEqual([{ kind: 'wallpaper.changed', data: { on: false } }]);
  });

  it('the stream on air, reconnecting and ended; recording started and stopped', () => {
    const status = (live: StreamStatus['live']['state'], rec: StreamStatus['recording']['state']) =>
      ({ live: { state: live, destinations: [] }, recording: { state: rec } }) as unknown as StreamStatus;
    expect(streamEvents(status('starting', 'off'), status('live', 'off'))).toEqual([
      { kind: 'stream.started', data: { places: 1 } },
    ]);
    expect(streamEvents(status('live', 'off'), status('reconnecting', 'off'))).toEqual([
      { kind: 'stream.reconnecting', data: { places: 1 } },
    ]);
    // Back on air after reconnecting is not a new start.
    expect(streamEvents(status('reconnecting', 'off'), status('live', 'off'))).toEqual([]);
    expect(streamEvents(status('ending', 'off'), status('off', 'off'))).toEqual([
      { kind: 'stream.ended', data: {} },
    ]);
    expect(streamEvents(status('off', 'starting'), status('off', 'recording'))).toEqual([
      { kind: 'recording.started', data: {} },
    ]);
    expect(streamEvents(status('off', 'recording'), status('off', 'off'))).toEqual([
      { kind: 'recording.stopped', data: {} },
    ]);
  });

  it('a screen stopping and coming back, its name as words', () => {
    const was = [{ screenId: 'sc1', state: 'showing', name: 'Hall left' }];
    const stopped = [{ screenId: 'sc1', state: 'stopped', name: 'Hall left' }];
    expect(screenEvents(was, stopped)).toEqual([
      { kind: 'screen.stopped', data: { screenId: 'sc1' }, words: { name: 'Hall left' } },
    ]);
    expect(screenEvents(stopped, was)).toEqual([
      { kind: 'screen.showing', data: { screenId: 'sc1' }, words: { name: 'Hall left' } },
    ]);
    expect(screenEvents(was, was)).toEqual([]);
  });

  it('an announcement newly waiting, its words apart', () => {
    const a = { id: 'a1', text: 'Placeholder notice' } as Announcement;
    const none: AnnouncementsView = { waiting: [], showing: [], earlier: [] };
    expect(announcementEvents(none, { ...none, waiting: [a] })).toEqual([
      { kind: 'announcement.waiting', data: { announcementId: 'a1' }, words: { text: 'Placeholder notice' } },
    ]);
    expect(announcementEvents({ ...none, waiting: [a] }, { ...none, waiting: [a] })).toEqual([]);
  });
});

/*
 * A PowerPoint deck's slide Drashti plays itself (W6's review L11): events out says what the screens show at the click
 * showing, as the stills and a phone draw it (shared/deck-show.ts's deckSlideAt), never a later click's words, nor the
 * words of a shape that has gone; and says it again at each click, Back's too. A deck's slide shown as clips, and every
 * other slide, as before.
 */
describe('events from a deck’s slide Drashti plays itself', () => {
  const box = (shape: string, text: string, runs?: TextRun[]): TextElement => ({
    id: `placeholder-${shape}`,
    kind: 'text',
    sourceShapeId: shape,
    frame: { x: 100, y: 100 * Number(shape), width: 800, height: 90 },
    text,
    lang: null,
    style: {
      fontFamily: null,
      fontSize: 40,
      fontWeight: 400,
      color: '#ffffff',
      align: 'left',
      verticalAlign: 'top',
      lineHeight: 1.2,
      shadow: false,
    },
    ...(runs ? { runs } : {}),
  });
  const effect = (
    shapeId: string,
    step: number,
    phase: 'in' | 'out',
    paragraphs?: [number, number],
  ): DeckEffect => ({
    shapeId,
    step,
    phase,
    kind: 'fade',
    delayMs: 0,
    durationMs: 200,
    ...(paragraphs ? { paragraphs } : {}),
  });
  const motion = {
    effects: [
      // Click 1: a box comes in, and the first point of a list built point by point.
      effect('4', 1, 'in'),
      effect('5', 1, 'in', [0, 0]),
      // Click 2: a box goes, and the second point comes in.
      effect('3', 2, 'out'),
      effect('5', 2, 'in', [1, 1]),
    ],
    stepsMs: [0, 200, 200],
    approximate: false,
  };
  const deckSlide = (deck: DeckSlide): RenderSlide => ({
    id: 'placeholder-deck-slide',
    width: 1920,
    height: 1080,
    background: null,
    elements: [
      box('2', 'Placeholder title'),
      box('3', 'Placeholder leaving at click two'),
      box('4', 'Placeholder in at click one'),
      box('5', 'Placeholder first point\nPlaceholder second point', [
        { text: 'Placeholder first point\n' },
        { text: 'Placeholder second point', color: '#ffeeaa' },
      ]),
    ],
    deck,
  });
  const native = deckSlide({ steps: [], media: [], motion });
  const layer = (slide: RenderSlide, step: number, extra: Partial<SlideLayer> = {}): SlideLayer => ({
    presentationId: 'placeholder-deck',
    slideIndex: 0,
    shownAt: 1000,
    notes: '',
    slide,
    step,
    stepAt: 1000 + step * 500,
    ...extra,
  });
  const empty = initialEngineState();
  const at = (step: number, extra: Partial<SlideLayer> = {}) => withSlide(empty, layer(native, step, extra));
  const sent = (step: number, text: string) => [
    {
      kind: 'slide.changed',
      data: {
        presentationId: 'placeholder-deck',
        slideIndex: 0,
        slideCount: 5,
        playlistId: null,
        itemId: null,
        repeat: false,
        step,
      },
      words: { text },
    },
  ];

  it('sends only the words on the screens at the click showing, again at each click, Back’s too', () => {
    // Coming in: the title and the box that goes at click 2; nothing of click 1's, no point of the list yet.
    expect(engineEvents(empty, at(0))).toEqual(
      sent(0, 'Placeholder title\nPlaceholder leaving at click two'),
    );
    // Click 1: its box and the list's first point come in; the second point is still to come.
    expect(engineEvents(at(0), at(1))).toEqual(
      sent(
        1,
        'Placeholder title\nPlaceholder leaving at click two\nPlaceholder in at click one\nPlaceholder first point',
      ),
    );
    // Click 2: the box that went is gone from the words too.
    expect(engineEvents(at(1), at(2))).toEqual(
      sent(
        2,
        'Placeholder title\nPlaceholder in at click one\nPlaceholder first point\nPlaceholder second point',
      ),
    );
    // Back to click 1: as the screens show it again.
    expect(engineEvents(at(2), at(1, { stepAt: 4000, stepFromMs: 200 }))).toEqual(
      sent(
        1,
        'Placeholder title\nPlaceholder leaving at click two\nPlaceholder in at click one\nPlaceholder first point',
      ),
    );
    // Come back to from the slide after: shown again, at its last click.
    expect(engineEvents(empty, at(2, { shownAt: 9000, stepAt: 9000 }))).toEqual(
      sent(
        2,
        'Placeholder title\nPlaceholder in at click one\nPlaceholder first point\nPlaceholder second point',
      ),
    );
    // The same click shown settled (Back undoing a Next while it moved) changes no words: nothing is sent.
    expect(engineEvents(at(1), at(1, { stepAt: 3000, stepFromMs: 200 }))).toEqual([]);
  });

  it('a deck’s slide shown as clips, and its clicks, as before: every line, once, as it comes in', () => {
    const clips = deckSlide({
      steps: [0, 1, 2].map((n) => ({
        clipId: `placeholder-clip-${String(n)}`,
        clipMs: 500,
        lastId: `placeholder-still-${String(n)}`,
      })),
      media: [],
      motion,
    });
    const shown = (step: number) => withSlide(empty, layer(clips, step));
    expect(engineEvents(empty, shown(0))).toEqual([
      {
        kind: 'slide.changed',
        data: {
          presentationId: 'placeholder-deck',
          slideIndex: 0,
          slideCount: 5,
          playlistId: null,
          itemId: null,
          repeat: false,
        },
        words: {
          text: 'Placeholder title\nPlaceholder leaving at click two\nPlaceholder in at click one\nPlaceholder first point\nPlaceholder second point',
        },
      },
    ]);
    expect(engineEvents(shown(0), shown(1))).toEqual([]);
  });
});
