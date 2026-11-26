import { describe, expect, it } from 'vitest';
import { wallpaperMissing } from './wallpaper-missing';

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
      live: 'Wallpaper’s picture missing: “Placeholder a.png”. The screens show black when the wallpaper is up.',
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
      live: 'Wallpaper’s pictures missing. The screens show black when the wallpaper is up.',
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
  it('explains an unconverted HEIC picture without calling it missing or offering Find', () => {
    const heic = { ...picture('photo', false, 'Placeholder.heic'), unplayable: 'HEIC photo' };
    expect(wallpaperMissing({ pictures: [heic] })).toEqual({
      kind: 'all',
      count: 1,
      label: 'its picture needs conversion',
      tile: 'Convert picture',
      notice:
        'The wallpaper’s picture needs conversion: “Placeholder.heic”. Convert it in Media. With nothing up, the screens show black.',
      live: 'The wallpaper’s picture needs conversion: “Placeholder.heic”. The screens show black when the wallpaper is up.',
      find: [],
    });
  });

  it('warns about a HEIC turn while another picture can still show', () => {
    const heic = { ...picture('photo', false, 'Placeholder.heic'), unplayable: 'HEIC photo' };
    expect(wallpaperMissing({ pictures: [heic, picture('ready', false)] })).toMatchObject({
      kind: 'some',
      count: 1,
      live: null,
      find: [],
      notice:
        'One of the wallpaper’s pictures needs conversion: “Placeholder.heic”. Convert it in Media. Pictures needing conversion show black on their turns.',
    });
  });

  it('keeps Find for genuinely missing pictures when another needs conversion', () => {
    const heic = { ...picture('photo', false, 'Placeholder.heic'), unplayable: 'HEIC photo' };
    expect(wallpaperMissing({ pictures: [heic, picture('gone', true)] })).toMatchObject({
      kind: 'all',
      count: 2,
      tile: 'Check pictures',
      find: ['gone'],
      notice:
        'One of the wallpaper’s pictures needs conversion: “Placeholder.heic”. Convert it in Media. 1 picture is missing. With nothing up, the screens show black.',
    });
  });
  it('names several pictures needing conversion without claiming they are missing', () => {
    const a = { ...picture('a', false), unplayable: 'HEIC photo' };
    const b = { ...picture('b', false), unplayable: 'HEIC photo' };
    expect(wallpaperMissing({ pictures: [a, b] })).toMatchObject({
      kind: 'all',
      count: 2,
      tile: 'Convert pictures',
      find: [],
      notice:
        '2 of the wallpaper’s pictures need conversion. Convert them in Media. With nothing up, the screens show black.',
      live: '2 of the wallpaper’s pictures need conversion. The screens show black when the wallpaper is up.',
    });
  });
});
