import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState } from '../../../shared/engine/state';
import type { MediaElement, Rect } from '../../../shared/model';
import { cropRenderedPage } from '../../../shared/pdf-page-crop';
import type { CropRect } from '../../../shared/picture-look';
import { placeContent } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import { renderEditedSlide } from '../../../shared/slide-design';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { findSlide, newSlide } from '../editor/ops';
import { turnPdfPageRight } from '../editor/pdf-page-ops';
import { draggedTo } from './live-drag';

/*
 * LIVE's drag and two fingers' move (Session 26e; Session 55, Part 5) move the picture on the screens with the
 * pointer, whatever its turn (Turn page right), its crop (Crop page…, or a crop of its own) or its size on its slide
 * (a22-review-zoomturn: on a page turned right, dragging right moved the picture down on the screens, and on a
 * cropped page it moved faster than the pointer). Made-up ids; the first screen's canvas 1920 x 1080, drawn
 * 480 x 270 in LIVE: a pointer's pixel there is 4 of the canvas.
 */

const CANVAS = { width: 1920, height: 1080 };
const LIVE = { width: 480, height: 270 };
const FROM = { zoom: 2, x: 0.05, y: -0.05 };
const DRAGS = [
  { x: 24, y: 0 },
  { x: 0, y: -12 },
  { x: -18, y: 9 },
];

/** A slide up on the screens with these elements (its own picture first), `width` x `height`. */
function slideUp(elements: MediaElement[], width = 1920, height = 1080): EngineState {
  const state = initialEngineState();
  return {
    ...state,
    layers: {
      ...state.layers,
      slide: {
        presentationId: 'p1',
        slideIndex: 0,
        shownAt: 5000,
        notes: '',
        slide: { id: 's1', width, height, background: null, elements },
      },
    },
  };
}

const picture = (frame: Rect, how: Partial<MediaElement> = {}): MediaElement => ({
  id: 'e1',
  kind: 'image',
  mediaId: 'm-picture',
  fit: 'fill',
  frame,
  ...how,
});

/** A PDF page whose picture is the whole 480 x 320 page, turned right `turns` times, kept to `crop` (Crop page…). */
function turnedPage(turns: number, crop?: CropRect): EngineState {
  const page: EditSlide = {
    ...newSlide(null),
    id: 'page',
    documentPage: { sha256: 'a'.repeat(64), ext: 'pdf', page: 0, width: 480, height: 320 },
    pageSize: { width: 480, height: 320 },
    elements: [picture({ x: 0, y: 0, width: 480, height: 320 })],
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
  const state = slideUp([]);
  const layer = state.layers.slide;
  if (!layer) throw new Error('no slide');
  layer.slide = renderEditedSlide(doc, shown);
  return state;
}

/** A 1920 x 1080 page shown as its picture, cropped with Crop page…. */
function croppedPage(crop: CropRect): EngineState {
  const state = slideUp([picture({ x: 0, y: 0, width: 1920, height: 1080 })]);
  const layer = state.layers.slide;
  if (!layer) throw new Error('no slide');
  layer.slide = cropRenderedPage(layer.slide, crop);
  return state;
}

/**
 * How far the screens draw the picture moved, in the canvas's pixels, for a move of the zoom (in its box's own
 * widths and heights): the box the screens zoom in (its frame, or for a crop of its own the whole picture it is cut
 * from: render/SlideView.tsx SlidePicture) moves the zoomed picture so (render/picture-looks.tsx frameTransform), is
 * flipped then turned about its middle (SlideView.tsx frameStyle: `rotate(r) scale(fx, fy)`), and its slide is
 * placed in the canvas by the scaling. Worked here on its own, not by live-zoom.ts.
 */
function drawnMove(state: EngineState, move: { x: number; y: number }, scaling: ScalingMode) {
  const slide = state.layers.slide?.slide;
  const el = slide?.elements.find((e) => e.kind === 'image');
  if (!slide || el?.kind !== 'image') return { x: move.x * CANVAS.width, y: move.y * CANVAS.height };
  let x = move.x * (el.frame.width / (el.crop?.width ?? 1));
  let y = move.y * (el.frame.height / (el.crop?.height ?? 1));
  if (el.flipX) x = -x;
  if (el.flipY) y = -y;
  const r = ((el.rotation ?? 0) * Math.PI) / 180;
  const p = placeContent({ width: slide.width, height: slide.height }, CANVAS, scaling);
  return {
    x: (x * Math.cos(r) - y * Math.sin(r)) * p.scaleX,
    y: (x * Math.sin(r) + y * Math.cos(r)) * p.scaleY,
  };
}

/** The picture on the screens goes where the pointer went: its move, in the canvas's pixels, within a millionth. */
function expectFollows(state: EngineState, what: string, scaling: ScalingMode = 'fit') {
  for (const drag of DRAGS) {
    const to = draggedTo(state, FROM, drag, LIVE, CANVAS, scaling);
    expect(to.zoom, `${what}: the zoom`).toBe(FROM.zoom);
    const moved = drawnMove(state, { x: to.x - FROM.x, y: to.y - FROM.y }, scaling);
    const want = { x: (drag.x * CANVAS.width) / LIVE.width, y: (drag.y * CANVAS.height) / LIVE.height };
    expect(moved.x, `${what}, dragged ${JSON.stringify(drag)}: across`).toBeCloseTo(want.x, 6);
    expect(moved.y, `${what}, dragged ${JSON.stringify(drag)}: down`).toBeCloseTo(want.y, 6);
  }
}

describe('LIVE’s drag moves the picture on the screens with the pointer', () => {
  it('for the background picture, and a picture over the whole slide, as before', () => {
    const state = initialEngineState();
    const background: EngineState = {
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
    const whole = slideUp([picture({ x: 0, y: 0, width: 1920, height: 1080 })]);
    for (const [what, s] of [
      ['the background picture', background],
      ['a picture over the whole slide', whole],
    ] as const) {
      expectFollows(s, what);
      const to = draggedTo(s, FROM, { x: 24, y: 12 }, LIVE, CANVAS, 'fit');
      expect(to.x, what).toBeCloseTo(FROM.x + 24 / 480, 12);
      expect(to.y, what).toBeCloseTo(FROM.y + 12 / 270, 12);
    }
  });

  it('on a PDF page turned right once, twice or three times (Turn page right), cropped or not', () => {
    for (const turns of [1, 2, 3]) {
      expectFollows(turnedPage(turns), `${String(turns)} turns`);
      expectFollows(turnedPage(turns, { x: 0.5, y: 0, w: 0.5, h: 0.5 }), `${String(turns)} turns, cropped`);
    }
  });

  it('on a page cropped with Crop page…: as fast as the pointer, not faster', () => {
    expectFollows(croppedPage({ x: 0.25, y: 0.1, w: 0.4, h: 0.5 }), 'cropped');
    expectFollows(croppedPage({ x: 0, y: 0, w: 0.6, h: 1 }), 'kept to its left 0.6');
  });

  it('for a picture smaller than its slide, flipped, turned, or with a crop of its own', () => {
    const small = { x: 100, y: 100, width: 400, height: 300 };
    expectFollows(slideUp([picture(small)]), 'a small picture');
    expectFollows(slideUp([picture(small, { flipX: true })]), 'flipped across');
    expectFollows(slideUp([picture(small, { flipY: true, rotation: 90 })]), 'turned 90 and flipped up');
    expectFollows(slideUp([picture(small, { rotation: 25 })]), 'turned 25');
    const own = { x: 0.4, y: 0.1, width: 0.5, height: 0.5 };
    expectFollows(slideUp([picture(small, { crop: own })]), 'its own crop');
    expectFollows(slideUp([picture(small, { crop: own, rotation: 270, flipX: true })]), 'its own crop, turned');
  });

  it('on a slide of another shape, and on a screen that fills or stretches its slides', () => {
    expectFollows(slideUp([picture({ x: 0, y: 0, width: 1440, height: 1080 })], 1440, 1080), 'a 4:3 slide');
    for (const scaling of ['fill', 'stretch'] as const) {
      expectFollows(turnedPage(1), `turned, ${scaling}`, scaling);
      expectFollows(slideUp([picture({ x: 0, y: 0, width: 1440, height: 1080 })], 1440, 1080), scaling, scaling);
    }
  });
});
