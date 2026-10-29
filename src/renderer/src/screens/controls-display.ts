import { useEffect } from 'react';
import { create } from 'zustand';
import { describeDisplay } from '../../../shared/display-match';
import type { DisplayInfo } from '../../../shared/screens';
import { useScreens } from './screens-store';

/*
 * The display the controls are on (Session 50: Screens and Set Up Screens… mark it where they offer displays;
 * Session 55: never taken by itself), read as Screens opens and again as displays come and go.
 */

const useControls = create<{ controls: number | null }>(() => ({ controls: null }));

export function useControlsDisplay(): number | null {
  const snapshot = useScreens((s) => s.snapshot);
  const controls = useControls((s) => s.controls);
  const displays = snapshot?.displays.map((d) => String(d.id)).join(' ') ?? '';
  useEffect(() => {
    void window.drashti.setup.state().then((state) => {
      useControls.setState({ controls: state.controlsDisplayId });
    });
  }, [displays]);
  return controls;
}

/** A display's name, as the window says it: its own name, or its description when it has none. */
export const displayName = (d: DisplayInfo): string => d.label.trim() || describeDisplay(d);
