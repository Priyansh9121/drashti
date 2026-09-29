import { useCallback, useEffect, useState } from 'react';
import type { AppInfo } from '../../../shared/app-info';
import { describeAppInfo } from '../../../shared/app-info';
import { connectEngine } from '../engine/engine-store';
import { ImportReportDialog } from '../library/ImportReport';
import { watchImports } from '../library/import-store';
import { loadLibrary, watchLibrary } from '../library/library-store';
import { RemoveConfirm, RemovePlaylistConfirm } from '../library/RemoveConfirm';
import { UndoBar } from '../library/UndoBar';
import { undoRemoval } from '../library/undo';
import { PlaylistPanel } from '../playlists/PlaylistPanel';
import { loadTree, watchPlaylists } from '../playlists/playlist-store';
import { ScreensPanel } from '../screens/ScreensPanel';
import { connectScreens } from '../screens/screens-store';
import { Button } from '../ui/Button';
import { runAction, useNotice } from './actions';
import type { OperatorAction } from '../../../shared/keymap';
import { KEYMAP, shortcutText } from '../../../shared/keymap';
import { LiveControls } from './LiveControls';
import { LivePreview } from './LivePreview';
import { PresentationList } from './PresentationList';
import { SlideGrid } from './SlideGrid';
import { SoundWarning } from '../screens/SoundOutput';
import { RecoveryBanner } from './RecoveryBanner';
import { LiveStatus, ScreensSummary } from './StatusLine';
import { isTyping, useKeymap } from './useKeymap';

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [screensOpen, setScreensOpen] = useState(false);
  const notice = useNotice((s) => s.text);
  const platform = info?.platform ?? 'darwin';

  useEffect(() => {
    connectEngine();
    connectScreens();
    watchLibrary();
    watchImports();
    watchPlaylists();
    void loadLibrary();
    void loadTree();
    // Edit > Undo: in a text field the window undoes the typing itself; elsewhere it brings back
    // the last removal.
    const offUndo = window.drashti.app.onUndo(() => {
      if (!isTyping(document.activeElement)) void undoRemoval();
    });
    // Files dropped anywhere but the presentation list are ignored (never opened as a page).
    const ignoreDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', ignoreDrop);
    window.addEventListener('drop', ignoreDrop);
    void window.drashti.app.getInfo().then(setInfo);
    return () => {
      offUndo();
      window.removeEventListener('dragover', ignoreDrop);
      window.removeEventListener('drop', ignoreDrop);
    };
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
    <main className="grid h-full grid-cols-[280px_minmax(0,1fr)_420px] grid-rows-[auto_minmax(0,1fr)_auto]">
      <header className="col-span-3 flex items-center gap-4 border-b border-line bg-panel px-4 py-2">
        <h1 className="text-lg font-semibold tracking-wide">Drashti</h1>
        <LiveStatus />
        <span className="flex-1" />
        <SoundWarning onOpen={openScreens} />
        <ScreensSummary onOpen={openScreens} />
        <Button onClick={openScreens}>Screens</Button>
      </header>

      <RecoveryBanner />
      <div className="flex min-h-0 flex-col border-r border-line bg-panel">
        <PlaylistPanel platform={platform} />
        <PresentationList platform={platform} />
        <UndoBar platform={platform} />
      </div>
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
          ['next', 'previous', 'clearAll', 'clearSlide', 'toggleBlackout', 'uncoverControls'].includes(
            b.action,
          ),
        ).map((b) => (
          <span key={b.action}>
            <kbd className="rounded border border-line px-1">{shortcutText(b.action, platform)}</kbd>{' '}
            {b.label}
          </span>
        ))}
        <span className="flex-1" />
        <span data-testid="app-info">{info ? describeAppInfo(info) : ''}</span>
      </footer>

      <ImportReportDialog />
      <RemoveConfirm undoKey={shortcutText('undo', platform)} />
      <RemovePlaylistConfirm undoKey={shortcutText('undo', platform)} />
      {screensOpen && (
        <ScreensPanel
          platform={platform}
          onClose={() => {
            setScreensOpen(false);
          }}
        />
      )}
    </main>
  );
}
