import { describe, expect, it } from 'vitest';
import { emptyLayers, type Layers, type LiveCursor } from '../../../shared/engine/state';
import type { MediaSummary, PlaylistItemInfo } from '../../../shared/playlists';
import { liveLine } from './StatusLine';

/*
 * LIVE's line in the top bar (alpha.24, livesay): since uitop it is the only place the word LIVE is said, so it says
 * LIVE whenever the LIVE column's own badge said it before (a slide, a background or the picture-in-picture box up),
 * as well as for what it said before (a timer alone, the presentation's slide, a playlist's row still up). With only a
 * background or the box up it names it; never for the wallpaper shown with nothing up, nor Black-out alone (its own
 * badge says that), nor a message, ticker or lower third alone (the LIVE column never counted those either).
 */

const nowhere: LiveCursor = {
  presentationId: null,
  slideIndex: null,
  slideCount: 0,
  arrangementId: null,
  playlist: null,
};
const layers = (more: Partial<Layers>): Layers => ({ ...emptyLayers(), ...more });
const media: MediaSummary[] = [
  {
    id: 'pic',
    name: 'Placeholder backdrop',
    kind: 'image',
    missing: false,
    unplayable: null,
    format: null,
    convertedTo: null,
  },
  {
    id: 'clip',
    name: 'Placeholder clip',
    kind: 'video',
    missing: false,
    unplayable: null,
    format: null,
    convertedTo: null,
  },
];
const line = (l: Layers, live: LiveCursor = nowhere, item?: PlaylistItemInfo) =>
  liveLine({ live, layers: l, presentation: 'Placeholder Kirtan', item, media });

const picture = (mediaId: string) =>
  layers({ background: { kind: 'media', mediaId, media: 'image', fit: 'fill', loop: false, startedAt: 1 } });
const slideAt = (index: number): LiveCursor => ({
  ...nowhere,
  presentationId: 'k',
  slideIndex: index,
  slideCount: 5,
});
const slide = {
  presentationId: 'k',
  slideIndex: 1,
  slide: { elements: [] },
  shownAt: 1,
  notes: '',
} as unknown as Layers['slide'];
const input = {
  kind: 'input',
  inputId: 'in-1',
  name: 'Placeholder input',
  device: 'Placeholder camera',
} as const;

describe('LIVE’s line in the top bar, LIVE said once (alpha.24, livesay)', () => {
  it('says Off and Nothing live with nothing up (the chosen wallpaper or black shows)', () => {
    expect(line(emptyLayers())).toEqual({ onAir: false, text: 'Nothing live' });
  });

  it('says LIVE and names a background up alone: a picture, a video, a colour, a video input, a window, a stream link', () => {
    expect(line(picture('pic'))).toEqual({ onAir: true, text: 'Live: Picture · Placeholder backdrop' });
    expect(
      line(
        layers({
          background: {
            kind: 'media',
            mediaId: 'clip',
            media: 'video',
            fit: 'fill',
            loop: true,
            startedAt: 1,
          },
        }),
      ),
    ).toEqual({ onAir: true, text: 'Live: Video · Placeholder clip' });
    // A file the window has not listed (yet): its kind alone.
    expect(line(picture('unknown'))).toEqual({ onAir: true, text: 'Live: Picture' });
    expect(line(layers({ background: { kind: 'color', color: '#1d4e89' } }))).toEqual({
      onAir: true,
      text: 'Live: Background colour',
    });
    expect(
      line(
        layers({
          background: {
            kind: 'input',
            inputId: 'in-1',
            name: 'Placeholder input',
            device: 'Placeholder camera',
            fit: 'fit',
            startedAt: 1,
          },
        }),
      ),
    ).toEqual({ onAir: true, text: 'Live: Video input · Placeholder input' });
    expect(
      line(
        layers({
          background: { kind: 'window', sourceId: 'window:1:0', name: 'Placeholder window', startedAt: 1 },
        }),
      ),
    ).toEqual({ onAir: true, text: 'Live: Window · Placeholder window' });
    expect(
      line(layers({ background: { kind: 'link', linkId: 'l', name: 'YouTube live', startedAt: 1 } })),
    ).toEqual({
      onAir: true,
      text: 'Live: Stream link · YouTube live',
    });
  });

  it('says LIVE and names the picture-in-picture box up alone, with what it holds', () => {
    const box = (source: NonNullable<Layers['pip']>['source']) =>
      layers({
        pip: { source, place: {} as NonNullable<Layers['pip']>['place'], swapped: false, shownAt: 1 },
      });
    expect(line(box({ kind: 'media', mediaId: 'pic', media: 'image' }))).toEqual({
      onAir: true,
      text: 'Live: Picture in picture · Placeholder backdrop',
    });
    expect(line(box(input))).toEqual({
      onAir: true,
      text: 'Live: Picture in picture · Placeholder input',
    });
    // With a background up too: both, the background first.
    expect(line({ ...picture('pic'), pip: box(input).pip })).toEqual({
      onAir: true,
      text: 'Live: Picture · Placeholder backdrop, Picture in picture · Placeholder input',
    });
  });

  it('says LIVE for a slide up without a place in a presentation', () => {
    expect(line(layers({ slide }))).toEqual({ onAir: true, text: 'Live: Slide' });
  });

  it('keeps the slide’s line as it was while the slide is up, a background under it or not', () => {
    expect(line(layers({ slide }), slideAt(1))).toEqual({
      onAir: true,
      text: 'Live: Placeholder Kirtan · slide 2 of 5',
    });
    expect(line({ ...picture('pic'), slide }, slideAt(1))).toEqual({
      onAir: true,
      text: 'Live: Placeholder Kirtan · slide 2 of 5',
    });
  });

  it('with the slide cleared and a background still up: LIVE, the cleared slide’s place, and what is still up', () => {
    expect(line(emptyLayers(), slideAt(1))).toEqual({
      onAir: false,
      text: 'Live: Placeholder Kirtan · slide 2 of 5 (cleared)',
    });
    expect(line(picture('pic'), slideAt(1))).toEqual({
      onAir: true,
      text: 'Live: Placeholder Kirtan · slide 2 of 5 (cleared) · Picture · Placeholder backdrop',
    });
  });

  it('a playlist row taken off while another background is up: LIVE, the row cleared, and what is up', () => {
    const video: PlaylistItemInfo = {
      id: 'i-clip',
      kind: 'media',
      label: 'Placeholder clip',
      mediaId: 'clip',
      media: 'video',
      missing: false,
      unplayable: null,
      timers: [],
    };
    const atRow: LiveCursor = { ...nowhere, playlist: { playlistId: 'p', itemId: 'i-clip' } };
    expect(line(emptyLayers(), atRow, video)).toEqual({
      onAir: false,
      text: 'Live: Placeholder clip (cleared)',
    });
    expect(line(picture('pic'), atRow, video)).toEqual({
      onAir: true,
      text: 'Live: Placeholder clip (cleared) · Picture · Placeholder backdrop',
    });
  });

  it('never says LIVE for a message, a ticker or a lower third alone, as the LIVE column never did', () => {
    expect(line(layers({ messages: [{ id: 'm', text: 'Placeholder' }] }))).toEqual({
      onAir: false,
      text: 'Nothing live',
    });
    expect(line(layers({ ticker: {} as Layers['ticker'] }))).toEqual({ onAir: false, text: 'Nothing live' });
    expect(line(layers({ lowerThird: {} as Layers['lowerThird'] }))).toEqual({
      onAir: false,
      text: 'Nothing live',
    });
  });
});
