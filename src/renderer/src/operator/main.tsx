import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/fonts.css';
import '../styles/app.css';
import { App } from './App';
import { AccessGate } from '../access/AccessGate';
import { WindowBoundary } from '../ui/WindowBoundary';
import { reportRenderError } from '../ui/render-errors';
import { setLiveWindowSize } from '../render/live-window';
import { holdClock } from '../render/clock';

// The operator window's pictures of the screens are small: another app's window up as the background
// (Session 48) is captured for them at a quarter of a hall screen's size, half as often. A video input
// (Session 50) is not: Chromium opens a camera once for every page, so all ask for the hall's full picture.
setLiveWindowSize({ width: 960, height: 540, frameRate: 15 });

// Tests only (main sends it only under a test switch): LIVE's clock held at one moment, so its picture can be compared
// with the screens' at held moments (Session 54, C review).
window.drashti.output.onTestClock(holdClock);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
const sendError = (report: Parameters<typeof window.drashti.app.renderError>[0]) =>
  window.drashti.app.renderError(report);
createRoot(root, {
  onUncaughtError: reportRenderError('operator window', 'uncaught', sendError),
  onCaughtError: reportRenderError('operator window', 'caught', sendError),
}).render(
  <StrictMode>
    <WindowBoundary reloadLabel="Reload the operator window">
      <AccessGate>
        <App />
      </AccessGate>
    </WindowBoundary>
  </StrictMode>,
);
