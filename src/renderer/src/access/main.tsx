import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/fonts.css';
import '../styles/app.css';
import { LockApp } from './LockApp';
import { WindowBoundary } from '../ui/WindowBoundary';
import { reportRenderError } from '../ui/render-errors';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
const sendError = (report: Parameters<typeof window.drashti.app.renderError>[0]) =>
  window.drashti.app.renderError(report);
createRoot(root, {
  onUncaughtError: reportRenderError('lock screen', 'uncaught', sendError),
  onCaughtError: reportRenderError('lock screen', 'caught', sendError),
}).render(
  <StrictMode>
    <WindowBoundary reloadLabel="Reload the lock screen">
      <LockApp />
    </WindowBoundary>
  </StrictMode>,
);
