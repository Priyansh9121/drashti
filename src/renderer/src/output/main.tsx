import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/fonts.css';
import '../styles/app.css';
import { groupLookIn } from '../../../shared/looks';
import { connectEngine, useEngine } from '../engine/engine-store';
import { preloadFonts } from '../render/fonts';
import { PlacedInParent } from '../render/Placed';
import { Scene } from '../render/Scene';
import { StageView } from '../render/StageView';
import { connectOutput, useOutput } from './output-store';
import { Preloader } from './Preloader';
import { DisplayNumber, TestCard } from './SetupCards';

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
      const paintedAt = Date.now();
      el.dataset['paintedRev'] = String(rev);
      el.dataset['latencyMs'] = String(Math.max(0, paintedAt - sentAt));
      // A short history, so a test can match every command to the frame that showed it.
      const log = (window.drashtiPaintLog ??= []);
      log.push({ rev, sentAt, paintedAt });
      if (log.length > 20_000) log.splice(0, log.length - 20_000);
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
  const stage = context?.role === 'stage';
  const scaling = context?.scaling ?? 'fit';
  // What this screen shows: its group's settings in the live Look.
  const look = groupLookIn(state?.look, context?.groupId);
  return (
    <div
      ref={rootRef}
      className="relative h-full w-full bg-black"
      data-testid="output-root"
      data-screen={context?.screenId ?? ''}
      data-role={context?.role ?? 'audience'}
      data-languages={look.languages?.join(',') ?? 'all'}
      data-slides={look.slides}
      data-fonts={fontsReady ? 'ready' : 'loading'}
    >
      {state && fontsReady && (
        <PlacedInParent content={canvas} mode={scaling} className="absolute inset-0">
          {stage ? (
            <StageView state={state} languages={look.languages} />
          ) : (
            <Scene state={state} canvas={canvas} scaling={scaling} look={look} />
          )}
        </PlacedInParent>
      )}
      {/* Stage screens show no pictures, so they load none ahead. */}
      {state && !stage && <Preloader next={state.next} />}
      {context && fontsReady && <TestCard context={context} languages={look.languages} />}
      <IdentifyOverlay />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
// The setup wizard's Identify: only a display's number across it, for a few seconds (no show).
const identify = new URLSearchParams(location.search).get('identify');
createRoot(root).render(
  <StrictMode>
    {identify ? (
      <DisplayNumber number={identify} label={new URLSearchParams(location.search).get('label') ?? ''} />
    ) : (
      <Output />
    )}
  </StrictMode>,
);
