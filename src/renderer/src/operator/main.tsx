import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/fonts.css';
import '../styles/app.css';
import { App } from './App';
import { WindowBoundary } from '../ui/WindowBoundary';
import { reportRenderError } from '../ui/render-errors';

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
      <App />
    </WindowBoundary>
  </StrictMode>,
);
