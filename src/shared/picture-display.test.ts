import { describe, expect, it } from 'vitest';
import { PLAIN } from './picture-look';
import { displayPictureSize, picturesWithLocalDisplayCopies } from './picture-display';
import { displayMediaId } from './media';

const big = { width: 6144, height: 3456 };
const hd = { width: 1920, height: 1080 };

describe('pictures sized for their displays', () => {
  it('uses only the stream-sized pixels of a large picture, even with no hall', () => {
    expect(displayPictureSize(big, [])).toEqual(hd);
    expect(displayPictureSize(big, [hd])).toEqual(hd);
  });

  it('uses physical Retina pixels and retains a real display larger than 4K', () => {
    const fourK = { width: 3840, height: 2160 };
    expect(displayPictureSize(big, [hd, fourK])).toEqual(fourK);
    const eightK = { width: 7680, height: 4320 };
    expect(displayPictureSize({ width: 12288, height: 6912 }, [eightK])).toEqual(eightK);
  });

  it('does not copy or upscale pictures already no larger than demanded', () => {
    expect(displayPictureSize(hd, [hd])).toBeNull();
    expect(displayPictureSize({ width: 1280, height: 720 }, [hd])).toBeNull();
  });

  it('keeps aspect and the pixels a portrait needs to cover its box', () => {
    const portrait = { width: 6000, height: 8000 };
    expect(displayPictureSize(portrait, [hd], null, 'contain')).toEqual({ width: 810, height: 1080 });
    expect(displayPictureSize(portrait, [hd], null, 'cover')).toEqual({ width: 1920, height: 2560 });
  });

  it('takes every differently shaped target into account, not only the largest area', () => {
    expect(displayPictureSize({ width: 6000, height: 8000 }, [hd, { width: 2160, height: 3840 }])).toEqual({
      width: 2880,
      height: 3840,
    });
  });

  it('retains the source density a saved zoom needs', () => {
    expect(displayPictureSize(big, [hd], { ...PLAIN, zoom: 2 })).toEqual({ width: 3840, height: 2160 });
  });

  it('retains the density a cropped part needs, keeping the original aspect', () => {
    expect(
      displayPictureSize(big, [hd], {
        ...PLAIN,
        size: big,
        crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      }),
    ).toEqual({ width: 3840, height: 2160 });
  });

  it('accounts for a quarter turn before fitting the visible part', () => {
    expect(displayPictureSize({ width: 6000, height: 8000 }, [hd], { ...PLAIN, turn: 90 })).toEqual({
      width: 1440,
      height: 1920,
    });
  });

  it('never guesses from invalid geometry', () => {
    expect(displayPictureSize({ width: 0, height: 20 }, [hd])).toBeNull();
    expect(displayPictureSize({ width: Number.NaN, height: 20 }, [hd])).toBeNull();
  });
});

it('keeps an older node picture on its existing original until the derived file exists locally', () => {
  const copy = { key: `p1-${'ab'.repeat(16)}-1920x1080`, width: 1920, height: 1080 };
  const pictures = { old: { ...PLAIN, display: copy } };
  const before = picturesWithLocalDisplayCopies(pictures, (id) => id === 'old');
  expect(before['old']?.display).toBeUndefined();
  expect(pictures.old.display).toEqual(copy);
  const landed = picturesWithLocalDisplayCopies(
    pictures,
    (id) => id === 'old' || id === displayMediaId('old', copy.key),
  );
  expect(landed).toBe(pictures);
  expect(landed['old']?.display).toEqual(copy);
});

it('keeps the small display source for a new node item when neither file has arrived', () => {
  const pictures = {
    fresh: { ...PLAIN, display: { key: `p1-${'cd'.repeat(16)}-1920x1080`, width: 1920, height: 1080 } },
  };
  expect(picturesWithLocalDisplayCopies(pictures, () => false)).toBe(pictures);
});
