import { describe, expect, it } from 'vitest';
import {
  inLastSeconds,
  nextWallpaperChange,
  refusedWords,
  wallpaperFrame,
  wallpaperNameOf,
  WHEN_ENDS,
  WHEN_ENDS_NAMES,
} from './wallpapers';

/*
 * Wallpapers (Session 55, Part 6): where one that goes round is at a moment (the same on every screen, from the
 * engine's clock), a wallpaper's name from its file, what the window says of files that are not pictures, and a
 * video's last 10 seconds. Placeholder names only.
 */

const SET = { pictures: ['a', 'b', 'c'], secondsEach: 10, fadeMs: 2000, since: 1_000_000 };

describe('a wallpaper that goes round', () => {
  it('shows each picture for its seconds, fading into the next over its last part, then round again', () => {
    expect(wallpaperFrame(SET, SET.since)).toEqual({ index: 0, next: 1, fade: 0 });
    expect(wallpaperFrame(SET, SET.since + 7_999)).toEqual({ index: 0, next: 1, fade: 0 });
    expect(wallpaperFrame(SET, SET.since + 9_000)).toEqual({ index: 0, next: 1, fade: 0.5 });
    expect(wallpaperFrame(SET, SET.since + 10_000)).toEqual({ index: 1, next: 2, fade: 0 });
    // The last into the first.
    expect(wallpaperFrame(SET, SET.since + 29_500)).toEqual({ index: 2, next: 0, fade: 0.75 });
    expect(wallpaperFrame(SET, SET.since + 30_000)).toEqual({ index: 0, next: 1, fade: 0 });
    // Before it was chosen (a page's clock a moment behind): its first picture.
    expect(wallpaperFrame(SET, SET.since - 500)).toEqual({ index: 0, next: 1, fade: 0 });
  });

  it('a fade longer than half a picture’s time is held to half; no fade cuts; one picture never changes', () => {
    expect(wallpaperFrame({ ...SET, secondsEach: 3, fadeMs: 5000 }, SET.since + 2_250)).toEqual({
      index: 0,
      next: 1,
      fade: 0.5,
    });
    expect(wallpaperFrame({ ...SET, fadeMs: 0 }, SET.since + 9_999)).toEqual({ index: 0, next: 1, fade: 0 });
    expect(wallpaperFrame({ ...SET, pictures: ['only'] }, SET.since + 123_456)).toEqual({
      index: 0,
      next: 0,
      fade: 0,
    });
    expect(wallpaperFrame({ ...SET, pictures: [] }, SET.since)).toBeNull();
  });

  it('knows when it next changes: its fade’s start, then the next picture’s', () => {
    expect(nextWallpaperChange(SET, SET.since + 1_000)).toBe(SET.since + 8_000);
    expect(nextWallpaperChange(SET, SET.since + 8_500)).toBe(SET.since + 10_000);
    expect(nextWallpaperChange({ ...SET, pictures: ['only'] }, SET.since)).toBeNull();
  });
});

describe('a wallpaper’s name, and files that are not pictures', () => {
  it('is its file’s name without the folder and its last extension', () => {
    expect(wallpaperNameOf('/Users/placeholder/Pictures/Placeholder darshan.jpg')).toBe(
      'Placeholder darshan',
    );
    expect(wallpaperNameOf('C:\\Pictures\\Placeholder sunrise.jpg.png')).toBe('Placeholder sunrise.jpg');
    expect(wallpaperNameOf('.hidden')).toBe('.hidden');
    expect(wallpaperNameOf('Placeholder')).toBe('Placeholder');
  });

  it('says why each file refused was not added, and that wallpapers are pictures only', () => {
    expect(refusedWords([])).toBeNull();
    expect(refusedWords([{ name: 'Placeholder bhajan.wav', why: 'is a sound' }])).toBe(
      '“Placeholder bhajan.wav” is a sound, so it was not added. Wallpapers are pictures only.',
    );
    expect(
      refusedWords([
        { name: 'Placeholder bhajan.wav', why: 'is a sound' },
        { name: 'Placeholder notes.txt', why: 'is not a picture' },
      ]),
    ).toBe(
      '2 files were not added: “Placeholder bhajan.wav” is a sound and “Placeholder notes.txt” is not a picture. Wallpapers are pictures only.',
    );
    expect(
      refusedWords([
        { name: 'a.mp4', why: 'is a video' },
        { name: 'b.pdf', why: 'is a PDF' },
        { name: 'Folder', why: 'is a folder' },
      ]),
    ).toBe(
      '3 files were not added: “a.mp4” is a video, “b.pdf” is a PDF, and “Folder” is a folder. Wallpapers are pictures only.',
    );
  });
});

describe('when a video ends, and its last seconds', () => {
  it('offers Wallpaper (the default first), Next item, Loop and Freeze', () => {
    expect(WHEN_ENDS.map((w) => WHEN_ENDS_NAMES[w])).toEqual(['Wallpaper', 'Next item', 'Loop', 'Freeze']);
  });

  it('is in its last 10 seconds from 10 s left until it ends', () => {
    expect(inLastSeconds(10_001)).toBe(false);
    expect(inLastSeconds(10_000)).toBe(true);
    expect(inLastSeconds(1)).toBe(true);
    expect(inLastSeconds(0)).toBe(false);
    expect(inLastSeconds(null)).toBe(false);
  });
});
