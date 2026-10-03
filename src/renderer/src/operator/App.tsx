import { useCallback, useEffect, useState } from 'react';
import type { AppInfo } from '../../../shared/app-info';
import { connectEngine } from '../engine/engine-store';
import { ImportReportDialog } from '../library/ImportReport';
import { watchImports } from '../library/import-store';
import { loadLibrary, watchLibrary } from '../library/library-store';
import { RemoveConfirm, RemovePlaylistConfirm } from '../library/RemoveConfirm';
import { UndoBar } from '../library/UndoBar';
import { WordsEditor } from '../library/WordsEditor';
import { KirtanDialog } from '../kirtans/KirtanDialog';
import { SlideEditor } from '../editor/SlideEditor';
import { redo as redoEdit, undo as undoEdit, useEditor } from '../editor/editor-store';
import { ThemesPanel } from '../themes/ThemesPanel';
import { undoRemoval } from '../library/undo';
import { PlaylistPanel } from '../playlists/PlaylistPanel';
import { loadTree, watchPlaylists } from '../playlists/playlist-store';
import { ScreensPanel } from '../screens/ScreensPanel';
import { connectScreens } from '../screens/screens-store';
import { runAction, useNotice, useTaskProgress } from './actions';
import type { OperatorAction } from '../../../shared/keymap';
import { shortcutText } from '../../../shared/keymap';
import { Header } from './Header';
import { LayerBar } from './LayerBar';
import { Columns, LeftColumn } from './Layout';
import { LivePreview } from './LivePreview';
import { NextPreview } from './NextPreview';
import { PresentationList } from './PresentationList';
import { SlideGrid } from './SlideGrid';
import { RecoveryBanner } from './RecoveryBanner';
import { StageMessageControl } from './StageControls';
import { NoticeArea, StatusBar } from './StatusBar';
import { TimersPanel } from './TimersPanel';
import { MessagesPanel } from './MessagesPanel';
import { PropsPanel } from './PropsPanel';
import { LooksPanel } from './LooksPanel';
import { isTyping, useKeymap } from './useKeymap';
import { watchProps } from './logo-store';
import { connectMode, useMode } from './mode-store';
import { SimpleApp } from '../simple/SimpleApp';
import { SetupWizard } from '../setup/SetupWizard';
import { openSetup } from '../setup/setup-store';
import { StreamPanel } from '../stream/StreamPanel';
import { NetworkPanel } from '../network/NetworkPanel';
import { connectNetwork, useNetwork } from '../network/network-store';
import { AnnouncementsPanel } from '../network/AnnouncementsPanel';
import { connectAnnouncements, useAnnouncements } from '../network/announcements-store';
import { StreamSettings } from '../stream/StreamSettings';
import { connectStream, useStream } from '../stream/stream-store';

/** Everything that keeps the window up to date, connected once as it opens. */
function useConnections(setInfo: (info: AppInfo) => void): void {
  useEffect(() => {
    connectEngine();
    connectScreens();
    connectStream();
    connectNetwork();
    connectAnnouncements();
    watchLibrary();
    watchImports();
    watchPlaylists();
    watchProps();
    connectMode();
    void loadLibrary();
    void loadTree();
    // Edit > Undo: in a text field the window undoes the typing itself; elsewhere it brings back
    // the last removal, or in Simple Mode (which removes nothing) puts back what Clear all took down.
    const offUndo = window.drashti.app.onUndo(() => {
      if (isTyping(document.activeElement)) return;
      if (useEditor.getState().open) undoEdit();
      else if (useMode.getState().mode === 'simple') void window.drashti.engine.dispatch({ type: 'putBack' });
      else void undoRemoval();
    });
    // Edit > Redo: the slide editor's last undone step (typing in a field redoes itself).
    const offRedo = window.drashti.app.onRedo(() => {
      if (!isTyping(document.activeElement) && useEditor.getState().open) redoEdit();
    });
    // Things the main process tells the operator (for example where diagnostics were saved).
    const offNotice = window.drashti.app.onNotice((text) => {
      useNotice.setState({ text });
    });
    const offProgress = window.drashti.app.onProgress((next) => {
      useTaskProgress.setState({ progress: next });
    });
    // How a restore went, told once as the page opens.
    void window.drashti.app.startNotice().then((text) => {
      if (text) useNotice.setState({ text });
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
      offRedo();
      offNotice();
      offProgress();
      window.removeEventListener('dragover', ignoreDrop);
      window.removeEventListener('drop', ignoreDrop);
    };
  }, [setInfo]);
}

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const mode = useMode((s) => s.mode);
  useConnections(setInfo);
  if (mode === null) return null;
  return mode === 'simple' ? <SimpleApp info={info} /> : <ProApp info={info} />;
}

function ProApp({ info }: { info: AppInfo | null }) {
  const [screensOpen, setScreensOpen] = useState(false);
  const streamOpen = useStream((s) => s.panelOpen);
  const networkOpen = useNetwork((s) => s.open);
  const announcementsOpen = useAnnouncements((s) => s.open);
  const platform = info?.platform ?? 'darwin';

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
  // The setup wizard: by itself on the first start, and from View > Set Up Screens… (Pro Mode only).
  useEffect(() => {
    void window.drashti.setup.state().then((state) => {
      if (state.firstRun) void openSetup();
    });
    return window.drashti.setup.onOpen(() => {
      setScreensOpen(false);
      void openSetup();
    });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header platform={platform} onOpenScreens={openScreens} />
      <RecoveryBanner />
      <Columns
        left={
          <LeftColumn
            top={<PlaylistPanel platform={platform} />}
            bottom={<PresentationList platform={platform} />}
            foot={<UndoBar platform={platform} />}
          />
        }
        middle={
          <main aria-label="Slides" className="flex min-h-0 flex-1 flex-col">
            <SlideGrid />
          </main>
        }
        right={
          <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3" aria-label="Live">
            <LivePreview />
            <NextPreview />
            <div className="mt-3 divide-y divide-line border-t border-line">
              <LooksPanel />
              <StageMessageControl />
              <PropsPanel />
              <MessagesPanel />
              <TimersPanel />
            </div>
          </aside>
        }
      />
      <LayerBar platform={platform} run={run} />
      <StatusBar info={info} onOpenScreens={openScreens} />
      <NoticeArea />

      <ImportReportDialog />
      <RemoveConfirm undoKey={shortcutText('undo', platform)} />
      <RemovePlaylistConfirm undoKey={shortcutText('undo', platform)} />
      <WordsEditor platform={platform} />
      <KirtanDialog />
      <SetupWizard platform={platform} />
      <SlideEditor platform={platform} />
      <ThemesPanel />
      {streamOpen && <StreamPanel />}
      {networkOpen && <NetworkPanel />}
      {announcementsOpen && <AnnouncementsPanel />}
      <StreamSettings />
      {screensOpen && (
        <ScreensPanel
          platform={platform}
          onClose={() => {
            setScreensOpen(false);
          }}
        />
      )}
    </div>
  );
}
