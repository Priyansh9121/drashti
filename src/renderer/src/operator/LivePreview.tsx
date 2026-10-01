import { useEffect } from 'react';
import { useEngine } from '../engine/engine-store';
import { preloadFonts } from '../render/fonts';
import { PlacedInParent } from '../render/Placed';
import { Scene } from '../render/Scene';
import { useScreens } from '../screens/screens-store';
import { Badge, LiveBadge } from '../ui/Badge';
import { cx } from '../ui/cx';

/**
 * What the audience sees, drawn by the same Scene component the outputs use,
 * on the canvas of the first screen (1920 x 1080 when none is set up). The
 * picture is for the eyes; the header and the window's title say it in words.
 */
export function LivePreview() {
  const state = useEngine((s) => s.state);
  const first = useScreens((s) => s.snapshot?.groups.flatMap((g) => g.screens)[0]);
  useEffect(() => {
    void preloadFonts();
  }, []);
  const canvas = { width: first?.canvasWidth ?? 1920, height: first?.canvasHeight ?? 1080 };
  const scaling = first?.scaling ?? 'fit';
  const blackout = state?.blackout ?? false;
  const somethingUp = state
    ? state.layers.slide !== null || state.layers.background !== null || state.layers.props.length > 0
    : false;
  return (
    <section aria-labelledby="live-preview-title" className="space-y-2 px-3 pt-3">
      <div className="flex h-6 items-center gap-2">
        <h2 id="live-preview-title" className="flex-1 text-2xs font-bold tracking-wider text-muted uppercase">
          On the screens now
        </h2>
        {blackout ? <Badge tone="live">Black-out</Badge> : somethingUp ? <LiveBadge /> : null}
      </div>
      <div
        className={cx(
          'overflow-hidden rounded-lg border-2 bg-black',
          somethingUp && !blackout ? 'border-live' : 'border-line-strong',
        )}
        data-testid="live-preview"
        data-a11y-picture
        aria-hidden="true"
      >
        <PlacedInParent content={canvas} mode="fit" className="relative aspect-video w-full">
          {state && <Scene state={state} canvas={canvas} scaling={scaling} annotate />}
        </PlacedInParent>
      </div>
    </section>
  );
}
