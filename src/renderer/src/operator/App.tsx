import { SpeechHelperPanel } from '../ai/AiSpeech';
import { connectSpeechHelpers } from '../ai/speech-store';
import { connectAi } from '../ai/ai-store';
import { AiDialog } from '../ai/AiDialog';
import { useCallback, useEffect, useState } from 'react';
import type { AppInfo } from '../../../shared/app-info';
import { connectEngine } from '../engine/engine-store';
import { ImportReportDialog } from '../library/ImportReport';
import { importPaths, watchImports } from '../library/import-store';
import { loadLibrary, useLibraryTab, watchLibrary } from '../library/library-store';
import { useDragging } from '../playlists/drag';
import { connectExtras } from '../library/extras-store';
import { connectSmart } from '../playlists/smart-store';
import { connectSaves } from '../markers/save-store';
import { connectPictureLooks } from '../render/picture-looks';
import { PictureEditor } from '../pictures/PictureEditor';
import { RemoveConfirm, RemoveItemsConfirm, RemovePlaylistConfirm } from '../library/RemoveConfirm';
import { MediaRemoveConfirm } from '../library/media-removal';
import { UndoBar } from '../library/UndoBar';
import { WordsEditor } from '../library/WordsEditor';
import { connectSlideEditorSaves } from '../editor/open-editor';
import { AppearanceDialog } from '../appearance/AppearanceDialog';
import { connectAppearance } from '../appearance/appearance-store';
import { undoRemoval } from '../library/undo';
import { PlaylistPanel } from '../playlists/PlaylistPanel';
import { WallpapersPanel } from '../wallpapers/WallpapersPanel';
import { loadTree, watchPlaylists } from '../playlists/playlist-store';
import { ScreensPanel } from '../screens/ScreensPanel';
import { ScreensDashboard } from '../nodes/ScreensDashboard';
import { closeDashboard, useNodes } from '../nodes/nodes-store';
import { connectScreens, focusDisplay } from '../screens/screens-store';
import { cancelAsk, connectScreenSwitches } from './screen-switches-store';
import { runAction, undoSimple, useNotice, useTaskProgress } from './actions';
import type { OperatorAction } from '../../../shared/keymap';
import { shortcutText } from '../../../shared/keymap';
import { addFileMenuItems } from '../files/file-menu';
import { QuickBar } from '../quick-bar/QuickBar';
import { connectQuickBar, pressQuick, quickMenuItems } from '../quick-bar/quick-bar-store';
import { Header } from './Header';
import { LayerBar } from './LayerBar';
import { NextBack } from './NextBack';
import { PracticeShow } from '../practice/PracticeShow';
import { practiceKey, stopPractice, usePractice } from '../practice/practice-store';
import { closeWelcome, openWelcome, Welcome } from '../setup/Welcome';
import { Columns, LeftColumn } from './Layout';
import { Middle } from './Middle';
import { JumpBox } from './JumpBox';
import { FileMenu } from '../files/FileMenu';
import { PanelGroup, PanelNote } from '../ui/Panel';
import { Music, Wrench } from '../ui/icons';
import { holdOpening } from '../ui/motion';
import { StoppedScreens } from '../screens/StoppedScreens';
import { ScreensSaidNotice } from '../screens/ScreensSaid';
import { EngineUnread } from './EngineUnread';
import { NoSoundNotice } from '../stream/NoSoundNotice';
import { StreamPageStopped } from '../stream/StreamPageStopped';
import { LiveWindowNotice } from '../live-window/LiveWindowNotice';
import { WindowPicker } from '../live-window/WindowPicker';
import { ReadyDialog } from './ReadyDialog';
import { QrSlideDialog } from '../library/QrSlideDialog';
import { PipDialog } from './PipDialog';
import { connectLiveWindow } from '../live-window/live-window-store';
import { VideoInputDialog } from '../video-inputs/VideoInputDialog';
import { VideoInputNotice } from '../video-inputs/VideoInputNotice';
import { connectVideoInputs } from '../video-inputs/video-inputs-store';
import { GuidesDialog } from '../help/GuidesDialog';
import { showGuides } from '../help/guides-store';
import { LivePreview } from './LivePreview';
import { LibraryButton, LibrarySheet } from './LibrarySheet';
import { PlaylistFolders, usePlaylistFolders } from '../playlists/PlaylistFolders';
import { RecoveryBanner } from './RecoveryBanner';
import { AccessEndsNotice } from '../access/AccessEndsNotice';
import { AccessOfflineNotice } from '../access/AccessOfflineNotice';
import { StageMessageControl } from './StageControls';
import { InputOnAudience } from './InputOnAudience';
import { NoticeArea, StatusBar } from './StatusBar';
import { ScreenSwitchAsk } from './ScreenSwitches';
import { TimersPanel } from './TimersPanel';
import { MessagesPanel } from './MessagesPanel';
import { StageLayoutEditor } from '../stage/StageLayoutEditor';
import { undoStage, useStageLayouts } from '../stage/stage-layouts-store';
import { AudioAddMenu, MusicPanel } from '../music/MusicPanel';
import { MusicStepsAside } from '../sound/MusicStepsAside';
import { connectSound } from '../sound/sound-store';
import { setMidiHandler, startMidi } from '../midi/midi-store';
import { MidiTool } from '../midi/MidiTool';
import { LowerThirdsPanel } from '../lower-thirds/LowerThirdsPanel';
import { runBack } from './actions';
import { CalendarDialog } from '../calendar/CalendarDialog';
import { openCalendar } from '../calendar/calendar-store';
import { isTyping, useKeymap } from './useKeymap';
import { KeepScreensQuestion } from './KeepScreens';
import { connectKeepScreens } from './keep-screens-store';
import { connectMode, useMode } from './mode-store';
import { connectSingleKeys, useSingleKeys } from './single-keys-store';
import { useStartMarks } from './start-marks';
import { BackupsDialog } from '../backups/BackupsDialog';
import { EventsOutDialog } from '../events/EventsOutDialog';
import { DropFolderDialog } from '../drop/DropFolderDialog';
import { OpeningDialog } from '../opening/OpeningDialog';
import { CaptionsDialog } from '../captions/CaptionsDialog';
import { UpdatesDialog } from '../updates/UpdatesDialog';
import { LinkDialog } from '../links/LinkDialog';
import { KeysSheet, showKeysSheet } from './KeysSheet';
import { MarkerJumps, MarkersDialog } from '../markers/MarkersDialog';
import { PlayingBars } from '../markers/PlayingBars';
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
    // Audience and Stage (Session 50): in both modes (Simple Mode's status bar turns one on).
    connectScreenSwitches();
    connectKeepScreens();
    connectStream();
    connectLiveWindow();
    connectVideoInputs();
    connectNetwork();
    connectAnnouncements();
    watchLibrary();
    watchImports();
    watchPlaylists();
    connectExtras();
    connectSmart();
    connectSaves();
    connectPictureLooks();
    connectSingleKeys();
    connectMode();
    connectAppearance();
    connectAi();
    connectSpeechHelpers();
    // Session 55, Part 7: Audio's Music steps aside, and the menus' Even loudness and Trim black and silence.
    connectSound();
    // The quick bar's pins (Session 55, Part 8): Pro Mode shows them; kept with the library.
    connectQuickBar();
    void startMidi();
    // The window opens settled with what its first data shows (ui/motion.ts).
    void Promise.allSettled([loadLibrary(), loadTree()]).then(firstData);
    // Edit > Undo: in a text field the window undoes the typing itself; elsewhere it brings back
    // the last removal, or in Simple Mode puts back what Clear all took down while Put it back is offered, else (Session
    // 55, Part 18: Simple Mode deletes, renames and drags its playlist's rows too) brings back the last of those.
    const offUndo = window.drashti.app.onUndo(() => {
      if (isTyping(document.activeElement)) return;
      // The stage layout editor's own steps (Session 55). (The slide editor has a window of its own since Session 55,
      // Part 17a, its Undo its own.)
      if (useStageLayouts.getState().open) void undoStage();
      else if (useMode.getState().mode === 'simple') void undoSimple();
      else void undoRemoval();
    });
    // Slides saved in the slide editor's window (Session 55, Part 17a): one change for Undo here.
    const offEditorSaves = connectSlideEditorSaves();
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
    // below; Simple Mode into its one playlist, Session 55, Part 18).
    const ignoreDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', ignoreDrop);
    window.addEventListener('drop', ignoreDrop);
    void window.drashti.app.getInfo().then(setInfo);
    return () => {
      offUndo();
      offEditorSaves();
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
  // Whether B, . and ? act (Session 37): known before the window shows, so no key is heard before then.
  // Both always come: a request that fails takes the safe default (Session 38), never a blank window.
  const keysKnown = useSingleKeys((s) => s.on !== null);
  useConnections(setInfo);
  // Where its start's time went, for the log (question 36 of Session 54).
  useStartMarks(mode !== null, keysKnown, info !== null);
  if (mode === null || !keysKnown) return null;
  return (
    <>
      {mode === 'simple' ? <SimpleApp info={info} /> : <ProApp info={info} />}
      {/* Keep these screens? (Session 50): in either mode, after a change that put an output on a display. */}
      <KeepScreensQuestion platform={info?.platform ?? 'darwin'} />
    </>
  );
}

function ProApp({ info }: { info: AppInfo | null }) {
  const [screensOpen, setScreensOpen] = useState(false);
  const byFolder = usePlaylistFolders();
  // The library's sheet over the playlists, unless it stands aside for a drag from it (Session 44).
  const libraryOpen = useLibraryTab((s) => s.open);
  const libraryAside = useDragging((s) => s.aside);
  const libraryOver = libraryOpen && !libraryAside;
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
    (action: OperatorAction, slot?: number) => {
      // The practice show takes the show's keys while it is on (Session 26g): never the engine's. Screens, the keys
      // sheet, Uncover, and Audience and Stage (Session 50: real displays, not a step of the show) still act.
      const windowOnly =
        action === 'openScreens' ||
        action === 'showKeys' ||
        action === 'uncoverControls' ||
        action === 'toggleAudience' ||
        action === 'toggleStage';
      if (!windowOnly && practiceKey(action)) return;
      // The quick bar's pins (Session 55, Part 8): a click on one, or Alt+1 to Alt+8.
      if (action === 'quickBar') {
        if (slot !== undefined) void pressQuick(slot);
        return;
      }
      void runAction(action, { openScreens, showKeys: showKeysSheet });
    },
    [openScreens],
  );
  useKeymap(platform, run);
  // Pin to the quick bar (Session 55, Part 8) in the one right-click menu, while Pro Mode's window is up.
  useEffect(() => addFileMenuItems(quickMenuItems), []);
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
      // The Wallpaper, in the Logo's place (Session 55): a pad mapped to the Logo before then is read as it.
      else if (action.kind === 'wallpaper') run('toggleWallpaper');
      // A pad mapped to a macro before Session 44 does nothing: macros are gone (the mapping is kept).
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
      // A question about turning a screen off (Session 50) is Pro Mode's: it goes with it.
      cancelAsk();
    },
    [],
  );
  // The first start's welcome (Session 26g), once per library; else the setup wizard by itself on a
  // first start as before; and the wizard from View > Set Up Screens… (Pro Mode only), which also
  // ends a practice show.
  useEffect(() => {
    void window.drashti.setup.state().then((state) => {
      if (state.welcome) openWelcome();
      else if (state.firstRun) void openSetup(1);
    });
    return window.drashti.setup.onOpen(() => {
      setScreensOpen(false);
      stopPractice();
      closeWelcome();
      // Straight to the displays (Session 44): one click each, the rest after them.
      void openSetup(1);
    });
  }, []);

  return (
    // Never narrower or shorter than the columns need (Session 15): with the text made larger (200%
    // on a 1280 × 720 display leaves 640 × 360) the window scrolls rather than cutting the Live column off.
    <div className="flex h-full bg-ink min-h-[540px] min-w-[960px] flex-col">
      <Header platform={platform} onOpenScreens={openScreens} />
      {/* No internet, and when access ends (Session 54): in the flow, so they never cover the show controls. */}
      <AccessOfflineNotice />
      <AccessEndsNotice />
      {/* A hall screen that stopped (Session 26h): in the flow, so it never covers the show controls. */}
      <EngineUnread />
      <StoppedScreens />
      {/* A display plugged in, given its job by itself (Session 55): said in one line, with Change… (Screens). */}
      <ScreensSaidNotice
        onChange={(displayId) => {
          focusDisplay(displayId);
          openScreens();
        }}
      />
      <NoSoundNotice />
      <StreamPageStopped />
      <LiveWindowNotice />
      <VideoInputNotice platform={platform} />
      <RecoveryBanner />
      {practising ? (
        <PracticeShow platform={platform} run={run} />
      ) : (
        <Columns
          left={
            // Session 44: the playlists have the whole column, the open folder playlist's folders under them,
            // and the library opens over both from the Library button.
            <LeftColumn
              head={<LibraryButton />}
              top={<PlaylistPanel platform={platform} />}
              bottom={byFolder ? <PlaylistFolders /> : null}
              // The wallpapers (Session 55, Part 6), under the playlists, just above the bar of clears.
              wallpapers={<WallpapersPanel />}
              over={<LibrarySheet platform={platform} />}
              covered={libraryOver}
              foot={<UndoBar platform={platform} />}
            />
          }
          middle={
            // The open playlist, the whole middle (Session 55, Part 4: the slides area under it went); no playlist
            // open, the library's chosen presentation as rows.
            <Middle platform={platform} />
          }
          right={
            <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3" aria-label="Live">
              <LivePreview />
              <NextBack platform={platform} run={run} />
              {/* The time bar for what plays (Session 54), under Next and Back so they never move. */}
              <PlayingBars className="px-3 pt-2" />
              <MarkerJumps />
              <SpeechHelperPanel />
              {/* The chosen video input on the audience in one press (Session 55). */}
              <InputOnAudience />
              {/* Session 26a's order: LIVE, Audio, the stage screen, messages, timers, then More tools folded away
                (Session 55: Props and Looks went). */}
              <div className="mt-3 divide-y divide-line border-t border-line">
                <PanelGroup
                  title="Audio"
                  icon={Music}
                  remember="audio"
                  help="audio"
                  actions={<AudioAddMenu />}
                  data-testid="audio-group"
                >
                  <MusicPanel platform={platform} />
                  {/* Music steps aside under a video with sound (Session 55, Part 7). */}
                  <MusicStepsAside />
                </PanelGroup>
                <StageMessageControl />
                <MessagesPanel />
                <TimersPanel />
                <PanelGroup
                  title="More tools"
                  icon={Wrench}
                  remember="more-tools"
                  defaultOpen={false}
                  help="tools"
                  data-testid="more-tools"
                >
                  <div>
                    <PanelNote>
                      A lower third shows a name, a title or a place across the bottom of the picture.
                    </PanelNote>
                    <LowerThirdsPanel nested platform={platform} />
                  </div>
                  <div>
                    <PanelNote>
                      A MIDI controller’s pads can work Next, Back, Clear all and Black-out.
                    </PanelNote>
                    <MidiTool />
                  </div>
                </PanelGroup>
              </div>
            </aside>
          }
        />
      )}
      <NoticeArea />
      {/* The quick bar (Session 55, Part 8), just above the bar of clears: hidden when empty. */}
      <QuickBar platform={platform} run={run} />
      <LayerBar platform={platform} run={run} />
      <StatusBar info={info} onOpenScreens={openScreens} onOpenCalendar={openCalendar} />

      <ImportReportDialog platform={platform} />
      <RemoveConfirm undoKey={shortcutText('undo', platform)} />
      <RemovePlaylistConfirm undoKey={shortcutText('undo', platform)} />
      <MediaRemoveConfirm undoKey={shortcutText('undo', platform)} />
      {/* Session 55 (Part 14): a playlist's rows taken out, asked first when one is up, or a folder. */}
      <RemoveItemsConfirm undoKey={shortcutText('undo', platform)} />
      {/* The one right-click menu (Part 14), and jump by number (Part 4). */}
      <FileMenu platform={platform} />
      <JumpBox />
      <WordsEditor platform={platform} />
      <SetupWizard platform={platform} />
      <Welcome />
      <AppearanceDialog />
      <AiDialog />
      <WindowPicker />
      <VideoInputDialog platform={platform} />
      <PipDialog />
      {/* Ready? and New › QR code… (Session 55, Part 8). */}
      <ReadyDialog />
      <QrSlideDialog />
      {streamOpen && <StreamPanel />}
      {networkOpen && <NetworkPanel />}
      {announcementsOpen && <AnnouncementsPanel />}
      <StreamSettings />
      <StageLayoutEditor platform={platform} />
      <CalendarDialog />
      <BackupsDialog />
      <EventsOutDialog />
      <DropFolderDialog />
      {/* File › Opening… (Session 55). */}
      <OpeningDialog />
      {/* File › Live Captions… (Session 55, Part 10). */}
      <CaptionsDialog />
      <UpdatesDialog />
      <LinkDialog platform={platform} />
      <KeysSheet platform={platform} />
      <ScreenSwitchAsk platform={platform} />
      <GuidesDialog />
      <MarkersDialog />
      <PictureEditor />
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
