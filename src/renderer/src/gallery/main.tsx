import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/fonts.css';
import '../styles/app.css';
import { Gallery } from './Gallery';

/*
 * The component gallery, for development: every shared component in each of
 * its states, with placeholder text only. Open it from Diagnostics >
 * Component Gallery (DRASHTI_DIAGNOSTICS=1), or at /gallery.html under
 * pnpm dev. It needs nothing from the main process.
 */
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
