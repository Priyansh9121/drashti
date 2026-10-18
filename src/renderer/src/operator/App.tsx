import { useCallback, useEffect, useState } from 'react';
import type { AppInfo } from '../../../shared/app-info';
import { connectEngine } from '../engine/engine-store';
import { ImportReportDialog } from '../library/ImportReport';
import { importPaths, watchImports } from '../library/import-store';
import { loadLibrary, watchLibrary } from '../library/library-store';
import { connectExtras } from '../library/extras-store';
import { connectSmart } from '../playlists/smart-store';
import { connectSaves } from '../markers/save-store';
import { connectPictureLooks } from '../render/picture-looks';
import { PictureEditor } from '../pictures/PictureEditor';
import { RemoveConfirm, RemovePlaylistConfirm } from '../library/RemoveConfirm';
import { MediaRemoveConfirm } from '../library/media-removal';
import { UndoBar } from '../library/UndoBar';
import { WordsEditor } from '../library/WordsEditor';
import { KirtanDialog } from '../kirtans/KirtanDialog';
import { SlideEditor } from '../editor/SlideEditor';
import { redo as redoEdit, undo as undoEdit, useEditor } from '../editor/editor-store';
import { ThemesPanel } from '../themes/ThemesPanel';
import { undoRemoval } from '../library/undo';
import { PlaylistPanel } from '../playlists/PlaylistPanel';
import { loadTree, usePlaylists, watchPlaylists } from '../playlists/playlist-store';
import { ScreensPanel } from '../screens/ScreensPanel';
import { ScreensDashboard } from '../nodes/ScreensDashboard';
import { closeDashboard, useNodes } from '../nodes/nodes-store';
import { connectScreens } from '../screens/screens-store';
import { runAction, useNotice, useTaskProgress } from './actions';
import type { OperatorAction } from '../../../shared/keymap';
import { shortcutText } from '../../../shared/keymap';
import { Header } from './Header';
import { LayerBar } from './LayerBar';
import { NextBack } from './NextBack';
import { PracticeShow } from '../practice/PracticeShow';
import { practiceKey, stopPractice, usePractice } from '../practice/practice-store';
import { closeWelcome, openWelcome, Welcome } from '../setup/Welcome';
import { CentreColumn, Columns, LeftColumn } from './Layout';
import { OpenPlaylist } from '../playlists/OpenPlaylist';
import { PanelGroup, PanelNote } from '../ui/Panel';
import { Music, Wrench } from '../ui/icons';
import { holdOpening } from '../ui/motion';
import { StoppedScreens } from '../screens/StoppedScreens';
import { NoSoundNotice } from '../stream/NoSoundNotice';
import { StreamPageStopped } from '../stream/StreamPageStopped';
import { GuidesDialog } from '../help/GuidesDialog';
import { showGuides } from '../help/guides-store';
import { LivePreview } from './LivePreview';
import { PresentationList } from './PresentationList';
import { SlideGrid } from './SlideGrid';
import { RecoveryBanner } from './RecoveryBanner';
import { StageMessageControl } from './StageControls';
import { NoticeArea, StatusBar } from './StatusBar';
import { TimersPanel } from './TimersPanel';
import { MessagesPanel } from './MessagesPanel';
import { PropsPanel } from './PropsPanel';
import { StageLayoutEditor } from '../stage/StageLayoutEditor';
import { MaskEditor } from '../masks/MaskEditor';
import { MasksPanel } from './MasksPanel';
import { MacrosPanel } from './MacrosPanel';
import { MacroEditor } from '../macros/MacroEditor';
import { MacroCountdown } from '../macros/MacroCountdown';
import { MusicPanel } from '../music/MusicPanel';
import { runMacro } from '../macros/macros-store';
import { setMidiHandler, startMidi } from '../midi/midi-store';
import { runBack } from './actions';
import { LooksPanel } from './LooksPanel';
import { ArtiPrompt } from '../arti/ArtiPrompt';
import { ArtiDialog, ArtiPanel } from '../arti/ArtiPanel';
import { CalendarDialog } from '../calendar/CalendarDialog';
import { IdlePanel } from '../idle/IdlePanel';
import { openCalendar } from '../calendar/calendar-store';
import { isTyping, useKeymap } from './useKeymap';
import { watchProps } from './logo-store';
import { connectMode, useMode } from './mode-store';
import { connectSingleKeys, useSingleKeys } from './single-keys-store';
import { connectRoles } from '../roles/roles-store';
import { AdminPinDialog, RolesDialog } from '../roles/RolesDialogs';
import { BackupsDialog } from '../backups/BackupsDialog';
import { EventsOutDialog } from '../events/EventsOutDialog';
import { DropFolderDialog } from '../drop/DropFolderDialog';
import { UpdatesDialog } from '../updates/UpdatesDialog';
import { LinkDialog } from '../links/LinkDialog';
import { KeysSheet, showKeysSheet } from './KeysSheet';
import { MarkerJumps, MarkersDialog } from '../markers/MarkersDialog';
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

// The window is still opening until its first data is in: taken as this code loads (ui/motion.ts).
const firstData = holdOpening();

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
    connectExtras();
    connectSmart();
    connectSaves();
    connectPictureLooks();
    connectSingleKeys();
    connectMode();
    connectRoles();
    void startMidi();
    // The window opens settled with what its first data shows (ui/motion.ts).
    void Promise.allSettled([loadLibrary(), loadTree()]).then(firstData);
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
    // Help > Keyboard Shortcuts… (Pro Mode).
    const offKeys = window.drashti.app.onShowKeys(showKeysSheet);
    // Help > Guides… (both modes, Sessions 31–36).
    const offGuides = window.drashti.app.onShowGuides(() => {
      showGuides();
    });
    // How a restore went, told once as the page opens.
    void window.drashti.app.startNotice().then((text) => {
      if (text) useNotice.setState({ text });
    });
    // Files dropped where nothing takes them are never opened as a page (Pro Mode imports them,
    // below; Simple Mode ignores them).
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
      offKeys();
      offGuides();
      window.removeEventListener('dragover', ignoreDrop);
      window.removeEventListener('drop', ignoreDrop);
    };
  }, [setInfo]);
}

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const mode = useMode((s) => s.mode);
  // Whether B, ., L and ? act (Session 37): known before the window shows, so no key is heard before then.
  const keysKnown = useSingleKeys((s) => s.on !== null);
  useConnections(setInfo);
  if (mode === null || !keysKnown) return null;
  return mode === 'simple' ? <SimpleApp info={info} /> : <ProApp info={info} />;
}

function ProApp({ info }: { info: AppInfo | null }) {
  const [screensOpen, setScreensOpen] = useState(false);
  const openId = usePlaylists((s) => s.openId);
  const dashboardOpen = useNodes((s) => s.dashboard);
  const streamOpen = useStream((s) => s.panelOpen);
  const networkOpen = useNetwork((s) => s.open);
  const announcementsOpen = useAnnouncements((s) => s.open);
  const platform = info?.platform ?? 'darwin';

  const openScreens = useCallback(() => {
    setScreensOpen(true);
  }, []);
  const practising = usePractice((s) => s.on);
  const run = useCallback(
    (action: OperatorAction) => {
      // The practice show takes the show's keys while it is on (Session 26g): never the engine's.
      const windowOnly = action === 'openScreens' || action === 'showKeys' || action === 'uncoverControls';
      if (!windowOnly && practiceKey(action)) return;
      void runAction(action, { openScreens, showKeys: showKeysSheet });
    },
    [openScreens],
  );
  useKeymap(platform, run);
  // Files dropped anywhere on the window are imported, as on the presentation list (which takes
  // its own drops): an operator drags a deck onto Drashti, wherever it lands (Session 16).
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') === true;
    const over = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => window.drashti.files.pathFor(f))
        .filter((p) => p !== '');
      if (paths.length > 0) void importPaths(paths);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
  // A MIDI controller's pads, as keys are.
  useEffect(() => {
    setMidiHandler((action) => {
      if (action.kind === 'next') run('next');
      else if (action.kind === 'back') {
        if (!practiceKey('back')) void runBack();
      } else if (action.kind === 'clearAll') run('clearAll');
      else if (action.kind === 'blackout') run('toggleBlackout');
      else if (action.kind === 'logo') run('toggleLogo');
      // A macro works the show itself: never during the practice show.
      else if (!usePractice.getState().on) void runMacro(action.macroId);
    });
    return () => {
      setMidiHandler(null);
    };
  }, [run]);
  // Leaving Pro Mode (for Simple Mode) ends a practice show: it never appears there.
  useEffect(
    () => () => {
      stopPractice();
      closeWelcome();
    },
    [],
  );
  // The first start's welcome (Session 26g), once per library; else the setup wizard by itself on a
  // first start as before; and the wizard from View > Set Up Screens… (Pro Mode only), which also
  // ends a practice show.
  useEffect(() => {
    void window.drashti.setup.state().then((state) => {
      if (state.welcome) openWelcome();
      else if (state.firstRun) void openSetup();
    });
    return window.drashti.setup.onOpen(() => {
      setScreensOpen(false);
      stopPractice();
      closeWelcome();
      void openSetup();
    });
  }, []);

  return (
    // Never narrower or shorter than the columns need (Session 15): with the text made larger (200%
    // on a 1280 × 720 display leaves 640 × 360) the window scrolls rather than cutting the Live column off.
    <div className="lamp-window flex h-full min-h-[540px] min-w-[960px] flex-col">
      <Header platform={platform} onOpenScreens={openScreens} />
      <ArtiPrompt />
      <MacroCountdown />
      {/* A hall screen that stopped (Session 26h): in the flow, so it never covers the show controls. */}
      <StoppedScreens />
      <NoSoundNotice />
      <StreamPageStopped />
      <RecoveryBanner />
      {practising ? (
        <PracticeShow platform={platform} run={run} />
      ) : (
        <Columns
          left={
            <LeftColumn
              top={<PlaylistPanel platform={platform} />}
              bottom={<PresentationList platform={platform} />}
              foot={<UndoBar platform={platform} />}
            />
          }
          middle={
            // The open playlist above the chosen item's slides (Session 26a); no playlist open, the slides alone.
            <main aria-label="Playlist and slides" className="flex min-h-0 flex-1 flex-col">
              <CentreColumn
                top={openId ? <OpenPlaylist platform={platform} /> : null}
                bottom={<SlideGrid />}
              />
            </main>
          }
          right={
            <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3" aria-label="Live">
              <LivePreview />
              <NextBack platform={platform} run={run} />
              <MarkerJumps />
              {/* Session 26a's order: LIVE, Audio, the stage screen, messages, timers, props, Looks, then More
                tools folded away. */}
              <div className="mt-3 divide-y divide-line border-t border-line">
                <PanelGroup
                  title="Audio"
                  icon={Music}
                  remember="audio"
                  help="audio"
                  data-testid="audio-group"
                >
                  <MusicPanel nested />
                  <ArtiPanel nested />
                </PanelGroup>
                <StageMessageControl />
                <MessagesPanel />
                <TimersPanel />
                <PropsPanel />
                <LooksPanel />
                <PanelGroup
                  title="More tools"
                  icon={Wrench}
                  remember="more-tools"
                  defaultOpen={false}
                  help="tools"
                  data-testid="more-tools"
                >
                  <div>
                    <PanelNote>A macro does several things at one press, as an admin set it up.</PanelNote>
                    <MacrosPanel nested />
                  </div>
                  <div>
                    <PanelNote>A mask hides part of a screen, such as a corner a banner covers.</PanelNote>
                    <MasksPanel nested />
                  </div>
                  <div>
                    <PanelNote>
                      The idle rotation shows pictures and quotes while nothing else is up.
                    </PanelNote>
                    <IdlePanel nested />
                  </div>
                </PanelGroup>
              </div>
            </aside>
          }
        />
      )}
      <NoticeArea />
      <LayerBar platform={platform} run={run} />
      <StatusBar info={info} onOpenScreens={openScreens} onOpenCalendar={openCalendar} />

      <ImportReportDialog platform={platform} />
      <RemoveConfirm undoKey={shortcutText('undo', platform)} />
      <RemovePlaylistConfirm undoKey={shortcutText('undo', platform)} />
      <MediaRemoveConfirm undoKey={shortcutText('undo', platform)} />
      <WordsEditor platform={platform} />
      <KirtanDialog />
      <SetupWizard platform={platform} />
      <Welcome />
      <SlideEditor platform={platform} />
      <ThemesPanel />
      {streamOpen && <StreamPanel />}
      {networkOpen && <NetworkPanel />}
      {announcementsOpen && <AnnouncementsPanel />}
      <StreamSettings />
      <StageLayoutEditor />
      <MaskEditor />
      <MacroEditor />
      <ArtiDialog />
      <CalendarDialog />
      <RolesDialog />
      <BackupsDialog />
      <EventsOutDialog />
      <DropFolderDialog />
      <UpdatesDialog />
      <LinkDialog platform={platform} />
      <KeysSheet platform={platform} />
      <GuidesDialog />
      <MarkersDialog />
      <PictureEditor />
      <AdminPinDialog />
      {dashboardOpen && (
        <ScreensDashboard
          simple={false}
          onSetUp={() => {
            closeDashboard();
            setScreensOpen(true);
          }}
        />
      )}
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
