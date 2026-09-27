import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/fonts.css';
import '../styles/app.css';
import { connectEngine, useEngine } from '../engine/engine-store';
import { preloadFonts } from '../render/fonts';
import { PlacedInParent } from '../render/Placed';
import { Scene } from '../render/Scene';
import { connectOutput, useOutput } from './output-store';

function IdentifyOverlay() {
  const identify = useOutput((s) => s.identify);
  useEffect(() => {
    if (!identify) return;
    const t = setTimeout(
      () => {
        useOutput.setState({ identify: null });
      },
      Math.max(0, identify.until - Date.now()),
    );
    return () => {
      clearTimeout(t);
    };
  }, [identify]);
  if (!identify) return null;
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 border-[1.5vmin] border-accent bg-black/80">
      <div className="text-[10vmin] font-bold text-white" data-testid="identify-name">
        {identify.name}
      </div>
      <div className="text-[5vmin] text-muted">{identify.groupName}</div>
    </div>
  );
}

/**
 * Record, on the output root, the last engine revision that reached a painted
 * frame and how long after the main process sent it (same machine clock).
 * Tests read these to check that outputs update within a frame.
 */
function usePaintTiming(root: React.RefObject<HTMLDivElement | null>) {
  const rev = useEngine((s) => s.rev);
  const sentAt = useEngine((s) => s.sentAt);
  useLayoutEffect(() => {
    if (rev < 0) return;
    const frame = requestAnimationFrame(() => {
      const el = root.current;
      if (!el) return;
      el.dataset['paintedRev'] = String(rev);
      el.dataset['latencyMs'] = String(Math.max(0, Date.now() - sentAt));
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [rev, sentAt, root]);
}

function Output() {
  const context = useOutput((s) => s.context);
  const state = useEngine((s) => s.state);
  const [fontsReady, setFontsReady] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  usePaintTiming(rootRef);
  useEffect(() => {
    connectOutput();
    // Fonts first, so the first live slide never shows a fallback font.
    void preloadFonts().then(() => {
      setFontsReady(true);
      connectEngine();
    });
  }, []);
  const canvas = { width: context?.canvasWidth ?? 1920, height: context?.canvasHeight ?? 1080 };
  const scaling = context?.scaling ?? 'fit';
  return (
    <div
      ref={rootRef}
      className="relative h-full w-full bg-black"
      data-testid="output-root"
      data-screen={context?.screenId ?? ''}
      data-fonts={fontsReady ? 'ready' : 'loading'}
    >
      {state && fontsReady && (
        <PlacedInParent content={canvas} mode={scaling} className="absolute inset-0">
          <Scene state={state} canvas={canvas} scaling={scaling} />
        </PlacedInParent>
      )}
      <IdentifyOverlay />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <Output />
  </StrictMode>,
);
