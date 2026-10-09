import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../render/fonts.css';
import '../../styles/app.css';
import { PairPage } from './PairPage';
import { reportRenderError } from '../../ui/render-errors';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
// A page in a phone's browser: its errors go to that browser's console.
createRoot(root, {
  onUncaughtError: reportRenderError('pairing page', 'uncaught'),
  onCaughtError: reportRenderError('pairing page', 'caught'),
}).render(
  <StrictMode>
    <PairPage />
  </StrictMode>,
);
