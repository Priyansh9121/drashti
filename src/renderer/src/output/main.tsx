import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/fonts.css';
import '../styles/app.css';
import { groupLookIn } from '../../../shared/looks';
import { connectEngine, useEngine } from '../engine/engine-store';
import { engineNow } from '../render/clock';
import { preloadFonts } from '../render/fonts';
import { PlacedInParent } from '../render/Placed';
import { SceneBoundary } from '../render/SceneBoundary';
import { Scene } from '../render/Scene';
import { StageScreen } from '../render/StageScreen';
import { connectOutput, useOutput } from './output-store';
import { Preloader } from './Preloader';
import { DisplayNumber, TestCard } from './SetupCards';
import { reportRenderError } from '../ui/render-errors';

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
      // The engine's clock (Main's, on a node), as sentAt is: Main and its nodes compare alike.
      const paintedAt = engineNow();
      paintedRevNow = rev;
      el.dataset['paintedRev'] = String(rev);
      el.dataset['latencyMs'] = String(Math.max(0, paintedAt - sentAt));
      // A short history, so a test can match every command to the frame that showed it.
      const log = (window.drashtiPaintLog ??= []);
      // wallAt: this computer's own clock, so tests on one computer can compare Main's and a node's frames.
      log.push({ rev, sentAt, paintedAt, wallAt: Date.now() });
      if (log.length > 20_000) log.splice(0, log.length - 20_000);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [rev, sentAt, root]);
}

/** Tests only: an element that throws as it renders (Session 23; a packaged Drashti never asks for it). */
function ThrowForTests(): never {
  throw new Error('A test asked this output to fail as it drew');
}

/** The revision this window last painted, and frames that came late, for its reports. */
let paintedRevNow = -1;
const late: number[] = [];

/**
 * Count frames that come more than one and a half frame times after the
 * one before, and tell the main process every few seconds (the screens
 * dashboard shows them). A window nobody can see draws few frames: those
 * are not counted (a gap over a second is not a dropped frame).
 */
function useFrameReports(refreshHz: number) {
  useEffect(() => {
    const frameMs = 1000 / (refreshHz > 0 ? refreshHz : 60);
    let last = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const gap = t - last;
      last = t;
      if (gap > frameMs * 1.5 && gap < 1000) {
        late.push(t);
        window.drashtiLateFrames = (window.drashtiLateFrames ?? 0) + 1;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const report = setInterval(() => {
      const since = performance.now() - 60_000;
      while (late.length > 0 && (late[0] ?? 0) < since) late.shift();
      void window.drashti.output
        .report({ droppedFrames: late.length, paintedRev: paintedRevNow })
        .catch(() => undefined);
    }, 2000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(report);
    };
  }, [refreshHz]);
}

function Output() {
  const context = useOutput((s) => s.context);
  const state = useEngine((s) => s.state);
  const rev = useEngine((s) => s.rev);
  const [fontsReady, setFontsReady] = useState(false);
  const [testThrow, setTestThrow] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      window.drashti.output.onTestThrow(() => {
        setTestThrow(true);
      }),
    [],
  );
  usePaintTiming(rootRef);
  useFrameReports(context?.display?.refreshHz ?? 60);
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
  // A key and fill group's screen draws the fill or the key.
  const matte = context?.role === 'keyfill' ? (context.feed ?? 'fill') : null;
  return (
    <div
      ref={rootRef}
      className="relative h-full w-full bg-black"
      data-testid="output-root"
      data-screen={context?.screenId ?? ''}
      data-role={context?.role ?? 'audience'}
      data-feed={matte ?? undefined}
      data-look={state?.look.id ?? ''}
      data-languages={look.languages?.join(',') ?? 'all'}
      data-slides={look.slides}
      data-fonts={fontsReady ? 'ready' : 'loading'}
    >
      {state && fontsReady && (
        <SceneBoundary resetKey={rev}>
          <PlacedInParent content={canvas} mode={scaling} className="absolute inset-0">
            {stage ? (
              <StageScreen state={state} look={look} canvas={canvas} />
            ) : (
              <Scene state={state} canvas={canvas} scaling={scaling} look={look} matte={matte} />
            )}
            {testThrow && <ThrowForTests />}
          </PlacedInParent>
        </SceneBoundary>
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
const sendError = (report: Parameters<typeof window.drashti.app.renderError>[0]) =>
  window.drashti.app.renderError(report);
createRoot(root, {
  onUncaughtError: reportRenderError('output', 'uncaught', sendError),
  onCaughtError: reportRenderError('output', 'caught', sendError),
}).render(
  <StrictMode>
    {identify ? (
      <DisplayNumber number={identify} label={new URLSearchParams(location.search).get('label') ?? ''} />
    ) : (
      <Output />
    )}
  </StrictMode>,
);
