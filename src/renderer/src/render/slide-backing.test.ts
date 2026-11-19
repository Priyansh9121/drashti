import { describe, expect, it } from 'vitest';
import type { DeckSlide } from '../../../shared/deck';
import type { MediaElement, RenderSlide } from '../../../shared/model';
import { PLAIN } from '../../../shared/picture-look';
import { type ScreenPicturesState, slideBacking } from './slide-backing';

/*
 * What a slide may be backed with while a deck's own move draws it on a layer of its own without a graphics chip
 * (X11): only a slide known to draw no see-through pixel anywhere in its place, so a see-through slide never shows it.
 */

const PICTURE: MediaElement = {
  id: 'picture',
  kind: 'image',
  frame: { x: 0, y: 0, width: 1920, height: 1080 },
  mediaId: 'm-photo',
  fit: 'stretch',
  sourceShapeId: '2',
};
const WORDS = {
  id: 'title',
  kind: 'text' as const,
  frame: { x: 160, y: 120, width: 1600, height: 200 },
  text: 'Placeholder title',
  lang: 'en' as const,
  style: { fontSize: 80 },
};
const slide = (over: Partial<RenderSlide> = {}): RenderSlide => ({
  id: 's',
  width: 1920,
  height: 1080,
  background: null,
  elements: [PICTURE, WORDS] as RenderSlide['elements'],
  ...over,
});
const screen = (over: Partial<ScreenPicturesState> = {}): ScreenPicturesState => ({
  pictures: {},
  liveZoom: null,
  opaque: ['m-photo'],
  ...over,
});
const withPicture = (picture: Partial<MediaElement>) =>
  slide({ elements: [{ ...PICTURE, ...picture }, WORDS] as never });

describe('a moving slide’s backing without a graphics chip (X11)', () => {
  it('its own background colour, when that is opaque', () => {
    expect(slideBacking(slide({ background: '#123456', elements: [] }), null)).toEqual({ colour: '#123456' });
    expect(slideBacking(slide({ background: '#ABCDEFff', elements: [] }), null)).toEqual({
      colour: '#ABCDEF',
    });
    // A colour that can be seen through is no backing (nor is anything else not plainly opaque).
    for (const background of ['#12345680', 'transparent', 'rgba(0, 0, 0, 0.5)', '#123'])
      expect(slideBacking(slide({ background, elements: [] }), null), background).toBeNull();
  });

  it('black under its own full-slide picture, still and as it is, from a file that can draw no see-through pixel', () => {
    expect(slideBacking(slide(), screen())).toEqual({ colour: '#000000', picture: 'm-photo' });
    expect(slideBacking(withPicture({ fit: 'fill' }), screen())).toEqual({
      colour: '#000000',
      picture: 'm-photo',
    });
    // A look that changes only its colours keeps it whole.
    const brighter = screen({
      pictures: { 'm-photo': { ...PLAIN, brightness: 0.2, sharpness: 0.3, blurred: true } },
    });
    expect(slideBacking(slide(), brighter)).toEqual({ colour: '#000000', picture: 'm-photo' });
  });

  it('never when its picture may leave any of its place uncovered or be seen through', () => {
    const cases: [string, RenderSlide, ScreenPicturesState | null][] = [
      ['a file not known opaque', slide(), screen({ opaque: [] })],
      ['the state saying nothing of it', slide(), screen({ opaque: undefined })],
      ['no screen state', slide(), null],
      ['fitted in, with bars', withPicture({ fit: 'fit' }), screen()],
      ['short of the slide', withPicture({ frame: { x: 0, y: 0, width: 1920, height: 1000 } }), screen()],
      ['moved off its place', withPicture({ frame: { x: 10, y: 0, width: 1920, height: 1080 } }), screen()],
      ['part see-through', withPicture({ opacity: 0.9 }), screen()],
      ['hidden', withPicture({ hidden: true }), screen()],
      ['cropped', withPicture({ crop: { x: 0.1, y: 0, width: 0.8, height: 1 } }), screen()],
      ['in a shape', withPicture({ pictureClip: { shape: 'ellipse' } }), screen()],
      ['turned', withPicture({ rotation: 5 }), screen()],
      ['moving of its own', withPicture({ motion: { kind: 'pan' } as never }), screen()],
      ['zoomed by its look', slide(), screen({ pictures: { 'm-photo': { ...PLAIN, zoom: 1.2 } } })],
      ['moved by its look', slide(), screen({ pictures: { 'm-photo': { ...PLAIN, zoom: 1, x: 0.1 } } })],
      ['turned by its look', slide(), screen({ pictures: { 'm-photo': { ...PLAIN, turn: 90 } } })],
      [
        'zoomed live',
        slide(),
        screen({
          liveZoom: {
            mediaId: 'm-photo',
            showing: 's',
            zoom: 2,
            x: 0,
            y: 0,
            from: { zoom: 1, x: 0, y: 0 },
            at: 0,
          },
        }),
      ],
      ['words first', slide({ elements: [WORDS, PICTURE] as never }), screen()],
      ['a video', withPicture({ kind: 'video' }), screen()],
    ];
    for (const [what, s, sc] of cases) expect(slideBacking(s, sc), what).toBeNull();
    // A deck's own effect on the picture (it flies in, say) may leave the slide without it part of the time.
    const deck: DeckSlide = {
      steps: [],
      media: [],
      motion: {
        effects: [{ shapeId: '2', step: 1, phase: 'in', kind: 'fly', delayMs: 0, durationMs: 500 } as never],
        stepsMs: [0, 500],
        approximate: false,
      },
    };
    expect(slideBacking(slide({ deck }), screen())).toBeNull();
  });
});
