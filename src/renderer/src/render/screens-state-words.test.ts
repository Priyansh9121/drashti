import { describe, expect, it } from 'vitest';
import { initialEngineState } from '../../../shared/engine/state';
import type { HallPicture } from '../../../shared/stage-layouts';
import { screensStateNote, screensStateWords } from './StageView';

/*
 * What a stage screen says of the audience screens: a stage layout's box of their state, and the Standard stage
 * screen's line beside NOW. With Audience off they show this computer's desktop, whatever is up (Session 51); with
 * no audience group at all there are none, as the audience picture box says (Session 53).
 */

const nothing = initialEngineState();
const black = { ...nothing, blackout: true };
const wallpaper = { ...nothing, wallpaper: true };
const showing = {
  ...nothing,
  layers: { ...nothing.layers, background: { kind: 'color' as const, color: '#1f6f8b' } },
};

/** The hall as a stage screen is told it (Session 50), and said off with Audience off (Session 51). */
const hall: HallPicture = {
  groupId: 'placeholder-hall',
  canvasWidth: 1920,
  canvasHeight: 1080,
  scaling: 'fit',
};
const off: HallPicture = { ...hall, off: true };

describe('a stage screen’s words for the audience screens', () => {
  it('says they are off while Audience is off, before black-out, the Wallpaper or a picture', () => {
    for (const state of [nothing, black, wallpaper, showing]) {
      expect(screensStateWords(state, off)).toBe('Audience screens off');
      expect(screensStateNote(state, true)).toBe(' · AUDIENCE SCREENS OFF');
    }
  });

  it('keeps its words while they are on', () => {
    expect(screensStateWords(black, hall)).toBe('Audience screens black');
    expect(screensStateWords(wallpaper, hall)).toBe('Wallpaper on the audience screens');
    expect(screensStateWords(showing, hall)).toBe('Audience screens showing');
    expect(screensStateWords(nothing, hall)).toBe('Nothing on the audience screens');
    expect(screensStateNote(black, false)).toBe(' · AUDIENCE SCREENS BLACK');
    expect(screensStateNote(wallpaper, false)).toBe(' · WALLPAPER ON THE AUDIENCE SCREENS');
    expect(screensStateNote(showing, false)).toBe('');
    expect(screensStateNote(nothing, false)).toBe('');
  });

  // Session 53 (question 5): with no audience group at all the box said "Audience screens showing", of screens
  // there are none of, while the audience picture box beside it said "No audience screens".
  it('says there are none with no audience group at all, whatever is up, as the audience picture box does', () => {
    for (const state of [nothing, black, wallpaper, showing])
      expect(screensStateWords(state, null)).toBe('No audience screens');
  });

  // Session 55, Part 6: the chosen wallpaper shows whenever nothing is up.
  it('says the wallpaper is on them while nothing is up and one is chosen', () => {
    const chosen = {
      ...nothing,
      chosenWallpaper: {
        id: 'w1',
        name: 'Placeholder wall',
        pictures: ['p1'],
        secondsEach: 10,
        fadeMs: 1500,
        since: 0,
      },
    };
    expect(screensStateWords(chosen, hall)).toBe('Wallpaper on the audience screens');
    expect(screensStateWords({ ...chosen, layers: showing.layers }, hall)).toBe('Audience screens showing');
    // A wallpaper with no picture left in the library: black, so nothing is said to be on them.
    expect(
      screensStateWords({ ...chosen, chosenWallpaper: { ...chosen.chosenWallpaper, pictures: [] } }, hall),
    ).toBe('Nothing on the audience screens');
  });

  it('says what is up until it is told the hall, never that there are none', () => {
    expect(screensStateWords(showing, undefined)).toBe('Audience screens showing');
    expect(screensStateWords(black, undefined)).toBe('Audience screens black');
    expect(screensStateWords(nothing, undefined)).toBe('Nothing on the audience screens');
  });
});
