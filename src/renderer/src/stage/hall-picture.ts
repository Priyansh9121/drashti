import { useMemo } from 'react';
import type { HallPicture } from '../../../shared/stage-layouts';
import { hallPicture } from '../../../shared/stage-layouts';
import { useScreens } from '../screens/screens-store';

/**
 * The hall's picture in the operator window (Session 50), for the stage layout editor's picture and the
 * stage preview: the first audience group and its screen's canvas, from the screens set up, as the main
 * process tells each stage screen.
 */
export function useHallPicture(): HallPicture | null {
  const groups = useScreens((s) => s.snapshot?.groups);
  return useMemo(() => hallPicture(groups ?? []), [groups]);
}
