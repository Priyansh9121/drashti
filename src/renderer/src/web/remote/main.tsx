import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../render/fonts.css';
import '../../styles/app.css';
import { RemoteApp } from './RemoteApp';
import { reportRenderError } from '../../ui/render-errors';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
// A page in a phone's browser: its errors go to that browser's console.
createRoot(root, {
  onUncaughtError: reportRenderError('remote', 'uncaught'),
  onCaughtError: reportRenderError('remote', 'caught'),
}).render(
  <StrictMode>
    <RemoteApp />
  </StrictMode>,
);
