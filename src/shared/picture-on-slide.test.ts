import { describe, expect, it } from 'vitest';
import type { MediaElement, Rect, RenderSlide } from './model';
import { cropRenderedPage } from './pdf-page-crop';
import { type PictureLook, PLAIN } from './picture-look';
import { lookOnSlide, type OnSlide, onSlideOf, onSlideSchema } from './picture-on-slide';

/*
 * Save picture… of a slide's picture (Session 55, Part 5; a22-x95nits): the picture as its slide shows it, beyond its
 * own look. A page cropped with Crop page… saved the whole page, and a page turned with Turn page right saved it
 * unturned (a22-review-x95's nit), where the guides say a picture is saved "rotated, flipped and cropped as it shows".
 * Made-up ids; the figures worked by hand.
 */

const picture = (frame: Rect, how: Partial<MediaElement> = {}): MediaElement => ({
  id: 'e1',
  kind: 'image',
  mediaId: 'm-page',
  fit: 'fill',
  frame,
  ...how,
});

const slideOf = (element: MediaElement, width: number, height: number): RenderSlide => ({
  id: 's1',
  width,
  height,
  background: null,
  elements: [element],
});

/** A 480 x 320 PDF page shown as its picture. */
const PAGE = picture({ x: 0, y: 0, width: 480, height: 320 });
/**
 * The same page turned right once (editor/pdf-page-ops.ts turnedElement): the slide 320 x 480, the picture's box kept
 * 480 x 320, its middle at the slide's middle, turned 90 about it.
 */
const TURNED = picture({ x: -80, y: 80, width: 480, height: 320 }, { rotation: 90 });

/** What `onSlideOf` gives, and the plain look with it. */
function shown(element: MediaElement, slide: RenderSlide): { on: OnSlide | null; look: PictureLook | null } {
  const on = onSlideOf(element, slide);
  return { on, look: lookOnSlide(PLAIN, on) };
}

describe('Save picture… saves a slide’s picture as its slide shows it', () => {
  it('a page shown as its picture, neither turned nor cropped: as before, its own look alone', () => {
    expect(onSlideOf(PAGE, slideOf(PAGE, 480, 320))).toBeNull();
    expect(lookOnSlide(PLAIN, null)).toBe(PLAIN);
    expect(lookOnSlide(null, null)).toBeNull();
  });

  it('a page turned with Turn page right: turned', () => {
    expect(shown(TURNED, slideOf(TURNED, 320, 480))).toEqual({
      on: { turn: 90 },
      look: { ...PLAIN, turn: 90, flipX: false, flipY: false },
    });
    const twice = picture({ x: 0, y: 0, width: 480, height: 320 }, { rotation: 180 });
    expect(onSlideOf(twice, slideOf(twice, 480, 320))).toEqual({ turn: 180 });
    const thrice = picture({ x: -80, y: 80, width: 480, height: 320 }, { rotation: 270 });
    expect(onSlideOf(thrice, slideOf(thrice, 320, 480))).toEqual({ turn: 270 });
  });

  it('a page cropped with Crop page…: the part kept', () => {
    const page = picture({ x: 0, y: 0, width: 1920, height: 1080 });
    const left = cropRenderedPage(slideOf(page, 1920, 1080), { x: 0, y: 0, w: 0.6, h: 1 });
    expect(shown(page, left)).toEqual({
      on: { part: { x: 0, y: 0, w: 0.6, h: 1 } },
      look: { ...PLAIN, crop: { x: 0, y: 0, w: 0.6, h: 1 } },
    });
    const middle = cropRenderedPage(slideOf(page, 1920, 1080), { x: 0.25, y: 0.1, w: 0.5, h: 0.4 });
    const on = onSlideOf(page, middle);
    expect(on?.part?.x).toBeCloseTo(0.25, 12);
    expect(on?.part?.y).toBeCloseTo(0.1, 12);
    expect(on?.part?.w).toBeCloseTo(0.5, 12);
    expect(on?.part?.h).toBeCloseTo(0.4, 12);
  });

  it('a page turned right and then cropped (the crop in the turned page’s parts): turned, then that part', () => {
    // The turned page's top right quarter: 160 x 240 from 160, 0 of the 320 x 480 turned page.
    const quarter = cropRenderedPage(slideOf(TURNED, 320, 480), { x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expect(shown(TURNED, quarter)).toEqual({
      on: { turn: 90, part: { x: 0.5, y: 0, w: 0.5, h: 0.5 } },
      look: { ...PLAIN, turn: 90, flipX: false, flipY: false, crop: { x: 0.5, y: 0, w: 0.5, h: 0.5 } },
    });
  });

  it('after the picture’s own look: its own turn and crop, then the slide’s', () => {
    const kept: PictureLook = { ...PLAIN, zoom: 1.5, turn: 90, crop: { x: 0, y: 0, w: 0.5, h: 1 } };
    // Turned once more by the page: 180 in all; its left half, turned clockwise, is the top half.
    expect(lookOnSlide(kept, { turn: 90 })).toEqual({
      ...kept,
      turn: 180,
      flipX: false,
      flipY: false,
      crop: { x: 0, y: 0, w: 1, h: 0.5 },
    });
    // Then a page crop of the left 0.6 of that: of the top half, its left 0.6.
    expect(lookOnSlide(kept, { turn: 90, part: { x: 0, y: 0, w: 0.6, h: 1 } })?.crop).toEqual({
      x: 0,
      y: 0,
      w: 0.6,
      h: 0.5,
    });
  });

  it('a picture with a crop of its own (a deck’s cropped picture): that part of it, inside its own look’s', () => {
    const deck = picture(
      { x: 480, y: 270, width: 960, height: 540 },
      { crop: { x: 0.4, y: 0.1, width: 0.5, height: 0.5 } },
    );
    expect(shown(deck, slideOf(deck, 1920, 1080))).toEqual({
      on: { crop: { x: 0.4, y: 0.1, w: 0.5, h: 0.5 } },
      look: { ...PLAIN, crop: { x: 0.4, y: 0.1, w: 0.5, h: 0.5 } },
    });
    // Its own look keeps the right half: the slide's part of that.
    const kept: PictureLook = { ...PLAIN, crop: { x: 0.5, y: 0, w: 0.5, h: 1 } };
    const crop = lookOnSlide(kept, onSlideOf(deck, slideOf(deck, 1920, 1080)))?.crop;
    expect(crop?.x).toBeCloseTo(0.7, 12);
    expect(crop?.y).toBeCloseTo(0.1, 12);
    expect(crop?.w).toBeCloseTo(0.25, 12);
    expect(crop?.h).toBeCloseTo(0.5, 12);
  });

  it('a picture flipped on its slide: flipped (then turned, as the screens draw it)', () => {
    const across = picture({ x: 0, y: 0, width: 960, height: 540 }, { flipX: true });
    expect(shown(across, slideOf(across, 1920, 1080))).toEqual({
      on: { flipX: true },
      look: { ...PLAIN, flipX: true },
    });
    // Flipped across, then turned right: the turned picture flipped up and down.
    const both = picture({ x: 0, y: 0, width: 960, height: 540 }, { flipX: true, rotation: 90 });
    expect(shown(both, slideOf(both, 1920, 1080)).look).toEqual({
      ...PLAIN,
      turn: 90,
      flipX: false,
      flipY: true,
    });
  });

  it('a turn that is not a quarter turn is left out, as before; a page crop with it too', () => {
    const tilted = picture({ x: 0, y: 0, width: 960, height: 540 }, { rotation: 25 });
    expect(onSlideOf(tilted, slideOf(tilted, 1920, 1080))).toBeNull();
    expect(
      onSlideOf(tilted, cropRenderedPage(slideOf(tilted, 1920, 1080), { x: 0, y: 0, w: 0.25, h: 1 })),
    ).toBeNull();
  });

  it('on a cropped page, a small picture all inside the crop is whole; one the crop cuts through, the part kept', () => {
    const page = (frame: Rect) =>
      cropRenderedPage(slideOf(picture(frame), 1920, 1080), { x: 0, y: 0, w: 0.5, h: 1 });
    const inside = { x: 100, y: 100, width: 400, height: 300 };
    expect(onSlideOf(picture(inside), page(inside))).toBeNull();
    // 400 x 300 from 800, 100: the crop keeps 800 to 960 of it, its left 0.4.
    const cut = { x: 800, y: 100, width: 400, height: 300 };
    expect(onSlideOf(picture(cut), page(cut))).toEqual({ part: { x: 0, y: 0, w: 0.4, h: 1 } });
    // Not on the page as cropped at all: nothing of it is shown, so nothing more is done.
    const outside = { x: 1200, y: 100, width: 400, height: 300 };
    expect(onSlideOf(picture(outside), page(outside))).toBeNull();
  });

  it('the main process takes only a slide’s turn, flips and parts', () => {
    for (const ok of [{ turn: 90 }, { flipX: true, part: { x: 0.5, y: 0, w: 0.5, h: 0.5 } }, {}])
      expect(onSlideSchema.safeParse(ok).success, JSON.stringify(ok)).toBe(true);
    for (const bad of [
      { turn: 45 },
      { part: { x: 0.8, y: 0, w: 0.5, h: 1 } },
      { crop: { x: 0, y: 0, w: 0, h: 1 } },
      { part: { x: Number.NaN, y: 0, w: 1, h: 1 } },
      { zoom: 2 },
      'turn',
    ])
      expect(onSlideSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});
