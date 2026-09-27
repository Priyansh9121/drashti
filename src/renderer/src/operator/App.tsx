import { useEffect, useState } from 'react';
import { describeAppInfo } from '../../../shared/app-info';
import { connectEngine, useEngine } from '../engine/engine-store';

export function App() {
  const [info, setInfo] = useState('');
  const rev = useEngine((s) => s.rev);
  const blackout = useEngine((s) => s.state?.blackout ?? false);

  useEffect(() => {
    connectEngine();
    void window.drashti.app.getInfo().then((i) => {
      setInfo(describeAppInfo(i));
    });
  }, []);

  return (
    <main className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-line bg-panel px-4 py-2">
        <h1 className="text-lg font-semibold tracking-wide">Drashti</h1>
        <span className="text-xs text-muted" data-testid="app-info">
          {info}
        </span>
      </header>
      <section className="flex flex-1 flex-col items-center justify-center gap-2 text-muted">
        <p>Operator view</p>
        <p className="text-xs" data-testid="engine-status">
          {rev < 0
            ? 'Connecting to the show engine...'
            : `Engine revision ${rev}${blackout ? ' · black-out on' : ''}`}
        </p>
      </section>
    </main>
  );
}
