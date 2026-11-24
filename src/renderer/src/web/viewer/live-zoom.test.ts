import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState } from '../../../../shared/engine/state';
import type { MediaElement } from '../../../../shared/model';
import { cropRenderedPage } from '../../../../shared/pdf-page-crop';
import { backgroundShowing, type CropRect, PLAIN, slideShowing } from '../../../../shared/picture-look';
import { renderEditedSlide } from '../../../../shared/slide-design';
import type { EditDoc, EditSlide } from '../../../../shared/slide-edit';
import { findSlide, newSlide } from '../../editor/ops';
import { turnPdfPageRight } from '../../editor/pdf-page-ops';
import {
  type Framing,
  frameInCanvas,
  frameInSlide,
  frameOfBackground,
  FULL_FRAME,
  keptFraming,
  liveFramingOf,
  liveZoomFor,
  maxZoomOver,
  phoneZoomTarget,
  screensFollow,
  viewForLive,
  zoomTargetOf,
} from './live-zoom';

/*
 * Show it on the screens (Session 54, D2): the zoom a phone looks at, as the screens' live zoom of the picture
 * there. Made-up ids; a slide with a picture in its top left quarter, and a background picture.
 */

const CANVAS = { width: 1920, height: 1080 };

function withSlidePicture(): EngineState {
  const state = initialEngineState();
  return {
    ...state,
    layers: {
      ...state.layers,
      slide: {
        presentationId: 'p1',
        slideIndex: 2,
        shownAt: 5000,
        notes: '',
        slide: {
          id: 's1',
          width: 1920,
          height: 1080,
          background: null,
          elements: [
            {
              id: 'e1',
              kind: 'image',
              mediaId: 'm-page',
              fit: 'fit',
              frame: { x: 0, y: 0, width: 960, height: 540 },
            },
          ],
        },
      },
    },
  };
}

function withBackground(): EngineState {
  const state = initialEngineState();
  return {
    ...state,
    layers: {
      ...state.layers,
      background: {
        kind: 'media',
        mediaId: 'm-bg',
        media: 'image',
        fit: 'fit',
        loop: false,
        startedAt: 7000,
      },
    },
  };
}

describe('the picture the screens zoom (Session 54, D2)', () => {
  it('is the slide’s own picture, else the background picture, as the engine has it', () => {
    expect(zoomTargetOf(withSlidePicture())).toEqual({ mediaId: 'm-page', showing: slideShowing(5000) });
    expect(zoomTargetOf(withBackground())).toEqual({ mediaId: 'm-bg', showing: backgroundShowing(7000) });
    expect(zoomTargetOf(initialEngineState())).toBeNull();
    expect(zoomTargetOf(null)).toBeNull();
  });

  it('has its frame where the phone draws it: the slide’s picture’s own box, or the whole of it for a background', () => {
    expect(frameInSlide(withSlidePicture())).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 });
    expect(frameInCanvas(withSlidePicture(), CANVAS)).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 });
    expect(frameInSlide(withBackground())).toEqual(FULL_FRAME);
    expect(frameInCanvas(withBackground(), CANVAS)).toEqual(FULL_FRAME);
    expect(frameInCanvas(initialEngineState(), CANVAS)).toBeNull();
    // A 4:3 slide fitted into the 16:9 canvas: its picture's box moves in by the bars beside it.
    const narrow = withSlidePicture();
    const slide = narrow.layers.slide;
    if (!slide) throw new Error('no slide');
    slide.slide = { ...slide.slide, width: 1440, height: 1080 };
    expect(frameInCanvas(narrow, CANVAS)?.x).toBeCloseTo(240 / 1920);
  });

  it('has its frame where the phone draws a cropped PDF page: the page moved by its crop (Crop page…)', () => {
    // The page's picture over the whole 1920 x 1080 page, cropped to its right half's middle band: the slide is the
    // 960 x 540 crop, and the picture keeps its whole-page box, moved left and up by where the crop starts.
    const cropped = withSlidePicture();
    const layer = cropped.layers.slide;
    if (!layer) throw new Error('no slide');
    const page = {
      ...layer.slide,
      elements: layer.slide.elements.map((e) => ({ ...e, frame: { x: 0, y: 0, width: 1920, height: 1080 } })),
    };
    layer.slide = cropRenderedPage(page, { x: 0.5, y: 0.25, w: 0.5, h: 0.5 });
    expect(layer.slide.pageCrop).toEqual({ x: 960, y: 270, width: 1920, height: 1080 });
    // In the slide: the crop is a quarter of the page, so the page is twice as wide and high, from -1 and -0.5. What
    // the screens show of it is the crop, so the middle they show is the slide's (a22-zoomcropfix).
    const middle = { x: 0.5, y: 0.5 };
    expect(frameInSlide(cropped)).toEqual({ x: -1, y: -0.5, width: 2, height: 2, middle });
    // In the canvas: the 960 x 540 crop fitted at twice its size, so the same, of the canvas, the crop in its middle.
    expect(frameInCanvas(cropped, CANVAS)).toEqual({ x: -1, y: -0.5, width: 2, height: 2, middle });
    // A crop of the page's left half, whole height: fitted at 1 between bars of 480, its page from 480 in.
    layer.slide = cropRenderedPage(page, { x: 0, y: 0, w: 0.5, h: 1 });
    expect(frameInSlide(cropped)).toEqual({ x: 0, y: 0, width: 2, height: 1, middle });
    expect(frameInCanvas(cropped, CANVAS)).toEqual({ x: 480 / 1920, y: 0, width: 1, height: 1, middle });
    // Its right half: the page starts a crop's width (960) before the crop, at 480 - 960 in the canvas.
    layer.slide = cropRenderedPage(page, { x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(frameInSlide(cropped)).toEqual({ x: -1, y: 0, width: 2, height: 1, middle });
    expect(frameInCanvas(cropped, CANVAS)).toEqual({ x: -480 / 1920, y: 0, width: 1, height: 1, middle });
  });

  it('is never the background behind a slide of words, which the phone does not show as the screens’ picture', () => {
    // A slide of words up over the background picture: the engine would zoom the background, which neither the
    // slide's page nor the hall's picture on the phone shows as the picture zoomed: no frame, so no button.
    const words = withBackground();
    words.layers.slide = {
      presentationId: 'p1',
      slideIndex: 0,
      shownAt: 9000,
      notes: '',
      slide: { id: 's-words', width: 1920, height: 1080, background: null, elements: [] },
    };
    expect(zoomTargetOf(words)?.mediaId).toBe('m-bg');
    expect(phoneZoomTarget(words)).toBeNull();
    expect(frameInCanvas(words, CANVAS)).toBeNull();
    expect(frameInSlide(words)).toBeNull();
    // The background alone, or the slide's own picture: the phone may zoom it.
    expect(phoneZoomTarget(withBackground())?.mediaId).toBe('m-bg');
    expect(phoneZoomTarget(withSlidePicture())?.mediaId).toBe('m-page');
  });

  it('frames a picture shown in its own shape as the screens fit it into theirs', () => {
    // A 4:3 picture fitted whole into 16:9: the screens' frame reaches past its sides.
    const square = { width: 1600, height: 1200 };
    const f = frameOfBackground('fit', square, CANVAS);
    expect(f.y).toBe(0);
    expect(f.height).toBe(1);
    expect(f.width).toBeCloseTo(16 / 9 / (4 / 3));
    expect(f.x).toBeCloseTo((1 - f.width) / 2);
    // Filling: the frame is the middle band of it.
    const fill = frameOfBackground('fill', square, CANVAS);
    expect(fill.width).toBe(1);
    expect(fill.height).toBeCloseTo(4 / 3 / (16 / 9));
    expect(frameOfBackground('stretch', square, CANVAS)).toEqual(FULL_FRAME);
  });
});

describe('a phone’s zoom put on the screens (Session 54, D2)', () => {
  it('shows what the middle of the phone shows, as big', () => {
    // A background picture, kept plain: the phone at twice, a quarter from the left.
    expect(liveZoomFor({ zoom: 2, cx: 0.25, cy: 0.5 }, FULL_FRAME, PLAIN)).toEqual({ zoom: 2, x: 0.5, y: 0 });
    // Whole on the phone: whole on the screens.
    expect(liveZoomFor({ zoom: 1, cx: 0.5, cy: 0.5 }, FULL_FRAME, PLAIN)).toEqual({ zoom: 1, x: 0, y: 0 });
    // Past what the screens allow (an edge would come in): as far as they go.
    expect(liveZoomFor({ zoom: 2, cx: 0.05, cy: 0.5 }, FULL_FRAME, PLAIN).x).toBe(0.5);
    // A slide's picture in its top left quarter: the middle of that quarter is the frame's middle.
    expect(
      liveZoomFor({ zoom: 3, cx: 0.25, cy: 0.25 }, { x: 0, y: 0, width: 0.5, height: 0.5 }, PLAIN),
    ).toEqual({
      zoom: 3,
      x: 0,
      y: 0,
    });
  });

  it('adds the phone’s zoom to the picture’s kept look, which the phone draws too', () => {
    const kept = { zoom: 1.5, x: 0.1, y: 0 };
    // The phone at whole: the screens as kept.
    const asKept = liveZoomFor({ zoom: 1, cx: 0.5, cy: 0.5 }, FULL_FRAME, kept);
    expect(asKept.zoom).toBeCloseTo(kept.zoom);
    expect(asKept.x).toBeCloseTo(kept.x);
    expect(asKept.y).toBe(0);
    const z = liveZoomFor({ zoom: 2, cx: 0.6, cy: 0.5 }, FULL_FRAME, kept);
    expect(z.zoom).toBeCloseTo(3);
    // And back again: the view that shows what the screens show.
    const view = viewForLive(z, FULL_FRAME, kept);
    expect(view.zoom).toBeCloseTo(2);
    expect(view.cx).toBeCloseTo(0.6);
    expect(maxZoomOver(kept)).toBeCloseTo(4 / 1.5);
    expect(maxZoomOver(PLAIN)).toBe(4);
  });

  it('is offered only as far as the screens can follow, the phone zooming on past it (D1/D2 review)', () => {
    const kept = { zoom: 1.5, x: 0, y: 0 };
    // 2 × 1.5 = 3: the screens follow; 3 × 1.5 = 4.5: past their 400 %, so the button is not offered.
    expect(screensFollow({ zoom: 2, cx: 0.5, cy: 0.5 }, kept)).toBe(true);
    expect(screensFollow({ zoom: 3, cx: 0.5, cy: 0.5 }, kept)).toBe(false);
    expect(screensFollow({ zoom: 4, cx: 0.5, cy: 0.5 }, PLAIN)).toBe(true);
    expect(screensFollow({ zoom: 4.01, cx: 0.5, cy: 0.5 }, PLAIN)).toBe(false);
  });

  it('says the screens are zoomed only while their live zoom is away from how the picture is kept', () => {
    const state = withBackground();
    expect(liveFramingOf(state)).toBeNull();
    const zoomed = {
      ...state,
      liveZoom: {
        mediaId: 'm-bg',
        showing: backgroundShowing(7000),
        zoom: 2,
        x: 0.1,
        y: 0,
        from: PLAIN,
        at: 0,
      },
    };
    expect(liveFramingOf(zoomed)).toEqual({ zoom: 2, x: 0.1, y: 0 });
    // Back to Whole: the live zoom at the kept look.
    expect(liveFramingOf({ ...zoomed, liveZoom: { ...zoomed.liveZoom, zoom: 1, x: 0 } })).toBeNull();
    // Another showing's: not this picture's.
    expect(
      liveFramingOf({ ...zoomed, liveZoom: { ...zoomed.liveZoom, showing: backgroundShowing(1) } }),
    ).toBeNull();
    expect(keptFraming(state, 'm-bg')).toEqual({ zoom: 1, x: 0, y: 0 });
  });
});

/*
 * A picture turned or flipped in its slide (a22-zoomturn, after a22-review-x95's follow-up): Turn page right turns a
 * PDF page's picture a quarter turn about its box's middle each time, and the screens zoom and move a picture in its
 * own box, unturned, the box then turned and flipped as the slide places it (render/SlideView.tsx frameStyle,
 * render/picture-looks.tsx Looked). A made-up 480 x 320 page whose picture is the whole page; where a point of the
 * turned page is on the page before its turns is worked out by hand: one turn right puts the page's top left at its
 * top right, so a point (x, y) of the turned page, in its fractions, is (y, 1 - x) of the page before that turn.
 */

/**
 * A PDF page whose picture is the whole 480 x 320 page, turned right `turns` times by Turn page right and kept to
 * `crop` of the turned page by Crop page… (in the turned page's fractions, as the operator crops what they see), up.
 */
function turnedPage(
  turns: number,
  crop?: CropRect,
  picture = { x: 0, y: 0, width: 480, height: 320 },
): EngineState {
  const page: EditSlide = {
    ...newSlide(null),
    id: 'page',
    documentPage: { sha256: 'a'.repeat(64), ext: 'pdf', page: 0, width: 480, height: 320 },
    pageSize: { width: 480, height: 320 },
    elements: [
      {
        id: 'e1',
        kind: 'image',
        mediaId: 'm-page',
        fit: 'fill',
        frame: picture,
      },
    ],
  };
  let doc: EditDoc = {
    presentationId: 'placeholder-pdf',
    name: 'Placeholder PDF',
    width: 1920,
    height: 1080,
    transition: null,
    loop: false,
    groups: [{ id: 'g', name: '', color: null, slides: [page] }],
  };
  for (let turn = 0; turn < turns; turn += 1) doc = turnPdfPageRight(doc, 'page');
  const turned = findSlide(doc, 'page');
  if (!turned?.documentPage) throw new Error('no page');
  const shown = crop ? { ...turned, documentPage: { ...turned.documentPage, crop } } : turned;
  const state = withSlidePicture();
  const layer = state.layers.slide;
  if (!layer) throw new Error('no slide');
  layer.slide = renderEditedSlide(doc, shown);
  return state;
}

/** The slide's picture in its top left quarter (withSlidePicture) turned and flipped as `how` says. */
function placedPicture(how: Pick<MediaElement, 'rotation' | 'flipX' | 'flipY'>): EngineState {
  const state = withSlidePicture();
  const layer = state.layers.slide;
  if (!layer) throw new Error('no slide');
  layer.slide = {
    ...layer.slide,
    elements: layer.slide.elements.map((e) => (e.kind === 'image' ? { ...e, ...how } : e)),
  };
  return state;
}

/** The screens' zoom that brings a point of the picture (fractions of it, as it is before any turn) to the middle. */
const bringing = (zoom: number, at: { x: number; y: number }): Framing => ({
  zoom,
  x: -zoom * (at.x - 0.5),
  y: -zoom * (at.y - 0.5),
});

/**
 * The screens' zoom that draws a point of the picture where another point of it is drawn unzoomed: on a page
 * cropped with Crop page…, the screens show only the crop, so the point comes to where the crop's middle is
 * (a22-review-zoomturn MUST 1; fractions of the picture before any turn, about its box's middle).
 */
const bringingTo = (zoom: number, at: { x: number; y: number }, to: { x: number; y: number }): Framing => ({
  zoom,
  x: to.x - 0.5 - zoom * (at.x - 0.5),
  y: to.y - 0.5 - zoom * (at.y - 0.5),
});

function expectFraming(actual: Framing, expected: Framing, what: string) {
  expect(actual.zoom, `${what}: zoom`).toBeCloseTo(expected.zoom, 9);
  expect(actual.x, `${what}: x`).toBeCloseTo(expected.x, 9);
  expect(actual.y, `${what}: y`).toBeCloseTo(expected.y, 9);
}

function frameOrThrow<T>(frame: T | null): T {
  if (!frame) throw new Error('no frame');
  return frame;
}

/**
 * Two points of the turned page, on the page before its turns: the middle of its top right quarter (turned right
 * once, the page's top left quarter is there), and (0.625, 0.375), the middle of that quarter's bottom left quarter.
 */
const TURNED = [
  { turns: 0, quarter: { x: 0.75, y: 0.25 }, inside: { x: 0.625, y: 0.375 } },
  { turns: 1, quarter: { x: 0.25, y: 0.25 }, inside: { x: 0.375, y: 0.375 } },
  { turns: 2, quarter: { x: 0.25, y: 0.75 }, inside: { x: 0.375, y: 0.625 } },
  { turns: 3, quarter: { x: 0.75, y: 0.75 }, inside: { x: 0.625, y: 0.625 } },
];

/** Crop page… kept to the turned page's top right quarter. */
const QUARTER: CropRect = { x: 0.5, y: 0, w: 0.5, h: 0.5 };

describe('a phone’s zoom on a turned PDF page (Turn page right, a22-zoomturn)', () => {
  it('puts on the screens the part of the turned page the phone looks at, at each quarter turn', () => {
    for (const { turns, quarter } of TURNED) {
      const frame = frameOrThrow(frameInSlide(turnedPage(turns)));
      // Looked through: three times as big over the middle of the turned page's top right quarter.
      const view = { zoom: 3, cx: 0.75, cy: 0.25 };
      expectFraming(liveZoomFor(view, frame, PLAIN), bringing(3, quarter), `${String(turns)} turns`);
      // And the phone opens there on the screens' zoom of that part.
      const back = viewForLive(bringing(3, quarter), frame, PLAIN);
      expect(back.zoom, `${String(turns)} turns: back`).toBeCloseTo(3, 9);
      expect(back.cx, `${String(turns)} turns: back`).toBeCloseTo(0.75, 9);
      expect(back.cy, `${String(turns)} turns: back`).toBeCloseTo(0.25, 9);
    }
  });

  it('does so on a turned page cropped to a part of it (Crop page…), in the middle of the crop', () => {
    for (const { turns, quarter, inside } of TURNED) {
      const frame = frameOrThrow(frameInSlide(turnedPage(turns, QUARTER)));
      // The crop is the turned page's top right quarter: the middle of what the phone shows is that quarter's, and
      // the screens show it, zoomed, where it is: in the middle of the crop.
      expectFraming(
        liveZoomFor({ zoom: 3, cx: 0.5, cy: 0.5 }, frame, PLAIN),
        bringingTo(3, quarter, quarter),
        `${String(turns)} turns, cropped`,
      );
      const back = viewForLive(bringingTo(3, quarter, quarter), frame, PLAIN);
      expect(back.cx, `${String(turns)} turns, cropped: back`).toBeCloseTo(0.5, 9);
      expect(back.cy, `${String(turns)} turns, cropped: back`).toBeCloseTo(0.5, 9);
      // Four times as big over the crop's own bottom left quarter: that point, in the middle of the crop.
      expectFraming(
        liveZoomFor({ zoom: 4, cx: 0.25, cy: 0.75 }, frame, PLAIN),
        bringingTo(4, inside, quarter),
        `${String(turns)} turns, cropped, inside`,
      );
    }
  });

  it('does so in the hall’s picture as the phone draws it: the turned page fitted into the canvas', () => {
    for (const { turns, quarter } of TURNED) {
      // 480 x 320 fitted into 1920 x 1080 at 3.375 (1620 wide, from 150 in); turned, 320 x 480 at 2.25 (720 from 600).
      const cx = turns % 2 === 0 ? (150 + 0.75 * 1620) / 1920 : (600 + 0.75 * 720) / 1920;
      expectFraming(
        liveZoomFor({ zoom: 3, cx, cy: 0.25 }, frameOrThrow(frameInCanvas(turnedPage(turns), CANVAS)), PLAIN),
        bringing(3, quarter),
        `${String(turns)} turns, in the canvas`,
      );
      // Cropped to that quarter: the crop fitted in the canvas, its middle in the canvas's.
      expectFraming(
        liveZoomFor(
          { zoom: 3, cx: 0.5, cy: 0.5 },
          frameOrThrow(frameInCanvas(turnedPage(turns, QUARTER), CANVAS)),
          PLAIN,
        ),
        bringingTo(3, quarter, quarter),
        `${String(turns)} turns, cropped, in the canvas`,
      );
    }
  });

  it('follows a picture flipped in its slide, and one turned and flipped (a deck’s picture)', () => {
    // The picture in the slide's top left quarter (960 x 540), flipped across: the left half of what the phone shows
    // of it is the picture's own right half.
    const view = { zoom: 3, cx: 0.125, cy: 0.25 };
    const across = frameOrThrow(frameInSlide(placedPicture({ flipX: true })));
    expectFraming(liveZoomFor(view, across, PLAIN), bringing(3, { x: 0.75, y: 0.5 }), 'flipped across');
    // Up and down: the lower half shown is its own upper half.
    const upDown = frameOrThrow(frameInSlide(placedPicture({ flipY: true })));
    expectFraming(
      liveZoomFor({ zoom: 3, cx: 0.25, cy: 0.375 }, upDown, PLAIN),
      bringing(3, { x: 0.5, y: 0.25 }),
      'flipped up and down',
    );
    // Turned right and flipped across: 240 below its middle (480, 270) is 240 left of its own middle.
    const both = frameOrThrow(frameInSlide(placedPicture({ rotation: 90, flipX: true })));
    expectFraming(
      liveZoomFor({ zoom: 3, cx: 480 / 1920, cy: 510 / 1080 }, both, PLAIN),
      bringing(3, { x: 0.25, y: 0.5 }),
      'turned and flipped',
    );
  });

  it('opens the phone where the screens are zoomed, as kept and turned, and back to the same zoom', () => {
    const kept = { zoom: 1.5, x: 0.1, y: -0.05 };
    const zoom = { zoom: 3, x: 0.4, y: -0.3 };
    const states = [
      ...TURNED.flatMap(({ turns }) => [turnedPage(turns), turnedPage(turns, QUARTER)]),
      // A deck's picture turned a little, and flipped.
      placedPicture({ rotation: 25, flipY: true }),
    ];
    for (const [i, state] of states.entries())
      for (const frame of [frameOrThrow(frameInSlide(state)), frameOrThrow(frameInCanvas(state, CANVAS))]) {
        const view = viewForLive(zoom, frame, kept);
        expect(view.zoom).toBeCloseTo(2, 9);
        expectFraming(liveZoomFor(view, frame, kept), zoom, `case ${String(i)}`);
      }
  });
});

/*
 * A page cropped with Crop page… (a22-zoomcropfix, after a22-review-zoomturn's MUST 1): its picture keeps the whole
 * page's box, moved by where the crop starts, and the screens show only the crop. So the middle of what they show is
 * the crop's middle, not the box's, and a phone's zoom must bring the point in the phone's own middle there. Checked
 * against how the screens draw a zoomed picture (render/picture-looks.tsx Looked: `translate(x, y) scale(zoom)` about
 * the box's middle, x and y in the box's widths and heights). A made-up 1920 x 1080 page whose picture is all of it.
 */

/** The page cropped to `crop` (fractions of it), up on the screens. */
function croppedPage(crop: CropRect): EngineState {
  const state = withSlidePicture();
  const layer = state.layers.slide;
  if (!layer) throw new Error('no slide');
  const page = {
    ...layer.slide,
    elements: layer.slide.elements.map((e) => ({ ...e, frame: { x: 0, y: 0, width: 1920, height: 1080 } })),
  };
  layer.slide = cropRenderedPage(page, crop);
  return state;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the screens draw a point of the picture (fractions of its box) zoomed so, in the pixels its box is in. */
const drawnAt = (z: Framing, box: Box, point: { x: number; y: number }) => ({
  x: box.x + box.width / 2 + (z.zoom * (point.x - 0.5) + z.x) * box.width,
  y: box.y + box.height / 2 + (z.zoom * (point.y - 0.5) + z.y) * box.height,
});

function expectAt(actual: { x: number; y: number }, expected: { x: number; y: number }, what: string) {
  expect(actual.x, `${what}: across`).toBeCloseTo(expected.x, 6);
  expect(actual.y, `${what}: down`).toBeCloseTo(expected.y, 6);
}

/**
 * Each crop, the page's picture box in the cropped slide's pixels (the whole page, from minus where the crop starts),
 * and a phone's view of the slide with the point of the page in its middle (fractions of the page), worked by hand.
 */
const CROPS: {
  what: string;
  crop: CropRect;
  slide: { width: number; height: number };
  box: Box;
  views: { view: { zoom: number; cx: number; cy: number }; point: { x: number; y: number } }[];
}[] = [
  {
    what: 'top right quarter',
    crop: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    slide: { width: 960, height: 540 },
    box: { x: -960, y: 0, width: 1920, height: 1080 },
    views: [
      // Three times as big over the middle of the crop: the page's (0.75, 0.25).
      { view: { zoom: 3, cx: 0.5, cy: 0.5 }, point: { x: 0.75, y: 0.25 } },
      // Over the middle of the crop's top left quarter: (960 + 240, 135) of the page.
      { view: { zoom: 3, cx: 0.25, cy: 0.25 }, point: { x: 1200 / 1920, y: 135 / 1080 } },
    ],
  },
  {
    what: 'a small top right corner',
    crop: { x: 0.7, y: 0, w: 0.3, h: 0.3 },
    slide: { width: 576, height: 324 },
    box: { x: -1344, y: 0, width: 1920, height: 1080 },
    views: [
      { view: { zoom: 1.5, cx: 0.5, cy: 0.5 }, point: { x: 0.85, y: 0.15 } },
      // Over a point a quarter in from its right and three quarters up: (1344 + 432, 81) of the page.
      { view: { zoom: 3, cx: 0.75, cy: 0.25 }, point: { x: 1776 / 1920, y: 81 / 1080 } },
    ],
  },
  {
    what: 'the left half',
    crop: { x: 0, y: 0, w: 0.5, h: 1 },
    slide: { width: 960, height: 1080 },
    box: { x: 0, y: 0, width: 1920, height: 1080 },
    views: [{ view: { zoom: 2, cx: 0.5, cy: 0.5 }, point: { x: 0.25, y: 0.5 } }],
  },
];

describe('a phone’s zoom on a page cropped with Crop page… (a22-zoomcropfix)', () => {
  it('puts the point in the middle of the phone in the middle of the crop on the screens', () => {
    for (const { what, crop, slide, box, views } of CROPS) {
      const frame = frameInSlide(croppedPage(crop));
      if (!frame) throw new Error('no frame');
      for (const { view, point } of views) {
        const z = liveZoomFor(view, frame, PLAIN);
        expect(z.zoom, what).toBeCloseTo(view.zoom, 9);
        expectAt(
          drawnAt(z, box, point),
          { x: slide.width / 2, y: slide.height / 2 },
          `${what} ${String(view.zoom)}x`,
        );
        // And the phone opens on that zoom of the screens with the same point in its middle.
        const back = viewForLive(z, frame, PLAIN);
        expect(back.zoom, what).toBeCloseTo(view.zoom, 9);
        expectAt({ x: back.cx, y: back.cy }, { x: view.cx, y: view.cy }, `${what} back`);
      }
    }
  });

  it('does so in the hall’s picture as the phone draws it: the crop fitted in the middle of the canvas', () => {
    for (const { what, crop, slide, box, views } of CROPS) {
      const frame = frameInCanvas(croppedPage(crop), CANVAS);
      if (!frame) throw new Error('no frame');
      // The crop fitted into 1920 x 1080: its scale and where it starts in the canvas, and so its page's box there.
      const scale = Math.min(CANVAS.width / slide.width, CANVAS.height / slide.height);
      const left = (CANVAS.width - slide.width * scale) / 2;
      const top = (CANVAS.height - slide.height * scale) / 2;
      const inCanvas = {
        x: left + box.x * scale,
        y: top + box.y * scale,
        width: box.width * scale,
        height: box.height * scale,
      };
      for (const { view, point } of views) {
        // The same point of the page, where the phone draws it in the canvas.
        const at = { zoom: view.zoom, cx: (left + (box.x + point.x * box.width) * scale) / CANVAS.width };
        const cy = (top + (box.y + point.y * box.height) * scale) / CANVAS.height;
        const z = liveZoomFor({ ...at, cy }, frame, PLAIN);
        expectAt(drawnAt(z, inCanvas, point), { x: 960, y: 540 }, `${what} in the canvas`);
      }
    }
  });

  it('adds the phone’s zoom to a cropped page’s kept look, and back to the same zoom', () => {
    const kept = { zoom: 1.5, x: 0.1, y: -0.05 };
    for (const { what, crop } of CROPS) {
      const state = croppedPage(crop);
      for (const frame of [frameInSlide(state), frameInCanvas(state, CANVAS)]) {
        if (!frame) throw new Error('no frame');
        const zoom = { zoom: 3, x: 0.3, y: -0.2 };
        const view = viewForLive(zoom, frame, kept);
        expect(view.zoom, what).toBeCloseTo(2, 9);
        const again = liveZoomFor(view, frame, kept);
        expect(again.x, what).toBeCloseTo(zoom.x, 9);
        expect(again.y, what).toBeCloseTo(zoom.y, 9);
      }
    }
  });
});

/*
 * A turned page's own small picture, the page cropped (a22-review-zoomturn's re-review, MUST 1 on a turned page): an
 * editable PDF page's picture keeps its own frame, and the screens show it whole where it lies inside the crop, so
 * it is zoomed about its own middle. Whether it lies inside is a matter of the picture as drawn, turned: a quarter
 * turn stands its frame on end about its middle. Made up: a 160 x 40 picture from (60, 100) of the 480 x 320 page,
 * turned right once (its middle (140, 120) to (200, 140) of the 320 x 480 page, drawn 40 x 160: 180 to 220 across,
 * 60 to 220 down), the page kept to its top right quarter (160 x 240 from 160, 0). Unturned, its frame would reach
 * past the crop's left edge; drawn, it lies inside it.
 */
describe('a phone’s zoom on a turned page’s own small picture inside the crop (a22-zoomturn, re-review MUST 1)', () => {
  const small = () => turnedPage(1, QUARTER, { x: 60, y: 100, width: 160, height: 40 });
  // The picture's middle, (40, 140) of the crop; and (30, 100) of it, which is (190, 100) of the turned page, which
  // was (100, 130) of the page before its turn: (0.25, 0.75) of the picture.
  const views = [
    { view: { zoom: 3, cx: 40 / 160, cy: 140 / 240 }, point: { x: 0.5, y: 0.5 } },
    { view: { zoom: 3, cx: 30 / 160, cy: 100 / 240 }, point: { x: 0.25, y: 0.75 } },
  ];

  it('zooms it about its own middle, as a picture shown whole', () => {
    const frame = frameOrThrow(frameInSlide(small()));
    for (const { view, point } of views) {
      expectFraming(liveZoomFor(view, frame, PLAIN), bringing(3, point), `at ${JSON.stringify(point)}`);
      const back = viewForLive(bringing(3, point), frame, PLAIN);
      expect(back.cx).toBeCloseTo(view.cx, 9);
      expect(back.cy).toBeCloseTo(view.cy, 9);
    }
  });

  it('does so in the hall’s picture as the phone draws it: the crop fitted into the canvas at 4.5, from 600 in', () => {
    const frame = frameOrThrow(frameInCanvas(small(), CANVAS));
    for (const { view, point } of views) {
      const cx = (600 + view.cx * 160 * 4.5) / 1920;
      expectFraming(
        liveZoomFor({ ...view, cx }, frame, PLAIN),
        bringing(3, point),
        `canvas ${JSON.stringify(point)}`,
      );
    }
  });
});
