import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/fonts.css';
import '../styles/app.css';
import { groupLookIn } from '../../../shared/looks';
import type { ProgramContext } from '../../../shared/stream';
import { connectEngine, useEngine } from '../engine/engine-store';
import { holdClock } from '../render/clock';
import { watchGpuRestarts } from '../render/media-attempts';
import { preloadFonts } from '../render/fonts';
import { preloadStudioFontsOnceDrawn } from '../render/studio-fonts';
import { PlacedInParent } from '../render/Placed';
import { SceneBoundary } from '../render/SceneBoundary';
import { DeckClipsAhead } from '../render/clips-ahead';
import { WarmUp } from '../render/WarmUp';
import { applyCameraChoice, listDevices } from './camera';
import { setCaptureSize, startCapture, stopEncoder, stopPreview } from './capture';
import { useProgram } from './program-store';
import { ProgramView } from './ProgramView';
import { StreamSound } from './sound';
import { reportRenderError } from '../ui/render-errors';
import { HOLD_WARM_UP, NO_GPU_ENDS_HOLD, SKIP_WARM_UP } from '../render/warm-up-mode';
import { ClockStyleContext } from '../render/clock-style';
import { setLiveWindowSize } from '../render/live-window';
import { useStopFade } from '../render/StopFade';

/*
 * The stream's page: the Program, drawn off screen at the stream's size.
 * It follows the show engine like an output, opens the camera and the sound
 * input it is told to, and captures its own picture for the preview and the
 * encoder. It is never shown and takes no input.
 */

const CANVAS = { width: 1920, height: 1080 };
const sound = new StreamSound();

/** Do what the context asks: the size and the sound's settings at once, then the camera and the sound input. */
function apply(context: ProgramContext): void {
  useProgram.setState({ context });
  setCaptureSize({ width: context.width, height: context.height });
  // Another app's window up as the background (Session 48), at the stream's own size.
  setLiveWindowSize({ width: context.width, height: context.height, frameRate: 30 });
  if (!context.preview) stopPreview();
  if (!context.capturing) stopEncoder();
  sound.setDelay(context.soundDelayMs);
  sound.setOwnSound(context.mixOwnSound, useEngine.getState().state);
  inputsInTurn(context);
}

/*
 * The camera and the sound input are opened one choice after another, in the order the choices came, and
 * a choice already overtaken by a newer one is skipped. Opened side by side, an older choice whose camera
 * took longer to start finished last and won: a microphone chosen and then taken away at once (or as the
 * stream went live) came back on (Session 31).
 */
// Wait for the first device list before trying the saved inputs on a newly opened Program.
let inputsDone: Promise<void> = listDevices().catch(() => undefined);
let newestInputs: ProgramContext | null = null;

function inputsInTurn(context: ProgramContext): void {
  newestInputs = context;
  inputsDone = inputsDone
    .then(async () => {
      if (newestInputs !== context) return;
      await applyCameraChoice(context.camera, { width: context.width, height: context.height });
      await sound.useInput(context.sound);
    })
    .catch(() => undefined);
}

function Program() {
  const context = useProgram((s) => s.context);
  const camera = useProgram((s) => s.cameraStream);
  const cameraState = useProgram((s) => s.camera);
  const soundState = useProgram((s) => s.sound);
  const state = useEngine((s) => s.state);
  const rev = useEngine((s) => s.rev);
  // The stream group's languages and Movement in the live Look (switching the Look changes them on air).
  const streamLook = groupLookIn(state?.look, context?.groupId);
  const languages = streamLook.languages;
  const [fontsReady, setFontsReady] = useState(false);
  // The GPU warmed up, unseen, before the show is first drawn (Session 27): the stream is black meanwhile.
  const [warmed, setWarmed] = useState(SKIP_WARM_UP);
  const warmedUp = useCallback(() => {
    setWarmed(true);
  }, []);
  // None where Chromium draws without a graphics chip (Session 58, WU-1, as an output since Session 57): Main says so in
  // this page's context once Chromium has said how it draws, a warm-up begun before then ending there.
  const [noGpu, setNoGpu] = useState(false);
  if (!noGpu && (!HOLD_WARM_UP || NO_GPU_ENDS_HOLD) && context?.noGpu === true) setNoGpu(true);
  const ready = fontsReady && (warmed || noGpu);
  // The Lower Thirds studio's fonts once the stream's picture is drawn (Session 55): never with this page's own start.
  useEffect(() => {
    if (!ready) return;
    return preloadStudioFontsOnceDrawn();
  }, [ready]);
  // Tests only: the clock held at one moment, as the outputs' are, so the stream's picture can be compared
  // with the hall's part-way through a transition (Session 27).
  useEffect(() => window.drashti.output.onTestClock(holdClock), []);
  useEffect(() => {
    void preloadFonts().then(() => {
      setFontsReady(true);
      connectEngine('silent');
    });
    // Videos that failed with a GPU process that stopped play again once another starts (ROB-5).
    watchGpuRestarts();
    navigator.mediaDevices.addEventListener('devicechange', () => {
      void listDevices().then(() => {
        const c = useProgram.getState().context;
        if (c) apply(c);
      });
    });
    window.drashti.stream.page.onContext((next) => {
      apply(next);
    });
    void window.drashti.stream.page.context().then((c) => {
      if (c) apply(c);
    });
  }, []);
  // Drashti's own sound follows the show, when it goes into the stream.
  useEffect(() => {
    sound.setOwnSound(context?.mixOwnSound ?? false, state);
  }, [state, context?.mixOwnSound]);
  // Drashti stopped (Session 54): the stream's picture fades to black with the screens.
  const stop = useStopFade(state?.stopped);
  return (
    <div
      className="relative h-full w-full bg-black"
      data-testid="program-root"
      data-layout={context?.layout ?? ''}
      data-languages={languages?.join(',') ?? 'all'}
      data-movement={streamLook.movement}
      data-camera={cameraState}
      data-sound={soundState}
      // Ready to draw the show: its fonts loaded, and the GPU warmed up (WarmUp).
      data-fonts={ready ? 'ready' : 'loading'}
      data-warm-up={warmed ? 'done' : noGpu ? 'skipped' : 'warming'}
    >
      {context?.picture && fontsReady && !ready && (
        <PlacedInParent content={CANVAS} mode="fit" className="absolute inset-0">
          <WarmUp
            page="stream"
            canvas={CANVAS}
            scaling="fit"
            ticker={false}
            hold={HOLD_WARM_UP}
            onDone={warmedUp}
          />
        </PlacedInParent>
      )}
      {state && ready && context?.picture && !stop.black && (
        // The stream's picture: black if it fails as it draws, until the next change (Session 23).
        <SceneBoundary resetKey={rev}>
          {/* Main's way of writing the time (Sessions 31–36, I18N-8), for clocks in messages. */}
          <ClockStyleContext.Provider value={context.clockStyle ?? null}>
            <PlacedInParent content={CANVAS} mode="fit" className="absolute inset-0">
              <ProgramView
                state={state}
                layout={context.layout}
                languages={languages}
                movement={streamLook.movement}
                canvas={CANVAS}
                camera={camera}
              />
            </PlacedInParent>
          </ClockStyleContext.Provider>
        </SceneBoundary>
      )}
      {/* The deck clips loaded ahead (C3, Session 58): Next's slide's first clip and the slide the operator points at,
          out of sight, so a deck slide comes in on the stream on time as on the hall's screens. */}
      {state && ready && context?.picture && <DeckClipsAhead next={state.next} />}
      {stop.cover}
    </div>
  );
}

// Listen for the preview's and the encoder's ports before anything else: the main process sends
// them as soon as the page has loaded, which can be before React has run its effects (a port
// that arrives with no one listening is lost, and the stream would wait for frames for ever).
startCapture(
  () => sound.level(),
  () => sound.track(),
  () => sound.inputTrack(),
  () => sound.speechGraph(),
);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
const sendError = (report: Parameters<typeof window.drashti.app.renderError>[0]) =>
  window.drashti.app.renderError(report);
createRoot(root, {
  onUncaughtError: reportRenderError('stream’s page', 'uncaught', sendError),
  onCaughtError: reportRenderError('stream’s page', 'caught', sendError),
}).render(
  <StrictMode>
    <Program />
  </StrictMode>,
);
