import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/fonts.css';
import '../styles/app.css';
import { AccessListApp } from './AccessListApp';
import { WindowBoundary } from '../ui/WindowBoundary';
import { reportRenderError } from '../ui/render-errors';

/*
 * View › Access List… (Session 54, E4): the owner's window onto the access list, on the owner's computer only
 * (src/main/access/access-list-window.ts). It asks the main process for everything: the list is the main
 * process's to ask, as the owner.
 */
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
const sendError = (report: Parameters<typeof window.drashti.app.renderError>[0]) =>
  window.drashti.app.renderError(report);
createRoot(root, {
  onUncaughtError: reportRenderError('Access List', 'uncaught', sendError),
  onCaughtError: reportRenderError('Access List', 'caught', sendError),
}).render(
  <StrictMode>
    <WindowBoundary reloadLabel="Reload the Access List">
      <AccessListApp />
    </WindowBoundary>
  </StrictMode>,
);
