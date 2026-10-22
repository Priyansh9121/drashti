import { useMemo } from 'react';
import type { HallPicture } from '../../../shared/stage-layouts';
import { hallPicture } from '../../../shared/stage-layouts';
import { useScreenSwitches } from '../operator/screen-switches-store';
import { useScreens } from '../screens/screens-store';

/**
 * The hall's picture in the operator window (Session 50), for the stage layout editor's picture and the
 * stage preview: the first audience group and its screen's canvas, from the screens set up, as the main
 * process tells each stage screen; said off while Audience is off (Session 51), as the stage screens say it.
 */
export function useHallPicture(): HallPicture | null {
  const groups = useScreens((s) => s.snapshot?.groups);
  const audience = useScreenSwitches((s) => s.switches.audience);
  return useMemo(() => hallPicture(groups ?? [], audience), [groups, audience]);
}
