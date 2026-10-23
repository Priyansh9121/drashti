import type { LiveGroupLook, LiveLook } from '../../../shared/looks';
import { groupLookIn } from '../../../shared/looks';
import type { Size } from '../../../shared/scaling';
import { SWITCH_NAMES } from '../../../shared/screen-switches';
import type { ScalingMode } from '../../../shared/screens';
import type { HallPicture } from '../../../shared/stage-layouts';

/*
 * What a stage layout's audience picture box draws (Session 50, render/AudienceBox.tsx): the hall's group
 * as the live Look sets it, at that group's screen's canvas and scaling, found the way the group's own
 * output finds its own (groupLookIn, as output/main.tsx does), so the box can never show the hall
 * differently from the hall's screens. With Audience off (Session 51) it keeps that picture, the one the hall
 * comes back to, and says the hall's screens are off in its bottom left corner (Session 52: in the top left, a
 * stage message along the top covered it), so the performers are not misled. With no audience group at all
 * (Session 52) there is no hall's picture to draw: the box is black and says so in one short line, where it drew
 * every layer, a picture no hall's screen shows.
 */

/** What the box says in a corner while Audience is off: the words the status bar and a phone say. */
export const AUDIENCE_OFF = `${SWITCH_NAMES.audience} off`;

/** What the box says with no audience group at all (Session 52), in the stage's words for the hall's screens. */
export const NO_AUDIENCE = 'No audience screens';

/**
 * The box's picture: 16:9, scaled into the box with black around it. The hall's canvas is placed in it as
 * on a 16:9 screen.
 */
export const PICTURE: Size = { width: 1920, height: 1080 };

/**
 * Where the box says Audience off, and what it cannot draw, on its picture (Session 52): its bottom left corner,
 * 40 px in each way, below a stage message along the top.
 */
export const WORDS_CORNER = { left: 40, bottom: 40 } as const;

/** Audience off's size on the picture (64 px), which the line with no audience group matches. */
const WORDS_SIZE = 64;
/** The stage's smallest words (a box's label, 30 px): the line is never drawn smaller while the box holds it. */
const LINE_MIN = 30;
/** As small as a layout's box fitting its words goes (StageLayoutView's FIT_MIN): a box smaller still cuts it. */
const LINE_FLOOR = 8;

export type HallView =
  | {
      kind: 'hall';
      /** The hall's group. */
      groupId: string;
      /** Its settings in the live Look: its layers, languages, slide style, mask, idle rotation and movement. */
      look: LiveGroupLook;
      canvas: Size;
      scaling: ScalingMode;
      /** The hall's screens are off (Audience off, Session 51): the picture stays, said off in a corner. */
      off: boolean;
    }
  /** No audience group at all (Session 52): black, and one short line saying so. */
  | { kind: 'none' }
  /**
   * The hall not told yet (a tablet's stage page before Drashti answers, the operator window before it has the
   * screens): black alone, never said to have none.
   */
  | { kind: 'unknown' };

/**
 * The hall's picture as the box draws it, from the hall as this page is told it: null with no audience group at
 * all, undefined until it is told. A group the live Look does not list draws every layer and language, as its
 * own screens do (groupLookIn).
 */
export function hallView(look: LiveLook, hall: HallPicture | null | undefined): HallView {
  if (hall === undefined) return { kind: 'unknown' };
  if (hall === null) return { kind: 'none' };
  return {
    kind: 'hall',
    groupId: hall.groupId,
    look: groupLookIn(look, hall.groupId),
    canvas: { width: hall.canvasWidth, height: hall.canvasHeight },
    scaling: hall.scaling,
    off: hall.off === true,
  };
}

/**
 * The line with no audience group (Session 52) in a box of this size (stage canvas pixels), before the box fits it
 * (fittedSize): as large and as far in from the corner as Audience off would be there, on the picture scaled into
 * the box, but never below the stage's smallest words, so it still reads in a small box.
 */
export function noAudienceLine(box: Size): { size: number; inset: number } {
  const scale = Math.min(box.width / PICTURE.width, box.height / PICTURE.height);
  return { size: Math.max(LINE_MIN, WORDS_SIZE * scale), inset: WORDS_CORNER.left * scale };
}

/**
 * The line's size in its box (Session 52): the size wanted (to the whole pixel) when the line fits there, measured
 * on the page (`fits`), else the largest that fits, found by halving as a layout's boxes fit their words, and never
 * below 8 px: a box too small for words even then cuts them.
 */
export function fittedSize(wanted: number, fits: (px: number) => boolean): number {
  const top = Math.floor(wanted);
  if (fits(top)) return top;
  let lo = LINE_FLOOR;
  let hi = top;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo);
}
