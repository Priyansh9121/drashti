import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../render/fonts.css';
import '../../styles/app.css';
import { StageDisplay } from './StageDisplay';
import { reportRenderError } from '../../ui/render-errors';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
// A page in a phone's browser: its errors go to that browser's console.
createRoot(root, {
  onUncaughtError: reportRenderError('stage display', 'uncaught'),
  onCaughtError: reportRenderError('stage display', 'caught'),
}).render(
  <StrictMode>
    <StageDisplay />
  </StrictMode>,
);
