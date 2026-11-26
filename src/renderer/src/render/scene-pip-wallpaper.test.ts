import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { EngineState, PipLayer, SlideLayer } from '../../../shared/engine/state';
import { initialEngineState } from '../../../shared/engine/state';
import { DEFAULT_PIP_PLACE } from '../../../shared/pip';
import { wallpaperMissingLive } from '../../../shared/wallpaper-missing';
import { holdClock } from './clock';
import { pipLength } from './pip';
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

/** The element that starts at `from` (a `<div`) up to its end, in a page's markup. */
function elementAt(html: string, from: number): string {
  const tags = /<div\b|<\/div>/gu;
  tags.lastIndex = from;
  let depth = 0;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(from, tags.lastIndex);
  }
  return html.slice(from);
}

/**
 * Where the screen draws what shows with nothing up (the wallpaper): in the main picture's background place (lead 2's
 * option A for QA24-WALLBLACK-2) or a place of its own; whether that place is seen, and how it dissolves now (in a swap).
 */
function nothingUpPlace(s: EngineState) {
  const html = renderToStaticMarkup(
    createElement(Scene, { state: s, canvas: { width: 1920, height: 1080 }, scaling: 'fit' }),
  );
  const slot = /<div data-pip-main="background"[^>]*>/u.exec(html);
  const inSlot = slot ? elementAt(html, slot.index) : '';
  const tag = slot?.[0] ?? '';
  if (!html.includes('data-testid="wallpaper-picture"')) return null;
  if (!inSlot.includes('data-testid="wallpaper-picture"'))
    return { place: 'own', seen: true, dissolve: null };
  return {
    place: 'background',
    seen: !tag.includes('data-pip-ready'),
    dissolve: /data-pip-dissolve="([^"]*)"/u.exec(tag)?.[1] ?? null,
  };
}

/** How the box's own picture's place on the main picture dissolves now (null: not dissolving, or not there). */
function sourceDissolve(s: EngineState): string | null {
  const html = renderToStaticMarkup(
    createElement(Scene, { state: s, canvas: { width: 1920, height: 1080 }, scaling: 'fit' }),
  );
  const tag = /<div data-pip-main="source"[^>]*>/u.exec(html)?.[0] ?? '';
  return /data-pip-dissolve="([^"]*)"/u.exec(tag)?.[1] ?? null;
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

  it('a swapped box: its own picture fills the screen, nothing-up not drawn over it, as before; the wallpaper kept unseen in the background’s place', () => {
    // Since lead 2's option A (QA24-WALLBLACK-2): drawn, but in the background's place, which a swapped box's main
    // picture keeps unseen (render/pip.ts keptBackground), never over the box's own picture.
    expect(drawn(state({ pip: box({ swapped: true }) }))).toEqual({
      pip: 'swapped',
      nothingUp: null,
      wallpaperPicture: true,
    });
    expect(nothingUpPlace(state({ pip: box({ swapped: true }) }))).toEqual({
      place: 'background',
      seen: false,
      dissolve: null,
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

describe('LIVE’s missing-wallpaper line and the screens agree (QA24-WALLBLACK-1 and -2)', () => {
  it('says the screens show black exactly while the hall’s Scene shows its nothing-up black', () => {
    // The chosen wallpaper's one picture missing: the operator window's view names it, and the engine's state
    // leaves it out (main/wallpapers/wallpaper-service.ts), so the screens show black with nothing up.
    const view = { pictures: [{ mediaId: 'paper', name: 'Placeholder wallpaper.png', missing: true }] };
    const boxes = [
      null,
      box(),
      box({ swapped: true }),
      box({ source: { kind: 'slides' } }),
      box({ source: { kind: 'slides' }, swapped: true }),
    ];
    for (const pip of boxes)
      for (const background of [null, { kind: 'color', color: '#123456' } as const])
        for (const slide of [null, SLIDE]) {
          const s = state({ pip, background, slide });
          const missing = {
            ...s,
            chosenWallpaper: s.chosenWallpaper && { ...s.chosenWallpaper, pictures: [] },
          };
          const label = `${pip ? `${pip.source.kind} in the box${pip.swapped ? ', swapped' : ''}` : 'no box'}, ${background ? 'a colour' : 'no background'}, ${slide ? 'a slide' : 'no slide'}`;
          expect(wallpaperMissingLive(missing, view) !== null, label).toBe(
            drawn(missing).nothingUp === 'black',
          );
        }
  });
});

describe('the wallpaper in the background’s place, so a Swap dissolves it (QA24-WALLBLACK-2, lead 2’s option A)', () => {
  afterEach(() => {
    holdClock(null);
  });

  it('with nothing else up, it is drawn in the main picture’s background place, seen: with no box, and under one', () => {
    expect(nothingUpPlace(state({}))).toEqual({ place: 'background', seen: true, dissolve: null });
    expect(nothingUpPlace(state({ pip: box() }))).toEqual({
      place: 'background',
      seen: true,
      dissolve: null,
    });
  });

  it('a Swap: whole through the box’s going out, then dissolving out as the box’s own picture dissolves in over it', () => {
    const at = 1_000_000;
    const length = pipLength('swap', DEFAULT_PIP_PLACE.motion, 'calm');
    const swapping = state({
      pip: box({ swapped: true, changed: { at, place: DEFAULT_PIP_PLACE, swapped: false } }),
    });
    holdClock(at + length * 0.25);
    // Swap pressed: the engine's swapped, so nothing-up is not said (its meaning kept), but still seen whole.
    expect(drawn(swapping)).toMatchObject({ pip: 'swapped', nothingUp: null, wallpaperPicture: true });
    expect(nothingUpPlace(swapping)).toEqual({ place: 'background', seen: true, dissolve: null });
    holdClock(at + length * 0.75);
    expect(nothingUpPlace(swapping)).toEqual({ place: 'background', seen: true, dissolve: 'out' });
    expect(sourceDissolve(swapping)).toBe('in');
    holdClock(at + length + 1);
    expect(nothingUpPlace(swapping)).toEqual({ place: 'background', seen: false, dissolve: null });
  });

  it('a Swap back: dissolving in as the box’s own picture dissolves out over it, then whole', () => {
    const at = 1_000_000;
    const length = pipLength('swap', DEFAULT_PIP_PLACE.motion, 'calm');
    const back = state({
      pip: box({ swapped: false, changed: { at, place: DEFAULT_PIP_PLACE, swapped: true } }),
    });
    holdClock(at + length * 0.25);
    expect(drawn(back)).toMatchObject({ pip: 'up', nothingUp: 'wallpaper', wallpaperPicture: true });
    expect(nothingUpPlace(back)).toEqual({ place: 'background', seen: true, dissolve: 'in' });
    expect(sourceDissolve(back)).toBe('out');
    holdClock(at + length * 0.75);
    expect(nothingUpPlace(back)).toEqual({ place: 'background', seen: true, dissolve: null });
    holdClock(at + length + 1);
    expect(nothingUpPlace(back)).toEqual({ place: 'background', seen: true, dissolve: null });
  });

  it('something on the main picture: no nothing-up there, with a box or swapped', () => {
    expect(nothingUpPlace(state({ pip: box(), slide: SLIDE }))).toBeNull();
    expect(nothingUpPlace(state({ pip: box({ swapped: true }), slide: SLIDE }))).toBeNull();
    expect(nothingUpPlace(state({ pip: box(), background: { kind: 'color', color: '#123456' } }))).toBeNull();
  });
});
