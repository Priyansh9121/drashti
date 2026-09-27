import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/app.css';

function Output() {
  return <div className="h-full w-full bg-black" />;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <Output />
  </StrictMode>,
);
