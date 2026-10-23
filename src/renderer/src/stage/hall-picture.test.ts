import { afterEach, describe, expect, it } from 'vitest';
import type { ScreensSnapshot } from '../../../shared/screens';
import { useScreenSwitches } from '../operator/screen-switches-store';
import { useScreens } from '../screens/screens-store';
import { hallPictureNow } from './hall-picture';

/*
 * The hall's picture in the operator window (Session 50), for the Stage screen panel's preview and the stage layout
 * editor's picture: as the main process tells each stage screen, from the window's own copies of the screens and
 * of Audience and Stage, and said off while Audience is off (Session 51). Placeholder screens only.
 */

const snapshot: ScreensSnapshot = {
  displays: [],
  nodes: [],
  status: [],
  groups: [
    { id: 'stage', name: 'Placeholder stage', role: 'stage', screens: [] },
    {
      id: 'hall',
      name: 'Placeholder hall',
      role: 'audience',
      screens: [
        {
          id: 'hall-1',
          groupId: 'hall',
          name: 'Placeholder hall screen',
          displayKey: null,
          canvasWidth: 1280,
          canvasHeight: 720,
          scaling: 'fill',
          enabled: true,
          feed: null,
          nodeId: null,
        },
      ],
    },
  ],
};
const hall = { groupId: 'hall', canvasWidth: 1280, canvasHeight: 720, scaling: 'fill' };

afterEach(() => {
  useScreens.setState({ snapshot: null });
  useScreenSwitches.setState({ switches: { audience: true, stage: true } });
});

describe('the hall’s picture in the operator window', () => {
  it('is the first audience group shown on this computer, at its screen’s canvas; none before the screens', () => {
    expect(hallPictureNow()).toBeNull();
    useScreens.setState({ snapshot });
    expect(hallPictureNow()).toEqual(hall);
  });

  it('is said off while Audience is off, as the stage screens are told it (Session 51)', () => {
    useScreens.setState({ snapshot });
    useScreenSwitches.setState({ switches: { audience: false, stage: true } });
    expect(hallPictureNow()).toEqual({ ...hall, off: true });
    // Stage off is not the hall's.
    useScreenSwitches.setState({ switches: { audience: true, stage: false } });
    expect(hallPictureNow()).toEqual(hall);
  });
});
