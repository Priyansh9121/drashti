import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState } from '../../../../shared/engine/state';
import { backgroundShowing, PLAIN, slideShowing } from '../../../../shared/picture-look';
import {
  frameInCanvas,
  frameInSlide,
  frameOfBackground,
  FULL_FRAME,
  keptFraming,
  liveFramingOf,
  liveZoomFor,
  maxZoomOver,
  phoneZoomTarget,
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
