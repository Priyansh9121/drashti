import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/app.css';
import { connectEngine } from '../engine/engine-store';
import { connectOutput, useOutput } from './output-store';

function IdentifyOverlay() {
  const identify = useOutput((s) => s.identify);
  useEffect(() => {
    if (!identify) return;
    const t = setTimeout(
      () => {
        useOutput.setState({ identify: null });
      },
      Math.max(0, identify.until - Date.now()),
    );
    return () => {
      clearTimeout(t);
    };
  }, [identify]);
  if (!identify) return null;
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 border-[1.5vmin] border-accent bg-black/80">
      <div className="text-[10vmin] font-bold text-white" data-testid="identify-name">
        {identify.name}
      </div>
      <div className="text-[5vmin] text-muted">{identify.groupName}</div>
    </div>
  );
}

function Output() {
  const context = useOutput((s) => s.context);
  useEffect(() => {
    connectOutput();
    connectEngine();
  }, []);
  return (
    <div
      className="relative h-full w-full bg-black"
      data-testid="output-root"
      data-screen={context?.screenId ?? ''}
    >
      <IdentifyOverlay />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <Output />
  </StrictMode>,
);
