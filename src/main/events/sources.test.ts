import { describe, expect, it } from 'vitest';
import type { AnnouncementsView, Announcement } from '../../shared/announcements';
import { initialEngineState, type EngineState, type SlideLayer } from '../../shared/engine/state';
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

  it('the playlist item, black-out and the logo', () => {
    const s = initialEngineState();
    const item = { ...s, live: { ...s.live, playlist: { playlistId: 'pl', itemId: 'i2' } } };
    expect(engineEvents(s, item)).toEqual([
      { kind: 'item.changed', data: { playlistId: 'pl', itemId: 'i2' } },
    ]);
    expect(engineEvents(s, { ...s, blackout: true })).toEqual([
      { kind: 'blackout.changed', data: { on: true } },
    ]);
    const logo = { ...s, logo: { id: 'logo', name: 'Logo', elements: [] } };
    expect(engineEvents(s, logo)).toEqual([{ kind: 'logo.changed', data: { on: true } }]);
    expect(engineEvents(logo, s)).toEqual([{ kind: 'logo.changed', data: { on: false } }]);
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
