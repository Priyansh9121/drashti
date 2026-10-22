import { StrictMode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/fonts.css';
import '../styles/app.css';
import { groupLookIn } from '../../../shared/looks';
import { showsHall } from '../../../shared/stage-layouts';
import { connectEngine, useEngine } from '../engine/engine-store';
import { engineNow, holdClock } from '../render/clock';
import { preloadFonts } from '../render/fonts';
import { PlacedInParent } from '../render/Placed';
import { SceneBoundary } from '../render/SceneBoundary';
import { Scene } from '../render/Scene';
import { StageScreen } from '../render/StageScreen';
import { WarmUp } from '../render/WarmUp';
import { connectOutput, useOutput } from './output-store';
import { Preloader } from './Preloader';
import { DisplayNumber, TestCard } from './SetupCards';
import { reportRenderError } from '../ui/render-errors';
import { HOLD_WARM_UP, SKIP_WARM_UP } from '../render/warm-up-mode';
import { ClockStyleContext } from '../render/clock-style';
import { LiveHere } from '../render/live-here';

function IdentifyOverlay() {
  const identify = useOutput((s) => s.identify);
  useEffect(() => {
    if (!identify) return;
    // Identify's card (setting up, never the show) goes after its few seconds, by this computer's clock.
    // eslint-disable-next-line no-restricted-syntax -- Identify's card, never a frame of the show
    const t = setTimeout(
      () => {
        useOutput.setState({ identify: null });
      },
      // eslint-disable-next-line no-restricted-properties -- Identify's card, never a frame of the show
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
function usePaintTiming(root: React.RefObject<HTMLDivElement | null>, drawing: boolean) {
  const rev = useEngine((s) => s.rev);
  const sentAt = useEngine((s) => s.sentAt);
  useLayoutEffect(() => {
    if (rev < 0 || !drawing) return;
    // When the change was drawn into the page, before its frame (Sessions 31–36): the paint log splits how
    // long it took into the message and the render, and the wait for the next frame.
    const committedAt = engineNow();
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
      // eslint-disable-next-line no-restricted-properties -- the paint log's own record of this computer's time, for tests and the start's phase lines; draws nothing
      const wallAt = Date.now();
      const entry: PaintEntry = { rev, sentAt, committedAt, paintedAt, wallAt };
      log.push(entry);
      if (log.length > 20_000) log.splice(0, log.length - 20_000);
      // The frame after it (Sessions 31–36, PERF-2): how long the change's own frame took to draw.
      requestAnimationFrame(() => {
        entry.nextAt = engineNow();
      });
      firstPaintNow ??= { rev, wallAt };
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [rev, sentAt, root, drawing]);
}

/** Tests only: an element that throws as it renders (Session 23; a packaged Drashti never asks for it). */
function ThrowForTests(): never {
  throw new Error('A test asked this output to fail as it drew');
}

/** The revision this window last painted, and frames that came late, for its reports. */
let paintedRevNow = -1;
/** This page's first painted frame (its revision, this computer's time), for the start's phase lines. */
let firstPaintNow: { rev: number; wallAt: number } | null = null;
const late: number[] = [];

/**
 * Count frames that come more than one and a half frame times after the
 * one before, and tell the main process every few seconds (the screens
 * dashboard shows them). A window nobody can see draws few frames: those
 * are not counted (a gap over a second is not a dropped frame), nor are the GPU's warm-up's (WarmUp).
 */
function useFrameReports(refreshHz: number, drawing: boolean) {
  // The report goes every 2 s from the start, warming up or not (Session 27): it is the heartbeat the main
  // process watches, and a slow computer's warm-up can last past its grace (an output reloaded again and
  // again under Rosetta). Late frames are counted only once the show is drawn.
  useEffect(() => {
    // eslint-disable-next-line no-restricted-syntax -- reports every 2 s: draws nothing
    const report = setInterval(() => {
      // eslint-disable-next-line no-restricted-properties -- a frame reporter's own clock: it draws nothing
      const since = performance.now() - 60_000;
      while (late.length > 0 && (late[0] ?? 0) < since) late.shift();
      // Fonts the words up now name that this computer does not have (Sessions 31–36, I18N-1).
      const missingFonts = [
        ...new Set(
          [...document.querySelectorAll<HTMLElement>('[data-missing-font]')].flatMap((e) =>
            (e.dataset['missingFont'] ?? '').split(', '),
          ),
        ),
      ].filter((n) => n !== '');
      // Its first painted frame: the start's last phase line (Sessions 31–36, PERF-1).
      void window.drashti.output
        .report({
          droppedFrames: late.length,
          paintedRev: paintedRevNow,
          warming: !drawing,
          missingFonts,
          firstPaint: firstPaintNow,
        })
        .catch(() => undefined);
    }, 2000);
    return () => {
      clearInterval(report);
    };
  }, [drawing]);
  useEffect(() => {
    if (!drawing) return;
    const frameMs = 1000 / (refreshHz > 0 ? refreshHz : 60);
    // Counting late frames for the screens dashboard: lengths of time on this computer, drawing nothing.
    // eslint-disable-next-line no-restricted-properties -- a frame reporter's own clock: it draws nothing
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
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [refreshHz, drawing]);
}

function Output() {
  const context = useOutput((s) => s.context);
  const state = useEngine((s) => s.state);
  const rev = useEngine((s) => s.rev);
  const [fontsReady, setFontsReady] = useState(false);
  // The GPU warmed up, unseen, before the show is first drawn (Session 27; stage screens only cut).
  const [warmed, setWarmed] = useState(SKIP_WARM_UP);
  const warmedUp = useCallback(() => {
    setWarmed(true);
  }, []);
  const [testThrow, setTestThrow] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      window.drashti.output.onTestThrow(() => {
        setTestThrow(true);
      }),
    [],
  );
  // Tests only: the clock held at one moment, so two screens can be compared (Session 26d).
  useEffect(() => window.drashti.output.onTestClock(holdClock), []);
  const stage = context?.role === 'stage';
  const ready = fontsReady && (warmed || stage);
  usePaintTiming(rootRef, ready);
  useFrameReports(context?.display?.refreshHz ?? 60, ready);
  useEffect(() => {
    connectOutput();
    // Fonts first, so the first live slide never shows a fallback font.
    void preloadFonts().then(() => {
      setFontsReady(true);
      connectEngine('silent');
    });
  }, []);
  const canvas = { width: context?.canvasWidth ?? 1920, height: context?.canvasHeight ?? 1080 };
  const scaling = context?.scaling ?? 'fit';
  // What this screen shows: its group's settings in the live Look.
  const look = groupLookIn(state?.look, context?.groupId);
  // A key and fill group's screen draws the fill or the key.
  const matte = context?.role === 'keyfill' ? (context.feed ?? 'fill') : null;
  // A node's screen (its context carries how far its clock is from Main's; Main's own never does) draws no video
  // input or window in the picture-in-picture box: they are Main's computer's (Session 50). Nor before it knows.
  const liveHere = context !== null && context.clockOffsetMs === undefined;
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
      data-movement={look.movement}
      // Ready to draw the show: its fonts loaded, and the GPU warmed up (WarmUp).
      data-fonts={ready ? 'ready' : 'loading'}
      data-warm-up={stage ? 'none' : warmed ? 'done' : 'warming'}
    >
      {context && fontsReady && !ready && (
        <PlacedInParent content={canvas} mode={scaling} className="absolute inset-0">
          <WarmUp
            page="output"
            canvas={canvas}
            scaling={scaling}
            matte={matte}
            hold={HOLD_WARM_UP}
            onDone={warmedUp}
          />
        </PlacedInParent>
      )}
      {state && ready && (
        <SceneBoundary resetKey={rev}>
          {/* Main's way of writing the time (Sessions 31–36, I18N-8): a node in another time zone shows Main's. */}
          <ClockStyleContext.Provider value={context?.clockStyle ?? null}>
            <LiveHere.Provider value={liveHere}>
              <PlacedInParent content={canvas} mode={scaling} className="absolute inset-0">
                {stage ? (
                  <StageScreen state={state} look={look} canvas={canvas} hall={context.hall ?? null} />
                ) : (
                  <Scene state={state} canvas={canvas} scaling={scaling} look={look} matte={matte} />
                )}
                {testThrow && <ThrowForTests />}
              </PlacedInParent>
            </LiveHere.Provider>
          </ClockStyleContext.Provider>
        </SceneBoundary>
      )}
      {/* Stage screens show no pictures, so they load none ahead: but for a layout's audience picture
          (Session 50), which loads what comes next as the hall's screens do. */}
      {state && (!stage || showsHall(look.stageLayout)) && (
        <Preloader next={state.next} pictures={state.pictures} />
      )}
      {context && ready && <TestCard context={context} languages={look.languages} />}
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
