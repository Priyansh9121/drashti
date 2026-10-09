import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/fonts.css';
import '../styles/app.css';
import { NodeApp } from './NodeApp';
import { WindowBoundary } from '../ui/WindowBoundary';
import { reportRenderError } from '../ui/render-errors';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
const sendError = (report: Parameters<typeof window.drashti.app.renderError>[0]) =>
  window.drashti.app.renderError(report);
createRoot(root, {
  onUncaughtError: reportRenderError("node's window", 'uncaught', sendError),
  onCaughtError: reportRenderError("node's window", 'caught', sendError),
}).render(
  <StrictMode>
    <WindowBoundary reloadLabel="Reload the node's window">
      <NodeApp />
    </WindowBoundary>
  </StrictMode>,
);
