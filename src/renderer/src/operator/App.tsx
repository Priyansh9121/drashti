import { useEffect, useState } from 'react';
import { describeAppInfo } from '../../../shared/app-info';

export function App() {
  const [info, setInfo] = useState('');

  useEffect(() => {
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
      <section className="flex flex-1 items-center justify-center text-muted">Operator view</section>
    </main>
  );
}
