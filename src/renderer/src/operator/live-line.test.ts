import { describe, expect, it } from 'vitest';
import { emptyLayers, type Layers, type LiveCursor } from '../../../shared/engine/state';
import type { MediaSummary, PlaylistItemInfo } from '../../../shared/playlists';
import { liveCaptionsShown, liveLine } from './StatusLine';
import { captionsFor, type CaptionsShown } from '../../../shared/captions';

/*
 * LIVE's line in the top bar (alpha.24, livesay): since uitop it is the only place the word LIVE is said, so it says
 * LIVE whenever the LIVE column's own badge said it before (a slide, a background or the picture-in-picture box up),
 * as well as for what it said before (a timer alone, the presentation's slide, a playlist's row still up). With only a
 * background or the box up it names it; never for the wallpaper shown with nothing up, nor Black-out alone (its own
 * badge says that). Since topbar (alpha.24, a25 list item 4, the owner's delegate's A): anything on the audience
 * screens, the stream or the hall's sound is LIVE and named, a lower third, a message, the ticker, the audio or the
 * audience's timer too; and with everything cleared the line no longer says "Live:" beside Off (item 32).
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
    expect(line(picture('pic'), slideAt(1))).toEqual({
      onAir: true,
      text: 'Live: Placeholder Kirtan · slide 2 of 5 (cleared) · Picture · Placeholder backdrop',
    });
  });

  it('with everything cleared: Off, and the cleared place said Cleared, never Live beside Off (topbar, item 32)', () => {
    expect(line(emptyLayers(), slideAt(1))).toEqual({
      onAir: false,
      text: 'Cleared: Placeholder Kirtan · slide 2 of 5',
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
    // Nothing else up: Off, and the row said Cleared (topbar, item 32).
    expect(line(emptyLayers(), atRow, video)).toEqual({
      onAir: false,
      text: 'Cleared: Placeholder clip',
    });
    expect(line(picture('pic'), atRow, video)).toEqual({
      onAir: true,
      text: 'Live: Placeholder clip (cleared) · Picture · Placeholder backdrop',
    });
  });

  it('says LIVE and names a lower third, a message, the ticker, the audio or the audience’s timer up alone: anything on the audience screens, the stream or the hall’s sound (topbar, item 4)', () => {
    const third = (lines: string[], where: 'hall' | 'stream' | 'both' = 'both') =>
      layers({ lowerThird: { id: 'lt', lines, where, shownAt: 1 } as unknown as Layers['lowerThird'] });
    // A lower third by its first line with words; one for the stream alone is broadcast, so it is live too.
    expect(line(third(['', 'Placeholder speaker', 'Placeholder role']))).toEqual({
      onAir: true,
      text: 'Live: Lower third · Placeholder speaker',
    });
    expect(line(third(['Placeholder speaker'], 'stream'))).toEqual({
      onAir: true,
      text: 'Live: Lower third · Placeholder speaker',
    });
    // A message by its words; several by how many.
    expect(line(layers({ messages: [{ id: 'm', text: 'Placeholder message' }] }))).toEqual({
      onAir: true,
      text: 'Live: Message · Placeholder message',
    });
    expect(
      line(
        layers({
          messages: [
            { id: 'm', text: 'Placeholder one' },
            { id: 'n', text: 'Placeholder two' },
          ],
        }),
      ),
    ).toEqual({ onAir: true, text: 'Live: 2 messages' });
    // The ticker by its one announcement, or how many.
    const ticker = (texts: string[]) =>
      layers({ ticker: { items: texts.map((text, i) => ({ id: String(i), text })), startedAt: 1 } });
    expect(line(ticker(['Placeholder announcement']))).toEqual({
      onAir: true,
      text: 'Live: Ticker · Placeholder announcement',
    });
    expect(line(ticker(['Placeholder one', 'Placeholder two', 'Placeholder three']))).toEqual({
      onAir: true,
      text: 'Live: Ticker · 3 announcements',
    });
    // The audio as Audio (its title beside the line, the audio status); paused, it says so.
    const audio = {
      id: 'a',
      title: 'Placeholder audio',
      mediaId: 'snd',
      volume: 1,
      loop: false,
      startedAt: 1,
    };
    expect(line(layers({ audio }))).toEqual({ onAir: true, text: 'Live: Audio' });
    expect(line(layers({ audio: { ...audio, pausedAtMs: 1200 } }))).toEqual({
      onAir: true,
      text: 'Live: Audio · paused',
    });
    // The audience's timer by its name, when this window knows it.
    const timer = layers({ timer: { timerId: 't', shownAt: 1 } });
    expect(
      liveLine({
        live: nowhere,
        layers: timer,
        presentation: undefined,
        item: undefined,
        media,
        timer: 'Placeholder countdown',
      }),
    ).toEqual({
      onAir: true,
      text: 'Live: Timer · Placeholder countdown',
    });
    expect(line(timer)).toEqual({ onAir: true, text: 'Live: Timer' });
    // Several up: each, the background first, then the box, the lower third, the timer, the messages, the ticker, the audio.
    expect(
      line({
        ...picture('pic'),
        lowerThird: third(['Placeholder speaker']).lowerThird,
        messages: [{ id: 'm', text: 'Placeholder message' }],
        audio,
      }),
    ).toEqual({
      onAir: true,
      text: 'Live: Picture · Placeholder backdrop, Lower third · Placeholder speaker, Message · Placeholder message, Audio',
    });
  });

  it('a slide up keeps its line, with a message, a lower third or the audio up beside it; cleared, what is still up is named after it', () => {
    const beside = layers({
      slide,
      messages: [{ id: 'm', text: 'Placeholder message' }],
      lowerThird: {
        id: 'lt',
        lines: ['Placeholder speaker'],
        where: 'both',
        shownAt: 1,
      } as unknown as Layers['lowerThird'],
    });
    expect(line(beside, slideAt(1))).toEqual({
      onAir: true,
      text: 'Live: Placeholder Kirtan · slide 2 of 5',
    });
    expect(line({ ...beside, slide: null }, slideAt(1))).toEqual({
      onAir: true,
      text: 'Live: Placeholder Kirtan · slide 2 of 5 (cleared) · Lower third · Placeholder speaker, Message · Placeholder message',
    });
  });

  it('never says LIVE for the wallpaper or Black-out alone, nor for nothing up', () => {
    expect(line(emptyLayers())).toEqual({ onAir: false, text: 'Nothing live' });
    expect(line(layers({ messages: [] }))).toEqual({ onAir: false, text: 'Nothing live' });
  });
  it('names a public caption band up alone as Captions, without copying recognised speech into the live line', () => {
    const facts = { live: nowhere, layers: emptyLayers(), presentation: undefined, item: undefined, media };
    expect(liveLine({ ...facts, captions: true })).toEqual({ onAir: true, text: 'Live: Captions' });
    expect(liveLine({ ...facts, layers: undefined, captions: true })).toEqual({
      onAir: true,
      text: 'Live: Captions',
    });
    expect(liveLine({ ...facts, captions: false })).toEqual({ onAir: false, text: 'Nothing live' });
  });

  it('keeps LIVE for a cleared presentation while a public caption band remains, naming the band', () => {
    expect(
      liveLine({
        live: slideAt(1),
        layers: emptyLayers(),
        presentation: 'Placeholder Kirtan',
        item: undefined,
        media,
        captions: true,
      }),
    ).toEqual({
      onAir: true,
      text: 'Live: Placeholder Kirtan · slide 2 of 5 (cleared) · Captions',
    });
  });

  it('counts the stream’s caption band even without the hall’s, while an empty public translation with stage-only words never counts', () => {
    const shown: CaptionsShown = {
      lines: ['Placeholder recognised speech'],
      language: 'en',
      audience: false,
      size: 'medium',
      place: 'bottom',
    };
    expect(captionsFor(shown, 'hall')).toBeNull();
    expect(liveCaptionsShown(shown)).toBe(true);
    expect(liveCaptionsShown(null)).toBe(false);
    expect(liveCaptionsShown(undefined)).toBe(false);
    const stageOnly: CaptionsShown = {
      ...shown,
      lines: [],
      kind: 'translation',
      stage: { lines: ['Placeholder stage-only speech'], language: 'en' },
    };
    expect(captionsFor(stageOnly, 'stage')).not.toBeNull();
    expect(liveCaptionsShown(stageOnly)).toBe(false);
  });
});
