import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/fonts.css';
import '../styles/app.css';
import { App } from './App';
import { AccessGate } from '../access/AccessGate';
import { OpeningAtStart } from '../opening/OpeningAtStart';
import { WindowBoundary } from '../ui/WindowBoundary';
import { reportRenderError } from '../ui/render-errors';
import { reportFitFailuresTo } from '../render/shrink-to-fit';
import { setLiveWindowSize } from '../render/live-window';
import { holdClock } from '../render/clock';
import { connectDrawingMode } from './drawing-mode';
import { OPERATOR_TRACKS, startMotionProbeIfAsked } from '../render/motion-probe';

// The operator window's pictures of the screens are small: another app's window up as the background
// (Session 48) is captured for them at a quarter of a hall screen's size, half as often. A video input
// (Session 50) is not: Chromium opens a camera once for every page, so all ask for the hall's full picture.
setLiveWindowSize({ width: 960, height: 540, frameRate: 15 });

// Tests only (main sends it only under a test switch): LIVE's clock held at one moment, so its picture can be compared
// with the screens' at held moments (Session 54, C review).
window.drashti.output.onTestClock(holdClock);
// Tests only (a test switch's, never an installed Drashti's): the motion probe's record of the opening (Session 57).
startMotionProbeIfAsked(OPERATOR_TRACKS);

connectDrawingMode();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
const sendError = (report: Parameters<typeof window.drashti.app.renderError>[0]) =>
  window.drashti.app.renderError(report);
const caught = reportRenderError('operator window', 'caught', sendError);
// A slide row's thumbnail that failed to take a text box's measure for its mark (Session 58, MS-2): logged as the
// window's render errors are, while the window draws on.
reportFitFailuresTo((error) => {
  caught(error, {});
});
createRoot(root, {
  onUncaughtError: reportRenderError('operator window', 'uncaught', sendError),
  onCaughtError: caught,
}).render(
  <StrictMode>
    <WindowBoundary reloadLabel="Reload the operator window">
      <AccessGate>
        {/* The opening as Drashti starts, in either mode, once let in. */}
        <OpeningAtStart>
          <App />
        </OpeningAtStart>
      </AccessGate>
    </WindowBoundary>
  </StrictMode>,
);
