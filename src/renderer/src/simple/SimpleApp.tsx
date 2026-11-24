import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppInfo } from '../../../shared/app-info';
import type { OperatorAction } from '../../../shared/keymap';
import { shortcutText, SIMPLE_KEYMAP } from '../../../shared/keymap';
import type { PlaylistItemInfo } from '../../../shared/playlists';
import { AccessEndsNotice } from '../access/AccessEndsNotice';
import { AccessOfflineNotice } from '../access/AccessOfflineNotice';
import { useAccess } from '../access/access-store';
import { FileMenu } from '../files/FileMenu';
import { GuidesDialog } from '../help/GuidesDialog';
import { ManualDialog } from '../help/ManualDialog';
import { ReportDialog } from '../help/ReportDialog';
import { askWhereFilesGo, DropNewDialog } from '../playlists/DropNewDialog';
import { useLibrary } from '../library/library-store';
import { RemoveItemsConfirm, RemovePlaylistConfirm } from '../library/RemoveConfirm';
import { UndoBar } from '../library/UndoBar';
import { LinkDialog } from '../links/LinkDialog';
import { MarkersDialog } from '../markers/MarkersDialog';
import { MediaInfoDialog } from '../library/MediaInfoDialog';
import { ResumeOffers } from '../markers/ResumeOffers';
import { PlayingBars } from '../markers/PlayingBars';
import { setMidiHandler } from '../midi/midi-store';
import { AudioGroup } from '../music/AudioGroup';
import { SoundLevels } from '../sound/SoundLevels';
import { NetworkBadge } from '../network/NetworkBadge';
import { OscBadge } from '../osc/OscControl';
import { ScreensDashboard } from '../nodes/ScreensDashboard';
import { useNodes } from '../nodes/nodes-store';
import { playItem, runSimpleAction, useNotice } from '../operator/actions';
import { EngineUnread } from '../operator/EngineUnread';
import { JumpBox } from '../operator/JumpBox';
import { LayerBar } from '../operator/LayerBar';
import { Columns, LeftColumn } from '../operator/Layout';
import { LiveColumn } from '../operator/LiveColumn';
import { LivePreview } from '../operator/LivePreview';
import { leaveSimpleMode } from '../operator/mode-store';
import { useDoubleClickSwitch } from '../operator/mode-switch';
import { NextBack } from '../operator/NextBack';
import { RecoveryBanner } from '../operator/RecoveryBanner';
import { NoticeArea, StatusBar } from '../operator/StatusBar';
import { LiveStatus } from '../operator/StatusLine';
import { useKeymap } from '../operator/useKeymap';
import { OpenPlaylist } from '../playlists/OpenPlaylist';
import { PlaylistFolders, usePlaylistFolders } from '../playlists/PlaylistFolders';
import { PlaylistPanel } from '../playlists/PlaylistPanel';
import {
  closePlaylist,
  dropFolders,
  importIntoPlaylist,
  loadTree,
  openPlaylist,
  playlistsUnread,
  usePlaylists,
} from '../playlists/playlist-store';
import { PlaylistsUnread } from '../playlists/PlaylistsUnread';
import { startRepeat } from '../playlists/repeat-actions';
import { ScreensSaidNotice } from '../screens/ScreensSaid';
import { StoppedScreens } from '../screens/StoppedScreens';
import { NoSoundNotice } from '../stream/NoSoundNotice';
import { OnAirBadges } from '../stream/OnAirBadges';
import { RecordButton } from '../stream/RecordButton';
import { StreamPageStopped } from '../stream/StreamPageStopped';
import { SoundPlayerStopped } from '../operator/SoundPlayerStopped';
import { LiveWindowNotice } from '../live-window/LiveWindowNotice';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { LookMotion } from '../appearance/LookMotion';
import { Band, HeaderStates } from '../ui/Decoration';
import { WordMark } from '../ui/Mark';
import { ListMusic } from '../ui/icons';
import { CentredPlace, EmptyState, Loading } from '../ui/States';
import { Tooltip } from '../ui/Tooltip';
import { VideoInputNotice } from '../video-inputs/VideoInputNotice';
import { WallpapersPanel } from '../wallpapers/WallpapersPanel';
import { SimpleFirstRun } from './SimpleFirstRun';
import { SimpleFeatureDialogs, SimpleFeatureNotices, SimpleFeatureSections } from './SimpleFeatureSections';
import { useSimpleFeatures } from './simple-features-store';

/*
 * Simple Mode (PLAN.md section 3; Session 55, Part 18: for a small sabha in the hall, or anywhere with one projector):
 * Pro Mode's window with everything taken out but what such a sabha needs, so a volunteer who has seen Pro Mode finds
 * everything where it was.
 * - The middle: the open playlist (as it comes, the one open when Drashti switched to Simple Mode, or the day's new
 *   one when there was none: the main process says which, main/simple-playlist.ts), as Pro Mode's middle shows it:
 *   PDFs and decks as rows, pictures, videos and sounds; one click puts a row up; rows dragged about, with Undo; Add
 *   files… and From a Link… above it, and files dropped on it (or anywhere on the window: at its end) bring things
 *   in; a folder dropped becomes a smart playlist (Session 56); a row's right-click menu has Rename and Delete, and
 *   (Session 56, the owner: Pro Mode's own) Trim, Trim black and silence, Even loudness, When it ends and Edit
 *   slides… (Pro's slide editor).
 * - The left (Session 56, the owner's item 14): Pro Mode's playlists, with folders and smart playlists (New, Rename,
 *   Delete with Undo; a click opens one in the middle), the open folder playlist's folders under them, the wallpapers
 *   (Part 6) under both, and the Undo bar at the foot.
 * - The right: LIVE, Next and Back, the time bar (Play while something is paused: Session 54's question 14), and
 *   (Session 56) Pro Mode's Audio under them; no keys line (the owner: "Remove the keys line"), the bar's buttons show
 *   their keys.
 * - Along the bottom: Clear all (and Put it back after it), Slide, Background and Audio (Session 56), the Wallpaper
 *   and Black-out.
 * - Nothing else: no stream, no stage controls, no messages, timers or lower thirds, no screen setup (the screens set
 *   themselves, Part 1). The main process refuses the rest too (main/simple-mode.ts): of the playlists, Simple Mode
 *   changes what Pro Mode's left column and a row's menu do, never a template, a slot or a share.
 * - Since alpha.22 (Pro Mode's Edit › Simple Mode Features…, the owner's "only 1-2 and max 3"): up to three of Pro
 *   Mode's tools under LIVE, each Pro Mode's own section under Audio, folded to begin with, with only what runs the
 *   show (simple/SimpleFeatureSections.tsx); none until an admin chooses.
 * Back to Pro Mode: a double-click on Pro Mode at the top right, nothing typed (the owner's answer to question 12,
 * changed on 29 Oct 2026); from the keyboard, Enter twice. With Simple access (Part 19) there is no way to Pro Mode:
 * one line says so in its place, and the main process refuses it whatever asks.
 */

/** What Next says when it has nothing to start because the playlist could not be read (Session 39). */
const NEXT_UNREAD =
  'Next has nothing to start: Drashti couldn’t read the playlist. Press Try again beside it.';

// A video input item (Session 51) goes up through the playlist, as its Next does; Simple Mode never chooses one in
// Media (the engine refuses showInput).
const playable = (i: PlaylistItemInfo) =>
  (i.kind === 'presentation' && i.presentationName !== null) ||
  (i.kind === 'media' && !i.missing) ||
  (i.kind === 'input' && !i.missing);

/** This computer's access is Simple Mode only, as the list last said (Session 55). */
const useSimpleAccess = (): boolean => useAccess((s) => s.view?.mode === 'simple');

/**
 * The playlist Simple Mode opens as it comes (Session 56, the owner's item 14): what Pro Mode had open, else the day's
 * "Sabha, <date>" playlist, as the main process says (main/simple-playlist.ts), opened in the middle once. After that
 * the volunteer opens any playlist on the left, as in Pro Mode, and none is forced back (until Session 56 the one
 * playlist was kept open there). True while that first answer is still to come.
 */
function useComingPlaylist(): boolean {
  const [coming, setComing] = useState(true);
  // What Pro Mode had open as Simple Mode came (null: none), for when it goes.
  const proHad = useRef(usePlaylists.getState().openId);
  // The playlist Simple Mode came with, once the main process said.
  const cameWith = useRef<string | null>(null);
  useEffect(() => {
    // Still the Simple Mode that asked (a switch back before the answer leaves it be).
    let gone = false;
    const asked = () => !gone;
    // Simple Mode shows the playlists, never the templates Pro Mode may have had in view.
    if (usePlaylists.getState().view !== 'playlists') usePlaylists.setState({ view: 'playlists' });
    void (async () => {
      const id = await window.drashti.app.simplePlaylist().catch(() => null);
      if (!asked()) return;
      cameWith.current = id;
      // A day's new playlist is made as Simple Mode comes: read the list again when it is not in it yet.
      if (id !== null && !usePlaylists.getState().tree.some((n) => n.id === id)) await loadTree();
      if (asked() && id !== null && usePlaylists.getState().openId !== id) await openPlaylist(id);
      if (asked()) setComing(false);
    })();
    return () => {
      gone = true;
    };
  }, []);
  // Leaving Simple Mode with the playlist it came with still empty (nothing brought in), Pro Mode shows what it had open
  // before rather than an empty new playlist; any other stays open there, what the volunteer worked on.
  useEffect(
    () => () => {
      const { openId: open, items, unread } = usePlaylists.getState();
      const had = proHad.current;
      if (open === null || open !== cameWith.current || open === had) return;
      if (items.length > 0 || unread.itemsOf === open) return;
      if (had === null) closePlaylist();
      else void openPlaylist(had);
    },
    [],
  );
  return coming;
}

/**
 * Files dropped anywhere on the window (not on a row, or on the wallpapers, which take their own): at the end of the
 * open playlist; with none open, the small window for a new playlist or folder (Session 60, x36). A folder (Session
 * 56, the owner's item 5): a smart playlist following it, at once, nothing asked.
 */
function useDropsIntoPlaylist(): void {
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
      const playlistId = usePlaylists.getState().openId;
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => window.drashti.files.pathFor(f))
        .filter((p) => p !== '');
      // With none open, a small window asks for a new playlist or folder for them (Session 60, x36), as in Pro Mode.
      void dropFolders(paths, (files) => {
        if (playlistId !== null) return importIntoPlaylist(playlistId, null, files);
        askWhereFilesGo(files);
        return undefined;
      });
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
}

/**
 * The way back to Pro Mode (Session 55, Part 18; the owner, 11 Nov 2026: a double-click each way, nothing else): one
 * click says to double-click it; from the keyboard, Enter twice (mode-switch.ts). Small and at the top right, far from
 * the show's controls (Session 20).
 */
function ProModeButton() {
  const toPro = useDoubleClickSwitch('Pro Mode', () => {
    void leaveSimpleMode().then((message) => {
      if (message !== null) useNotice.setState({ text: message });
    });
  });
  return (
    <Tooltip content="Double-click (or press Enter twice) to switch to Pro Mode" side="bottom">
      <Button
        className="shrink-0"
        data-testid="simple-leave"
        onClick={toPro.onClick}
        onDoubleClick={toPro.onDoubleClick}
      >
        Pro Mode
      </Button>
    </Tooltip>
  );
}

export function SimpleApp({ info }: { info: AppInfo | null }) {
  const platform = info?.platform ?? 'darwin';
  const simpleAccess = useSimpleAccess();
  const dashboardOpen = useNodes((s) => s.dashboard);
  // Any of Pro Mode's tools chosen for Simple Mode (alpha.22).
  const tools = useSimpleFeatures((s) => s.chosen.length > 0);
  const coming = useComingPlaylist();
  useDropsIntoPlaylist();
  // The open folder playlist's folders under the playlists, as in Pro Mode (Session 56).
  const byFolder = usePlaylistFolders();
  const items = usePlaylists((s) => s.items);
  const openId = usePlaylists((s) => s.openId);
  const treeUnread = usePlaylists((s) => s.unread.playlists);
  const repeating = usePlaylists((s) => s.tree.find((n) => n.id === s.openId)?.kind === 'repeat');
  // Next with nothing live starts the playlist: the row chosen (a click on a presentation's name chooses it, as in Pro
  // Mode), else its first that can play; a Repeat Slides playlist (Session 26d) starts going round.
  const unread = usePlaylists(playlistsUnread);
  const start = useCallback(async () => {
    // Nothing to start while the playlist could not be read (Session 39): say why, never nothing at all.
    if (unread) {
      useNotice.setState({ text: NEXT_UNREAD });
      return;
    }
    if (openId && repeating) return startRepeat(openId);
    const chosen = useLibrary.getState().item;
    const first =
      (chosen?.playlistId === openId ? items.find((i) => i.id === chosen.id && playable(i)) : undefined) ??
      items.find(playable);
    if (openId && first) await playItem(openId, first.id);
  }, [items, openId, repeating, unread]);
  const run = useCallback(
    (action: OperatorAction) => {
      void runSimpleAction(action, start);
    },
    [start],
  );
  useKeymap(platform, run, SIMPLE_KEYMAP);
  // A MIDI controller's pads do Simple Mode's own actions, the Wallpaper's too (a pad mapped to the Logo before
  // Session 55 is read as it); a pad mapped to a macro before Session 44 does nothing.
  useEffect(() => {
    setMidiHandler((action) => {
      if (action.kind === 'next') run('next');
      else if (action.kind === 'back') run('previous');
      else if (action.kind === 'clearAll') run('clearAll');
      else if (action.kind === 'blackout') run('toggleBlackout');
      else if (action.kind === 'wallpaper') run('toggleWallpaper');
    });
    return () => {
      setMidiHandler(null);
    };
  }, [run]);
  return (
    // As Pro Mode's (Session 15): never narrower or shorter than the columns need.
    <div className="flex h-full min-h-[540px] min-w-[960px] flex-col bg-ink" data-testid="simple-mode">
      <header
        className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-header px-4 text-on-header"
        data-header=""
      >
        <LookMotion where="header" />
        <h1 className="shrink-0 text-base font-bold tracking-wide">
          <WordMark />
        </h1>
        <HeaderStates>
          <Badge tone="info">Simple Mode</Badge>
          <OnAirBadges />
          <NetworkBadge />
          <OscBadge />
          {/* Its end is cut, if it must be, rather than drawn over the way out beside it. */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <LiveStatus />
          </div>
        </HeaderStates>
        {/* The way back to Pro Mode (Session 20: small, at the top, far from the show's controls; Windows hides the
            menu bar). With Simple access (Session 55) there is none: one line says so in its place. */}
        {simpleAccess ? (
          <span
            className="shrink-0 text-sm text-on-header/80"
            data-testid="simple-access"
            title="The person who approves access can give this computer Pro access."
          >
            Simple Mode only on this computer
          </span>
        ) : (
          <ProModeButton />
        )}
      </header>
      <Band />
      <LookMotion where="band" />
      {/* No internet, and when access ends (Session 54): in the flow, never over the show's controls. */}
      <AccessOfflineNotice />
      <AccessEndsNotice />
      <RecoveryBanner />
      {/* A hall screen that stopped (Session 26h), or no sound on the stream (Session 31): in the flow, so
          they never cover the show's controls. */}
      <EngineUnread />
      <StoppedScreens />
      {/* A display plugged in, given its job by itself (Session 55): said here too; Simple Mode changes no screen. */}
      <ScreensSaidNotice onChange={null} />
      <NoSoundNotice />
      <StreamPageStopped />
      {/* Drashti's sound stopped: its sound player kept failing (x53): said here too. */}
      <SoundPlayerStopped />
      <LiveWindowNotice />
      {/* A chosen Show a Stream Link's notice (alpha.22), as in Pro Mode. */}
      <SimpleFeatureNotices />
      <VideoInputNotice platform={platform} />
      <SimpleFirstRun platform={platform} />
      <Columns
        left={
          // Pro Mode's left column but the library (Session 56, the owner's item 14: "Several playlists on the left,
          // with folders, as in Pro Mode, and smart playlists"): the playlists, the open folder playlist's folders under
          // them, the wallpapers (Part 6) under both, and Undo at the foot.
          <LeftColumn
            head={null}
            top={<PlaylistPanel platform={platform} simple />}
            bottom={byFolder ? <PlaylistFolders /> : null}
            wallpapers={<WallpapersPanel />}
            over={null}
            covered={false}
            foot={<UndoBar platform={platform} />}
          />
        }
        middle={
          <main aria-label="Playlist" className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col bg-panel" data-testid="centre-playlist">
              {openId !== null ? (
                <OpenPlaylist platform={platform} simple />
              ) : treeUnread ? (
                <div className="p-3">
                  <PlaylistsUnread what="playlists" size="lg" />
                </div>
              ) : coming ? (
                <Loading label="Opening the playlist…" className="flex-1" />
              ) : (
                // None open (Session 56: its open one deleted, or the last one): empty, never a stale one.
                <CentredPlace data-testid="no-playlist-open">
                  <EmptyState icon={ListMusic} title="No playlist open">
                    Open one on the left, or make one with New there. Files dropped here ask for a new
                    playlist or folder to go into; a folder dropped becomes a smart playlist.
                  </EmptyState>
                </CentredPlace>
              )}
            </div>
          </main>
        }
        right={
          // Pro Mode's live column (alpha.21): the LIVE block stands still, Audio scrolls under it (LiveColumn, which
          // holds what is placed out of the flow in it: Session 56).
          <LiveColumn
            still={
              <>
                <LivePreview />
                {/* Oops's key (F9) still acts here; its button is Pro Mode's. */}
                {/* What Next puts up, in words under them (Session 54: a file it misses named before it goes up). */}
                <NextBack
                  platform={platform}
                  run={run}
                  oops={false}
                  canStart={items.some(playable)}
                  caption
                />
                {/* The time bar for what plays (Session 54), under Next and Back: Play while paused (question 14). */}
                <PlayingBars className="px-3 pt-2" />
                {/* Resume where it stopped (alpha.20; the owner's "Yes, all A" to Q60-39: Simple Mode has it too). */}
                <ResumeOffers />
                {/* Record (Session 56, the owner's item 19): sound or video, on air or off, under the time bar and above
                Audio; its folder is chosen in Pro Mode. */}
                <div className="px-3 pt-2">
                  <RecordButton />
                </div>
                {/* The sound's Audio and Video levels and mutes (X33), as in Pro Mode: the block's last. */}
                <div className="mt-3 border-t border-line">
                  <SoundLevels />
                </div>
              </>
            }
            rest={
              // Audio (Session 56, the owner: "The Audio panel on the right, under LIVE and above Black-out, in the
              // empty space there"): Pro Mode's own, as under its LIVE. Under it (alpha.22) the tools chosen in Pro
              // Mode's Edit › Simple Mode Features…, each its own folding section.
              tools ? (
                <div className="divide-y divide-line">
                  <AudioGroup platform={platform} />
                  <SimpleFeatureSections platform={platform} />
                </div>
              ) : (
                <AudioGroup platform={platform} />
              )
            }
          />
        }
      />
      <NoticeArea />
      <LinkDialog />
      {/* Files dropped with no playlist open: a new playlist or folder for them (Session 60, x36). */}
      <DropNewDialog />
      <LayerBar platform={platform} run={run} simple />
      <StatusBar info={info} onOpenScreens={null} />
      {/* A row's right-click menu, its Delete's question when it is up, and From a Link…. */}
      <FileMenu platform={platform} />
      {/* A playlist video's Trim prepares a new cut for its row (Session 57). */}
      <MarkersDialog copies={false} />
      {/* Media information… (alpha.20; the owner's "Yes, all A" to Q60-39: Simple Mode has it too). */}
      <MediaInfoDialog platform={platform} simple />
      <RemoveItemsConfirm undoKey={shortcutText('undo', platform)} />
      {/* Delete… of a playlist or a folder (Session 56), asked first, with Undo. */}
      <RemovePlaylistConfirm undoKey={shortcutText('undo', platform)} />
      <GuidesDialog />
      {/* The Drashti Manual (x37, Session 60): Help › Drashti Manual…, as in Pro Mode. */}
      <ManualDialog />
      <ReportDialog />
      {/* Jump by number (Session 55, Part 4): a row's number and Enter, as in Pro Mode. */}
      <JumpBox />
      {/* What a chosen tool opens from its section (alpha.22): Show a Window…, Show a Stream Link…, Picture in Picture…. */}
      <SimpleFeatureDialogs />
      {dashboardOpen && <ScreensDashboard simple onSetUp={null} />}
    </div>
  );
}
