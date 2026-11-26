import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState, type PipLayer, type SlideLayer } from './engine/state';
import { DEFAULT_PIP_PLACE } from './pip';
import { wallpaperMissing, wallpaperMissingLive } from './wallpaper-missing';

const picture = (mediaId: string, missing: boolean, name = `Placeholder ${mediaId}.png`) => ({
  mediaId,
  name,
  missing,
});

describe('a wallpaper whose pictures are missing, in words (QA24-WALLBLACK-1)', () => {
  it('says nothing while all its pictures are there', () => {
    expect(wallpaperMissing({ pictures: [picture('a', false), picture('b', false)] })).toBeNull();
  });

  it('its one picture missing: the tile, the panel with Find… for it, and LIVE, the screens black', () => {
    expect(wallpaperMissing({ pictures: [picture('a', true)] })).toEqual({
      kind: 'all',
      count: 1,
      label: 'its picture is missing',
      tile: 'Picture missing',
      notice:
        'The wallpaper’s picture is missing: “Placeholder a.png”. With nothing up, the screens show black.',
      live: 'Wallpaper’s picture missing: “Placeholder a.png”. With nothing up, the screens show black.',
      find: ['a'],
    });
  });

  it('all of several missing: each looked for once', () => {
    expect(
      wallpaperMissing({ pictures: [picture('a', true), picture('b', true), picture('a', true)] }),
    ).toMatchObject({
      kind: 'all',
      count: 3,
      tile: 'Pictures missing',
      notice: 'The wallpaper’s 3 pictures are missing. With nothing up, the screens show black.',
      live: 'Wallpaper’s pictures missing. With nothing up, the screens show black.',
      find: ['a', 'b'],
    });
  });

  it('some missing: the others go round, LIVE says nothing', () => {
    expect(wallpaperMissing({ pictures: [picture('a', false), picture('b', true)] })).toMatchObject({
      kind: 'some',
      count: 1,
      label: '1 of them missing',
      notice:
        'One of the wallpaper’s pictures is missing: “Placeholder b.png”. The others go round on the screens.',
      live: null,
      find: ['b'],
    });
    expect(
      wallpaperMissing({ pictures: [picture('a', false), picture('b', true), picture('c', true)] }),
    ).toMatchObject({
      notice: '2 of the wallpaper’s pictures are missing. The others go round on the screens.',
      find: ['b', 'c'],
    });
  });

  it('a picture whose row is gone (no name): said, with nothing for Find… to look for', () => {
    expect(wallpaperMissing({ pictures: [picture('a', true, '')] })).toMatchObject({
      notice: 'The wallpaper’s picture is missing. With nothing up, the screens show black.',
      find: [],
    });
  });

  it('no pictures at all: said, no Find…', () => {
    expect(wallpaperMissing({ pictures: [] })).toMatchObject({
      kind: 'none',
      tile: 'No picture',
      notice:
        'The wallpaper has no picture. With nothing up, the screens show black. Drop a picture on it, or choose another.',
      find: [],
    });
  });
});

/** A state with these layers up (and the Wallpaper on or off). */
function show(layers: Partial<EngineState['layers']>, wallpaper = false): EngineState {
  const s = initialEngineState();
  return { ...s, layers: { ...s.layers, ...layers }, wallpaper };
}

const box = (over: Partial<PipLayer> = {}): PipLayer => ({
  source: { kind: 'media', mediaId: 'boxed', media: 'image' },
  place: DEFAULT_PIP_PLACE,
  swapped: false,
  shownAt: 1,
  ...over,
});

const SLIDE: SlideLayer = {
  presentationId: 'p',
  slideIndex: 0,
  shownAt: 1,
  notes: '',
  slide: { id: 's', width: 1920, height: 1080, background: null, elements: [] },
};

describe('LIVE’s line while the screens show black for a missing wallpaper (QA24-WALLBLACK-1, -2)', () => {
  const gone = { pictures: [picture('a', true)] };
  const LINE = 'Wallpaper’s picture missing: “Placeholder a.png”. With nothing up, the screens show black.';

  it('nothing up, or under the Wallpaper: said', () => {
    expect(wallpaperMissingLive(show({}), gone)).toBe(LINE);
    expect(wallpaperMissingLive(show({ slide: SLIDE }, true), gone)).toBe(LINE);
  });

  it('a box up, not swapped, over nothing else: said, as the screens show black behind it (the owner’s A)', () => {
    expect(wallpaperMissingLive(show({ pip: box() }), gone)).toBe(LINE);
  });

  it('a box of the slides with no slide up draws nothing, swapped or not: said', () => {
    expect(wallpaperMissingLive(show({ pip: box({ source: { kind: 'slides' } }) }), gone)).toBe(LINE);
    expect(
      wallpaperMissingLive(show({ pip: box({ source: { kind: 'slides' }, swapped: true }) }), gone),
    ).toBe(LINE);
  });

  it('a swapped box fills the screen with its own picture: not said', () => {
    expect(wallpaperMissingLive(show({ pip: box({ swapped: true }) }), gone)).toBeNull();
  });

  it('something else up, with or without a box: not said', () => {
    expect(wallpaperMissingLive(show({ slide: SLIDE }), gone)).toBeNull();
    expect(wallpaperMissingLive(show({ pip: box(), slide: SLIDE }), gone)).toBeNull();
    expect(
      wallpaperMissingLive(show({ pip: box(), background: { kind: 'color', color: '#123456' } }), gone),
    ).toBeNull();
  });

  it('none chosen, or its pictures there: not said', () => {
    expect(wallpaperMissingLive(show({ pip: box() }), null)).toBeNull();
    expect(wallpaperMissingLive(show({ pip: box() }), { pictures: [picture('a', false)] })).toBeNull();
  });
});
