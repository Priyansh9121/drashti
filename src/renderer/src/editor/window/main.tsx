import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../render/fonts.css';
import '../../styles/app.css';
import { preloadFonts } from '../../render/fonts';
import { preloadStudioFonts } from '../../render/studio-fonts';
import { reportRenderError } from '../../ui/render-errors';
import { WindowBoundary } from '../../ui/WindowBoundary';
import { EditorWindow } from './EditorWindow';

/*
 * The slide editor's own window (Session 55, Part 17a; src/main/library/slide-editor-window.ts): a presentation's
 * slides edited while the show goes on in the operator window. It asks the main process for everything: the library
 * is the main process's, and a save comes back to the operator window as one change for its Undo.
 */
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
// Drashti's own fonts and the studio's at once (the Words group offers them all), so slides draw in them at once.
void preloadFonts();
preloadStudioFonts();
const sendError = (report: Parameters<typeof window.drashti.app.renderError>[0]) =>
  window.drashti.app.renderError(report);
createRoot(root, {
  onUncaughtError: reportRenderError('slide editor', 'uncaught', sendError),
  onCaughtError: reportRenderError('slide editor', 'caught', sendError),
}).render(
  <StrictMode>
    <WindowBoundary reloadLabel="Reload the slide editor">
      <EditorWindow />
    </WindowBoundary>
  </StrictMode>,
);
