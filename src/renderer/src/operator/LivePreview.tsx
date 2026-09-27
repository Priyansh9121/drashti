import { useEffect } from 'react';
import { useEngine } from '../engine/engine-store';
import { preloadFonts } from '../render/fonts';
import { PlacedInParent } from '../render/Placed';
import { Scene } from '../render/Scene';
import { useScreens } from '../screens/screens-store';

/**
 * What the audience sees, drawn by the same Scene component the outputs use,
 * on the canvas of the first screen (1920 x 1080 when none is set up).
 */
export function LivePreview() {
  const state = useEngine((s) => s.state);
  const first = useScreens((s) => s.snapshot?.groups.flatMap((g) => g.screens)[0]);
  useEffect(() => {
    void preloadFonts();
  }, []);
  const canvas = { width: first?.canvasWidth ?? 1920, height: first?.canvasHeight ?? 1080 };
  const scaling = first?.scaling ?? 'fit';
  return (
    <div className="rounded-lg border border-line bg-black" data-testid="live-preview">
      <PlacedInParent content={canvas} mode="fit" className="relative aspect-video w-full">
        {state && <Scene state={state} canvas={canvas} scaling={scaling} />}
      </PlacedInParent>
    </div>
  );
}
