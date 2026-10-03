import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/fonts.css';
import '../styles/app.css';
import { groupLookIn } from '../../../shared/looks';
import type { ProgramContext } from '../../../shared/stream';
import { connectEngine, useEngine } from '../engine/engine-store';
import { preloadFonts } from '../render/fonts';
import { PlacedInParent } from '../render/Placed';
import { applyCameraChoice, listDevices } from './camera';
import { setCaptureSize, startCapture, stopEncoder, stopPreview } from './capture';
import { useProgram } from './program-store';
import { ProgramView } from './ProgramView';
import { StreamSound } from './sound';

/*
 * The stream's page: the Program, drawn off screen at the stream's size.
 * It follows the show engine like an output, opens the camera and the sound
 * input it is told to, and captures its own picture for the preview and the
 * encoder. It is never shown and takes no input.
 */

const CANVAS = { width: 1920, height: 1080 };
const sound = new StreamSound();

/** Do what the context asks: the size, the camera, the sound. */
async function apply(context: ProgramContext): Promise<void> {
  useProgram.setState({ context });
  setCaptureSize({ width: context.width, height: context.height });
  if (!context.preview) stopPreview();
  if (!context.capturing) stopEncoder();
  sound.setDelay(context.soundDelayMs);
  sound.setOwnSound(context.mixOwnSound, useEngine.getState().state);
  await applyCameraChoice(context.camera, { width: context.width, height: context.height });
  await sound.useInput(context.sound);
}

function Program() {
  const context = useProgram((s) => s.context);
  const camera = useProgram((s) => s.cameraStream);
  const cameraState = useProgram((s) => s.camera);
  const soundState = useProgram((s) => s.sound);
  const state = useEngine((s) => s.state);
  // The stream group's languages in the live Look (switching the Look changes them on air).
  const languages = groupLookIn(state?.look, context?.groupId).languages;
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    void preloadFonts().then(() => {
      setFontsReady(true);
      connectEngine();
    });
    void listDevices();
    navigator.mediaDevices.addEventListener('devicechange', () => {
      void listDevices().then(() => {
        const c = useProgram.getState().context;
        if (c) void apply(c);
      });
    });
    window.drashti.stream.page.onContext((next) => {
      void apply(next);
    });
    void window.drashti.stream.page.context().then((c) => {
      if (c) void apply(c);
    });
  }, []);
  // Drashti's own sound follows the show, when it goes into the stream.
  useEffect(() => {
    sound.setOwnSound(context?.mixOwnSound ?? false, state);
  }, [state, context?.mixOwnSound]);
  return (
    <div
      className="relative h-full w-full bg-black"
      data-testid="program-root"
      data-layout={context?.layout ?? ''}
      data-languages={languages?.join(',') ?? 'all'}
      data-camera={cameraState}
      data-sound={soundState}
      data-fonts={fontsReady ? 'ready' : 'loading'}
    >
      {state && fontsReady && context && (
        <PlacedInParent content={CANVAS} mode="fit" className="absolute inset-0">
          <ProgramView
            state={state}
            layout={context.layout}
            languages={languages}
            canvas={CANVAS}
            camera={camera}
          />
        </PlacedInParent>
      )}
    </div>
  );
}

// Listen for the preview's and the encoder's ports before anything else: the main process sends
// them as soon as the page has loaded, which can be before React has run its effects (a port
// that arrives with no one listening is lost, and the stream would wait for frames for ever).
startCapture(
  () => sound.level(),
  () => sound.track(),
);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <Program />
  </StrictMode>,
);
