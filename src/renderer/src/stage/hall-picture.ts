import { useMemo } from 'react';
import type { ScreenSwitches } from '../../../shared/screen-switches';
import type { ScreensSnapshot } from '../../../shared/screens';
import type { HallGroup, HallPicture } from '../../../shared/stage-layouts';
import { hallPicture } from '../../../shared/stage-layouts';
import { useScreenSwitches } from '../operator/screen-switches-store';
import { useScreens } from '../screens/screens-store';

/*
 * The hall's picture in the operator window (Session 50), for the stage layout editor's picture and the
 * stage preview: the first audience group and its screen's canvas, from the screens set up, as the main
 * process tells each stage screen; said off while Audience is off (Session 51), as the stage screens say it. Not
 * known until the window has the screens (Session 52): the box is black alone then, never said to have no audience
 * group, which it says only once it knows (null).
 */

/** What it is read from: the window's copy of the screens (none before they are known), and of the switches. */
const groupsOf = (s: { snapshot: ScreensSnapshot | null }) => s.snapshot?.groups;
const audienceOf = (s: { switches: ScreenSwitches }) => s.switches.audience;

/** The hall among the window's groups, or undefined before it has them. */
const hallOf = (groups: readonly HallGroup[] | undefined, audience: boolean) =>
  groups === undefined ? undefined : hallPicture(groups, audience);

export function useHallPicture(): HallPicture | null | undefined {
  const groups = useScreens(groupsOf);
  const audience = useScreenSwitches(audienceOf);
  return useMemo(() => hallOf(groups, audience), [groups, audience]);
}

/** The same picture, read once outside React (its unit test). */
export function hallPictureNow(): HallPicture | null | undefined {
  return hallOf(groupsOf(useScreens.getState()), audienceOf(useScreenSwitches.getState()));
}
