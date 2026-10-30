import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../render/fonts.css';
import '../../styles/app.css';
import { preloadFonts } from '../../render/fonts';
import { reportRenderError } from '../../ui/render-errors';
import { WindowBoundary } from '../../ui/WindowBoundary';
import { StudioApp } from './StudioApp';

/*
 * The Lower Thirds studio (Session 55, Part 16): a window of its own for making lower thirds, with a live preview
 * (src/main/lower-thirds/studio-window.ts). It asks the main process for everything: the library is the main
 * process's, and showing one on the screens goes through it too.
 */
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
// Its own fonts first, then the studio's, so the preview draws each font from its first frame.
void preloadFonts();
const sendError = (report: Parameters<typeof window.drashti.app.renderError>[0]) =>
  window.drashti.app.renderError(report);
createRoot(root, {
  onUncaughtError: reportRenderError('Lower Thirds studio', 'uncaught', sendError),
  onCaughtError: reportRenderError('Lower Thirds studio', 'caught', sendError),
}).render(
  <StrictMode>
    <WindowBoundary reloadLabel="Reload the Lower Thirds studio">
      <StudioApp />
    </WindowBoundary>
  </StrictMode>,
);
