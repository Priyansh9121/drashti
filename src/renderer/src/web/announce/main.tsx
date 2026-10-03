import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../render/fonts.css';
import '../../styles/app.css';
import { AnnouncePage } from './AnnouncePage';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <AnnouncePage />
  </StrictMode>,
);
