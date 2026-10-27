import { describe, expect, it } from 'vitest';
import type { LiveLook } from '../../../shared/looks';
import { DEFAULT_LIVE_GROUP_LOOK, NO_LOOK } from '../../../shared/looks';
import {
  AUDIENCE_OFF,
  audienceOffSize,
  fittedSize,
  hallView,
  inStep,
  NO_AUDIENCE,
  noAudienceLine,
  PICTURE,
  unseenSize,
  WORDS_CORNER,
} from './audience-picture';

/*
 * What a stage layout's audience picture box draws (Session 50): the hall's group, as its own screens do; with
 * Audience off, the same picture, said off (Session 51) in its bottom left corner (Session 52), never below the
 * stage's smallest words while it fits (Session 53), nor are the muted lines under it naming what a node or a tablet
 * cannot draw (Session 54); with no audience group at all, black and one short line saying so, never every layer
 * (Session 52).
 */

const look: LiveLook = {
  id: 'placeholder-look',
  name: 'Placeholder Look',
  groups: {
    hall: { ...DEFAULT_LIVE_GROUP_LOOK, layers: ['background', 'slide', 'ticker'], languages: ['gu', 'en'] },
    side: { ...DEFAULT_LIVE_GROUP_LOOK, languages: ['hi'] },
    stage: { ...DEFAULT_LIVE_GROUP_LOOK, languages: ['en'], movement: 'bold' },
  },
};

describe('the audience picture box', () => {
  it('draws the hall group’s settings in the live Look, at its screen’s canvas and scaling', () => {
    const hall = { groupId: 'hall', canvasWidth: 1280, canvasHeight: 720, scaling: 'fill' as const };
    const view = hallView(look, hall);
    expect(view).toEqual({
      kind: 'hall',
      groupId: 'hall',
      look: look.groups['hall'],
      canvas: { width: 1280, height: 720 },
      scaling: 'fill',
      off: false,
    });
    // The same object the hall's own output draws with (groupLookIn), never a copy that could differ.
    expect(view.kind === 'hall' ? view.look : null).toBe(look.groups['hall']);
  });

  it('draws every layer and language for a group the live Look does not list, as that group’s screens do', () => {
    expect(
      hallView(NO_LOOK, { groupId: 'hall', canvasWidth: 1920, canvasHeight: 1080, scaling: 'fit' }),
    ).toEqual({
      kind: 'hall',
      groupId: 'hall',
      look: DEFAULT_LIVE_GROUP_LOOK,
      canvas: { width: 1920, height: 1080 },
      scaling: 'fit',
      off: false,
    });
  });

  // Session 52 (question 4): with no audience group it drew every layer, a picture no hall's screen shows.
  it('with no audience group at all draws nothing of the show, and says so in one short plain line', () => {
    expect(hallView(look, null)).toEqual({ kind: 'none' });
    expect(hallView(NO_LOOK, null)).toEqual({ kind: 'none' });
    expect(NO_AUDIENCE).toBe('No audience screens');
  });

  it('is black alone, saying nothing, until it is told the hall', () => {
    expect(hallView(look, undefined)).toEqual({ kind: 'unknown' });
  });

  // Session 51 (S4-3): the hall's screens closed by Audience off; the box keeps the picture, and says so.
  it('keeps the hall’s picture with Audience off, said off in words', () => {
    const hall = { groupId: 'hall', canvasWidth: 1280, canvasHeight: 720, scaling: 'fill' as const };
    const off = hallView(look, { ...hall, off: true });
    expect(off).toEqual({ ...hallView(look, hall), off: true });
    expect(off.kind === 'hall' ? off.look : null).toBe(look.groups['hall']);
    const on = hallView(look, { ...hall, off: false });
    expect(on.kind === 'hall' && on.off).toBe(false);
    expect(AUDIENCE_OFF).toBe('Audience off');
  });

  // Session 52 (question 4): in the top left corner, a stage message along the top covered it.
  it('says it in the picture’s bottom left corner, 40 px in each way', () => {
    expect(WORDS_CORNER).toEqual({ left: 40, bottom: 40 });
  });

  it('wants its line as large as Audience off is in the box, never below the stage’s smallest words', () => {
    // The whole stage, and a new box's size (half each way): Audience off's size and inset there.
    expect(noAudienceLine({ width: 1920, height: 1080 })).toEqual({ size: 64, inset: 40 });
    expect(noAudienceLine({ width: 960, height: 540 })).toEqual({ size: 32, inset: 20 });
    // A small box and a strip: the size of a box's label (30 px), where Audience off would be 16 px.
    expect(noAudienceLine({ width: 480, height: 270 })).toEqual({ size: 30, inset: 10 });
    expect(noAudienceLine({ width: 1920, height: 270 })).toEqual({ size: 30, inset: 10 });
    // The smallest box a layout allows (8 x 8): wanted at 30 too, and brought down to fit (fittedSize).
    expect(noAudienceLine({ width: 8, height: 8 }).size).toBe(30);
  });

  // Session 53 (question 5): drawn on the picture at 64 px, Audience off was a sixth of that (10.7 px) in a box a
  // sixth of the stage each way, where the line with no audience group keeps to 30 px.
  it('wants Audience off as large as on the whole stage’s picture, never below the stage’s smallest words', () => {
    // The whole stage, and a new box's size (half each way): 64 px on the picture, as built.
    expect(audienceOffSize({ width: 1920, height: 1080 })).toEqual({ size: 64, scale: 1 });
    expect(audienceOffSize({ width: 960, height: 540 })).toEqual({ size: 32, scale: 0.5 });
    // The layout editor's smallest box (a sixth of the stage each way), and a strip: 30 px on the stage.
    expect(audienceOffSize({ width: 320, height: 180 })).toEqual({ size: 30, scale: 1 / 6 });
    expect(audienceOffSize({ width: 1920, height: 270 })).toEqual({ size: 30, scale: 0.25 });
    // Wanted as the line with no audience group is, in every box: then fitted as it is (fittedSize).
    for (const box of [
      { width: 1920, height: 1080 },
      { width: 1000, height: 600 },
      { width: 320, height: 180 },
      { width: 96, height: 54 },
      { width: 8, height: 8 },
    ])
      expect(audienceOffSize(box).size).toBe(noAudienceLine(box).size);
  });

  // Session 54 (Session 53's question 4): drawn on the picture at 40 px, a node's or a tablet's line naming a video
  // input or a window was a sixth of that (6.7 px) in a box a sixth of the stage each way.
  it('wants the muted lines naming what a page cannot draw as large as on the whole stage’s picture, never below the stage’s smallest words', () => {
    // The whole stage: 40 px on the picture, as built; half each way: 30 px, where on the picture it was 20.
    expect(unseenSize({ width: 1920, height: 1080 })).toBe(40);
    expect(unseenSize({ width: 960, height: 540 })).toBe(30);
    // The layout editor's smallest box, a strip and a box saved smaller: 30 px on the stage, then fitted.
    expect(unseenSize({ width: 320, height: 180 })).toBe(30);
    expect(unseenSize({ width: 1920, height: 270 })).toBe(30);
    expect(unseenSize({ width: 96, height: 54 })).toBe(30);
    // Between: as on the picture, scaled with it.
    expect(unseenSize({ width: 1600, height: 900 })).toBeCloseTo(33.33, 2);
  });

  it('keeps the muted lines at their size while Audience off fits as wanted, and brings them down with it when it must', () => {
    // Audience off as wanted (to the whole pixel): the lines as wanted, never a fraction under 30 px with it.
    expect(inStep(64, 64, 40)).toBe(40);
    expect(inStep(33, 33.33, 30)).toBe(30);
    expect(inStep(30, 30, 30)).toBe(30);
    // Audience off brought down to fit a box saved smaller: the lines come down in step with it.
    expect(inStep(16, 32, 30)).toBe(15);
    expect(inStep(10, 30, 30)).toBe(10);
  });

  it('brings the line down only as far as it must to fit the box, never below 8 px', () => {
    // Fits as wanted: tried there first, and never made smaller.
    const tried: number[] = [];
    expect(
      fittedSize(64, (px) => {
        tried.push(px);
        return true;
      }),
    ).toBe(64);
    expect(tried).toEqual([64]);
    // A small box: the largest whole size that fits.
    expect(fittedSize(30, (px) => px <= 21.7)).toBe(21);
    expect(fittedSize(30, (px) => px <= 29.99)).toBe(29);
    // Wanted between whole sizes: a whole size, no larger.
    expect(fittedSize(33.6, () => true)).toBe(33);
    // A box too small for any words: 8 px, as a layout's box fitting its words goes no smaller; the box cuts it.
    expect(fittedSize(30, () => false)).toBe(8);
  });

  it('is a 16:9 picture', () => {
    expect(PICTURE.width * 9).toBe(PICTURE.height * 16);
  });
});
