import { useCallback, useEffect, useState } from 'react';
import type { AppInfo } from '../../../shared/app-info';
import { describeAppInfo } from '../../../shared/app-info';
import { connectEngine } from '../engine/engine-store';
import { loadLibrary } from '../library/library-store';
import { ScreensPanel } from '../screens/ScreensPanel';
import { connectScreens } from '../screens/screens-store';
import { Button } from '../ui/Button';
import { runAction, useNotice } from './actions';
import type { OperatorAction } from './keymap';
import { KEYMAP, shortcutText } from './keymap';
import { LiveControls } from './LiveControls';
import { LivePreview } from './LivePreview';
import { PresentationList } from './PresentationList';
import { SlideGrid } from './SlideGrid';
import { LiveStatus, ScreensSummary } from './StatusLine';
import { useKeymap } from './useKeymap';

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [screensOpen, setScreensOpen] = useState(false);
  const notice = useNotice((s) => s.text);
  const platform = info?.platform ?? 'darwin';

  useEffect(() => {
    connectEngine();
    connectScreens();
    void loadLibrary();
    void window.drashti.app.getInfo().then(setInfo);
  }, []);

  const openScreens = useCallback(() => {
    setScreensOpen(true);
  }, []);
  const run = useCallback(
    (action: OperatorAction) => {
      void runAction(action, { openScreens });
    },
    [openScreens],
  );
  useKeymap(platform, run);

  return (
    <main className="grid h-full grid-cols-[260px_minmax(0,1fr)_420px] grid-rows-[auto_minmax(0,1fr)_auto]">
      <header className="col-span-3 flex items-center gap-4 border-b border-line bg-panel px-4 py-2">
        <h1 className="text-lg font-semibold tracking-wide">Drashti</h1>
        <LiveStatus />
        <span className="flex-1" />
        <ScreensSummary onOpen={openScreens} />
        <Button onClick={openScreens}>Screens</Button>
      </header>

      <PresentationList />
      <SlideGrid />

      <aside
        className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l border-line bg-panel p-4"
        aria-label="Live"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">On the screens now</h2>
        <LivePreview />
        {notice && (
          <p
            role="alert"
            className="rounded-md border border-amber-700 bg-amber-950/60 px-3 py-2 text-sm text-amber-100"
          >
            {notice}
          </p>
        )}
        <LiveControls platform={platform} run={run} />
      </aside>

      <footer className="col-span-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-panel px-4 py-1.5 text-xs text-muted">
        {KEYMAP.filter((b) =>
          ['next', 'previous', 'clearAll', 'clearSlide', 'toggleBlackout'].includes(b.action),
        ).map((b) => (
          <span key={b.action}>
            <kbd className="rounded border border-line px-1">{shortcutText(b.action, platform)}</kbd>{' '}
            {b.label}
          </span>
        ))}
        <span className="flex-1" />
        <span data-testid="app-info">{info ? describeAppInfo(info) : ''}</span>
      </footer>

      {screensOpen && (
        <ScreensPanel
          onClose={() => {
            setScreensOpen(false);
          }}
        />
      )}
    </main>
  );
}
