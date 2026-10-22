import type { LiveGroupLook, LiveLook } from '../../../shared/looks';
import { groupLookIn } from '../../../shared/looks';
import type { Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import type { HallPicture } from '../../../shared/stage-layouts';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../../shared/stage-layouts';

/*
 * What a stage layout's audience picture box draws (Session 50, render/AudienceBox.tsx): the hall's group
 * as the live Look sets it, at that group's screen's canvas and scaling, found the way the group's own
 * output finds its own (groupLookIn, as output/main.tsx does), so the box can never show the hall
 * differently from the hall's screens.
 */

/**
 * The box's picture: 16:9, scaled into the box with black around it. The hall's canvas is placed in it as
 * on a 16:9 screen.
 */
export const PICTURE: Size = { width: 1920, height: 1080 };

export interface HallView {
  /** The hall's group, or null when none is known. */
  groupId: string | null;
  /** Its settings in the live Look: its layers, languages, slide style, mask, idle rotation and movement. */
  look: LiveGroupLook;
  canvas: Size;
  scaling: ScalingMode;
}

/**
 * The hall's picture as the box draws it. With no hall known (no audience group yet), or a group the live
 * Look does not list, every layer and language, as a group no Look lists draws, at 1920 x 1080 fitted.
 */
export function hallView(look: LiveLook, hall: HallPicture | null | undefined): HallView {
  if (!hall)
    return {
      groupId: null,
      look: groupLookIn(look, null),
      canvas: { width: STAGE_WIDTH, height: STAGE_HEIGHT },
      scaling: 'fit',
    };
  return {
    groupId: hall.groupId,
    look: groupLookIn(look, hall.groupId),
    canvas: { width: hall.canvasWidth, height: hall.canvasHeight },
    scaling: hall.scaling,
  };
}
