import { create } from 'zustand';
import type { NotOnScreen } from '../../../shared/not-on-screens';

/**
 * The videos still up that one of this computer's screens could not play (alpha.23, a22-halldrop;
 * shared/not-on-screens.ts), as Main keeps them: LIVE names each under its picture while its showing stays up.
 */
export const useNotOnScreens = create<{ list: readonly NotOnScreen[] }>(() => ({ list: [] }));

let connected = false;

/** Hear Main's list as it changes, and read it once (said before this window opened). */
export function connectNotOnScreens(): void {
  if (connected) return;
  connected = true;
  let told = false;
  window.drashti.media.onNotOnScreens((list) => {
    told = true;
    useNotOnScreens.setState({ list });
  });
  void window.drashti.media
    .notOnScreens()
    .then((list) => {
      if (!told) useNotOnScreens.setState({ list });
    })
    .catch(() => undefined);
}
