import { createContext, useContext } from 'react';
import { create } from 'zustand';
import type { SimpleFeature } from '../../../shared/simple-features';
import { useMode } from '../operator/mode-store';

/*
 * Simple Mode Features in the window (alpha.22, shared/simple-features.ts): which of Pro Mode's tools Simple Mode has,
 * as the main process says (read once, then told as it changes), and whether Edit › Simple Mode Features…'s window is
 * open. Simple Mode shows each chosen tool's section (simple/SimpleFeatureSections.tsx) inside OperateOnly, where each
 * section leaves out what sets it up: that stays Pro Mode's, as Simple Mode's lock in the main process keeps it.
 */

export const useSimpleFeatures = create<{ chosen: readonly SimpleFeature[]; open: boolean }>(() => ({
  chosen: [],
  open: false,
}));

let connected = false;

/** Read the tools once and follow their changes, and open the window when the menu asks (once per window). */
export function connectSimpleFeatures(): void {
  if (connected) return;
  connected = true;
  // A change told before the first read is answered is newer than that answer.
  let told = false;
  window.drashti.app.onSimpleFeaturesChanged((chosen) => {
    told = true;
    useSimpleFeatures.setState({ chosen });
  });
  window.drashti.app.onShowSimpleFeatures(() => {
    useSimpleFeatures.setState({ open: true });
  });
  // Its window is Pro Mode's: gone as Simple Mode comes, never back by itself after.
  window.drashti.app.onModeChanged((mode) => {
    if (mode === 'simple') useSimpleFeatures.setState({ open: false });
  });
  void window.drashti.app.simpleFeatures().then(
    (chosen) => {
      if (!told) useSimpleFeatures.setState({ chosen });
    },
    () => undefined,
  );
}

export function closeSimpleFeatures(): void {
  useSimpleFeatures.setState({ open: false });
}

/**
 * Inside Simple Mode's sections of Pro Mode's tools: true. A section reads it (useOperateOnly) and leaves out what sets
 * its tool up (making, changing, deleting, pinning, choosing a layout), keeping what runs the show.
 */
export const OperateOnly = createContext(false);

export const useOperateOnly = (): boolean => useContext(OperateOnly);

/** Whether a tool's Pro Mode parts are this mode's: in Pro Mode, or in Simple Mode while the tool is chosen. */
export function useToolHere(feature: SimpleFeature): boolean {
  const pro = useMode((s) => s.mode !== 'simple');
  const chosen = useSimpleFeatures((s) => s.chosen.includes(feature));
  return pro || chosen;
}

/** The same, as it is now, outside a component (a chat popup's click). */
export function toolHereNow(feature: SimpleFeature): boolean {
  return useMode.getState().mode !== 'simple' || useSimpleFeatures.getState().chosen.includes(feature);
}
