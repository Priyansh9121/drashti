import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EngineState, PipLayer, SlideLayer } from '../../../shared/engine/state';
import { initialEngineState } from '../../../shared/engine/state';
import { DEFAULT_PIP_PLACE } from '../../../shared/pip';
import { Scene } from './Scene';

/*
 * The wallpaper behind the picture-in-picture box (QA24-WALLBLACK-2, the owner's answer A, alpha.24): with nothing else
 * up, an unswapped box sits over the chosen wallpaper, as the screens show with nothing up at all, so putting the box
 * up or taking it off changes nothing behind it (before, the screens went black behind it). A swapped box is as before
 * (its own picture fills the screen), and so are the slides in the box (none drawn with no slide up; with a slide up,
 * it counts as something up). Rendered without a page: nothing loads, only what each draws is read.
 */

const SLIDE: SlideLayer = {
  presentationId: 'p',
  slideIndex: 0,
  shownAt: 1,
  notes: '',
  slide: { id: 's', width: 1920, height: 1080, background: null, elements: [] },
};

const box = (over: Partial<PipLayer> = {}): PipLayer => ({
  source: { kind: 'media', mediaId: 'boxed', media: 'image' },
  place: DEFAULT_PIP_PLACE,
  swapped: false,
  shownAt: 1,
  ...over,
});

function state(layers: Partial<EngineState['layers']>, wallpaper = true): EngineState {
  const s = initialEngineState();
  return {
    ...s,
    layers: { ...s.layers, ...layers },
    chosenWallpaper: wallpaper
      ? {
          id: 'w',
          name: 'Placeholder wallpaper',
          pictures: ['paper'],
          secondsEach: 10,
          fadeMs: 1000,
          since: 1,
        }
      : null,
  };
}

/** What the hall's screen draws: whether the box is up, and what shows with nothing up (none when something is). */
function drawn(s: EngineState) {
  const html = renderToStaticMarkup(
    createElement(Scene, { state: s, canvas: { width: 1920, height: 1080 }, scaling: 'fit' }),
  );
  const scene = /<div[^>]*data-testid="scene"[^>]*>/u.exec(html)?.[0] ?? '';
  return {
    pip: /data-pip="([^"]*)"/u.exec(scene)?.[1] ?? null,
    nothingUp: /data-nothing-up="([^"]*)"/u.exec(scene)?.[1] ?? null,
    wallpaperPicture: html.includes('data-testid="wallpaper-picture"'),
  };
}

describe('the wallpaper behind the picture-in-picture box (the owner’s QA24-WALLBLACK-2 A)', () => {
  it('nothing up, no box: the chosen wallpaper, as before', () => {
    expect(drawn(state({}))).toEqual({ pip: 'none', nothingUp: 'wallpaper', wallpaperPicture: true });
  });

  it('a box over nothing else: the chosen wallpaper behind it, not black', () => {
    expect(drawn(state({ pip: box() }))).toEqual({
      pip: 'up',
      nothingUp: 'wallpaper',
      wallpaperPicture: true,
    });
    // With none chosen, the screen's black, as with nothing up at all.
    expect(drawn(state({ pip: box() }, false))).toMatchObject({ pip: 'up', nothingUp: 'black' });
  });

  it('a swapped box: its own picture fills the screen, nothing-up not drawn over it, as before', () => {
    expect(drawn(state({ pip: box({ swapped: true }) }))).toEqual({
      pip: 'swapped',
      nothingUp: null,
      wallpaperPicture: false,
    });
  });

  it('the slides in the box: none drawn with no slide up (the wallpaper); with a slide up, something is up, as before', () => {
    const slides = box({ source: { kind: 'slides' } });
    expect(drawn(state({ pip: slides }))).toMatchObject({ pip: 'none', nothingUp: 'wallpaper' });
    expect(drawn(state({ pip: slides, slide: SLIDE }))).toMatchObject({ pip: 'up', nothingUp: null });
  });

  it('a background or a slide under the box: something is up, as before', () => {
    expect(drawn(state({ pip: box(), background: { kind: 'color', color: '#123456' } }))).toMatchObject({
      pip: 'up',
      nothingUp: null,
    });
    expect(drawn(state({ pip: box(), slide: SLIDE }))).toMatchObject({ pip: 'up', nothingUp: null });
  });
});
