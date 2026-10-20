import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlaylistItemInfo } from '../../../shared/playlists';
import type { OperatorAction } from '../../../shared/keymap';
import { shortcutText, SIMPLE_KEYMAP } from '../../../shared/keymap';
import { useKeymapNow } from '../operator/single-keys-store';
import { useEngine } from '../engine/engine-store';
import { mediaKindIcon, mediaKindLabel } from '../library/MediaList';
import { openPlaylist, playlistsUnread, usePlaylists } from '../playlists/playlist-store';
import { PlaylistsUnread } from '../playlists/PlaylistsUnread';
import { useRoles } from '../roles/roles-store';
import { PinInput, useWaitText } from '../roles/RolesDialogs';
import { WordMark } from '../ui/Mark';
import { Badge, LiveBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Band, HeaderStates } from '../ui/Decoration';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { Field, Select, TextInput } from '../ui/Field';
import {
  BlackOut,
  ListMusic,
  Play,
  Presentation,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  Stamp,
  Eraser,
} from '../ui/icons';
import { Kbd } from '../ui/Kbd';
import { readPersisted, writePersisted } from '../ui/persist';
import { EmptyState } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { playItem, runSimpleAction, useNotice } from '../operator/actions';
import { startRepeat, stopRepeat } from '../playlists/repeat-actions';
import { setMidiHandler } from '../midi/midi-store';
import { SIMPLE_MODE_REFUSAL } from '../../../shared/mode';
import { LivePreview } from '../operator/LivePreview';
import { leaveSimpleMode, useMode } from '../operator/mode-store';
import { NextPreview } from '../operator/NextPreview';
import { RecoveryBanner } from '../operator/RecoveryBanner';
import { StoppedScreens } from '../screens/StoppedScreens';
import { EngineUnread } from '../operator/EngineUnread';
import { NoSoundNotice } from '../stream/NoSoundNotice';
import { StreamPageStopped } from '../stream/StreamPageStopped';
import { SimpleFirstRun } from './SimpleFirstRun';
import { GuidesDialog } from '../help/GuidesDialog';
import { LiveStatus } from '../operator/StatusLine';
import { NoticeArea, StatusBar } from '../operator/StatusBar';
import { useKeymap } from '../operator/useKeymap';
import type { AppInfo } from '../../../shared/app-info';
import { OnAirBadges } from '../stream/OnAirBadges';
import { NetworkBadge } from '../network/NetworkBadge';
import { ArtiPrompt } from '../arti/ArtiPrompt';
import { MacroCountdown } from '../macros/MacroCountdown';
import { MusicStrip } from '../music/MusicPanel';
import { ScreensDashboard } from '../nodes/ScreensDashboard';
import { useNodes } from '../nodes/nodes-store';

/*
 * Simple Mode (PLAN.md section 3): one uncluttered screen for a volunteer.
 * The playlist, what is on the screens and what comes next, and big
 * buttons: Next and Back, Black-out, Logo, Clear all (and Put it back after
 * it). Nothing here can change the library, the screens or the sound; the
 * main process refuses that too. Leaving takes Switch to Pro Mode… (a small
 * button at the top right since Session 20, or the View menu) and typing the
 * word.
 */

/** What Next says when it has nothing to start because the playlist could not be read (Session 39). */
const NEXT_UNREAD =
  'Next has nothing to start: Drashti couldn’t read the playlist. Press Try again beside it.';

const playable = (i: PlaylistItemInfo) =>
  (i.kind === 'presentation' && i.presentationName !== null) || (i.kind === 'media' && !i.missing);

/** Which playlist: the one played last, else the one that was open, else the first. */
function usePlaylistChoice() {
  const tree = usePlaylists((s) => s.tree);
  const openId = usePlaylists((s) => s.openId);
  const livePlaylist = useEngine((s) => s.state?.live.playlist?.playlistId ?? null);
  const lists = useMemo(() => tree.filter((n) => !n.isFolder), [tree]);
  useEffect(() => {
    if (lists.length === 0) return;
    const want =
      livePlaylist ??
      openId ??
      readPersisted<string | null>('simple.playlist', null, (v): v is string => typeof v === 'string');
    const pick = lists.find((n) => n.id === want) ?? lists[0];
    if (pick && pick.id !== openId) void openPlaylist(pick.id);
  }, [lists, openId, livePlaylist]);
  const choose = (id: string) => {
    writePersisted('simple.playlist', id);
    void openPlaylist(id);
  };
  return { lists, openId, choose };
}

function PlaylistColumn() {
  const { lists, openId, choose } = usePlaylistChoice();
  const items = usePlaylists((s) => s.items);
  // A read that failed is said, with Try again (Session 39): never "No playlists" when there are some.
  const treeUnread = usePlaylists((s) => s.unread.playlists);
  const itemsUnread = usePlaylists((s) => s.openId !== null && s.unread.itemsOf === s.openId);
  // The item on the screens now: the playlist's place, while something of it is up.
  const liveItem = useEngine((s) => {
    const st = s.state;
    if (st?.live.playlist?.playlistId !== openId) return null;
    const up = st.layers.slide !== null || st.layers.background !== null || st.layers.audio !== null;
    return up ? st.live.playlist.itemId : null;
  });
  const tree = usePlaylists((s) => s.tree);
  // Repeat Slides (Session 26d): Simple Mode starts and stops it, and its settings stay as they are.
  const repeat = tree.find((n) => n.id === openId)?.kind === 'repeat';
  const going = useEngine((s) => openId !== null && s.state?.repeat?.playlistId === openId);
  // While it goes round, the item whose slide is up (its steps are named by their items).
  const repeatItem = useEngine((s) =>
    going ? (s.state?.layers.slide?.slide.id.split('/')[0] ?? null) : null,
  );
  const pathOf = (id: string): string => {
    const node = tree.find((n) => n.id === id);
    if (!node) return '';
    const parent = node.parentId ? pathOf(node.parentId) : '';
    return parent ? `${parent} › ${node.name}` : node.name;
  };
  return (
    <section aria-label="Playlist" className="flex min-h-0 flex-col border-r border-line bg-panel">
      <div className="shrink-0 space-y-2 p-3">
        {treeUnread && <PlaylistsUnread what="playlists" size="lg" />}
        {lists.length > 0 ? (
          <Field label="Playlist">
            <Select
              data-testid="simple-playlist"
              value={openId ?? ''}
              onChange={(e) => {
                choose(e.target.value);
              }}
              className="w-full"
            >
              {lists.map((n) => (
                <option key={n.id} value={n.id}>
                  {pathOf(n.id)}
                </option>
              ))}
            </Select>
          </Field>
        ) : treeUnread ? null : (
          <EmptyState icon={ListMusic} title="No playlists" compact>
            An admin makes the sabha’s playlist in Pro Mode.
          </EmptyState>
        )}
        {itemsUnread && <PlaylistsUnread what="items" size="lg" />}
      </div>
      {repeat && openId && (
        <div className="shrink-0 px-3 pb-2">
          {going ? (
            <Button
              size="lg"
              icon={Square}
              className="w-full"
              data-testid="simple-repeat-stop"
              onClick={() => void stopRepeat()}
            >
              Stop going round (Esc)
            </Button>
          ) : (
            <Button
              size="lg"
              variant="primary"
              icon={Play}
              className="w-full"
              data-testid="simple-repeat-start"
              onClick={() => void startRepeat(openId)}
            >
              Start going round
            </Button>
          )}
        </div>
      )}
      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3" data-testid="simple-items">
        {items.map((item) => {
          if (item.kind === 'header')
            return (
              <li
                key={item.id}
                className="px-2 pt-3 pb-1 text-base font-bold text-muted"
                data-testid="simple-header"
              >
                <Truncate text={item.label} />
              </li>
            );
          const isLive = liveItem === item.id || repeatItem === item.id;
          const can = playable(item);
          const KindIcon = item.kind === 'media' ? mediaKindIcon[item.media] : Presentation;
          const name = item.kind === 'presentation' ? (item.presentationName ?? item.label) : item.label;
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={!can}
                data-testid="simple-item"
                data-show-control
                data-live={isLive ? 'true' : undefined}
                aria-current={isLive ? 'true' : undefined}
                onClick={() => {
                  // In Repeat Slides an item starts it going round from there.
                  if (openId) void (repeat ? startRepeat(openId, item.id) : playItem(openId, item.id));
                }}
                className={cx(
                  'flex min-h-14 w-full items-center gap-3 rounded-lg border-2 px-3 py-2 text-left text-base disabled:cursor-not-allowed disabled:opacity-50',
                  isLive ? 'border-live bg-panel-3' : 'border-transparent bg-panel-2 hover:border-field',
                )}
              >
                <KindIcon size={20} aria-hidden="true" className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <Truncate text={name} className="font-medium" />
                  {item.kind === 'media' && (
                    <span className="text-xs text-muted">{mediaKindLabel[item.media]}</span>
                  )}
                  {!can && <span className="text-xs text-warning-fg">Cannot play</span>}
                </span>
                {isLive && <LiveBadge />}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The way out (Switch to Pro Mode…, at the top right or in the View menu,
 * opens it): typing the word on purpose, or with roles on (Session 14) a PIN:
 * the operator PIN, or the admin PIN, which also unlocks setting up.
 */
function LeaveSimpleDialog() {
  const asking = useMode((s) => s.askingToLeave);
  const rolesOn = useRoles((s) => s.view.on);
  const wait = useWaitText();
  const [word, setWord] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  if (!asking) return null;
  const close = () => {
    setWord('');
    setProblem(null);
    useMode.setState({ askingToLeave: false });
  };
  return (
    <Dialog
      title="Switch to Pro Mode?"
      size="sm"
      onClose={close}
      closeButton={false}
      testId="leave-simple"
      footer={
        <>
          <Button onClick={close}>Stay in Simple Mode</Button>
          <Button
            variant="primary"
            type="submit"
            form="leave-simple-form"
            data-testid="leave-simple-switch"
            disabled={word.trim() === '' || (rolesOn && wait !== null)}
          >
            Switch to Pro Mode
          </Button>
        </>
      }
    >
      <form
        id="leave-simple-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void leaveSimpleMode(word).then((message) => {
            setProblem(message);
            // A PIN is never left in the field, right or wrong.
            if (!message || rolesOn) setWord('');
          });
        }}
      >
        <p className="text-sm text-muted">
          Pro Mode can change the library, the playlists, the screens and the sound. It is for whoever looks
          after Drashti. The show on the screens carries on as it is.
        </p>
        {rolesOn ? (
          <Field
            label="Type the operator PIN or the admin PIN"
            hint="The admin PIN also unlocks setting Drashti up."
            error={wait ? `Too many wrong PINs. Try again in ${wait}.` : problem}
          >
            <PinInput
              autoFocus
              data-testid="leave-simple-pin"
              value={word}
              onChange={(e) => {
                setWord(e.target.value);
                setProblem(null);
              }}
            />
          </Field>
        ) : (
          <Field label="Type pro to switch" error={problem}>
            <TextInput
              autoFocus
              value={word}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setWord(e.target.value);
              }}
            />
          </Field>
        )}
      </form>
    </Dialog>
  );
}

/** The big buttons along the bottom. */
function BigButtons({ platform, run }: { platform: string; run: (action: OperatorAction) => void }) {
  const state = useEngine((s) => s.state);
  const blackout = state?.blackout ?? false;
  const logo = state?.logo ?? null;
  const canPutBack = state?.canPutBack ?? false;
  const key = (action: OperatorAction) => shortcutText(action, platform, SIMPLE_KEYMAP);
  return (
    <div
      className="flex shrink-0 items-stretch gap-3 border-t border-line bg-panel p-3"
      data-testid="simple-buttons"
    >
      <Button
        size="xxl"
        instant
        icon={SkipBack}
        onClick={() => run('previous')}
        className="flex-1"
        kbd={key('previous')}
      >
        Back
      </Button>
      <Button
        size="xxl"
        variant="primary"
        instant
        iconEnd={SkipForward}
        onClick={() => run('next')}
        className="flex-[2]"
        kbd={key('next')}
      >
        Next
      </Button>
      <div className="flex w-[22rem] shrink-0 flex-col gap-2">
        <div className="flex gap-2">
          <Button
            size="xl"
            variant={blackout ? 'live' : 'secondary'}
            instant
            icon={BlackOut}
            data-testid="simple-blackout"
            onClick={() => run('toggleBlackout')}
            className="flex-1"
          >
            {blackout ? 'Black-out is on' : 'Black-out'}
          </Button>
          <Button
            size="xl"
            variant={logo ? 'live' : 'secondary'}
            instant
            icon={Stamp}
            data-testid="simple-logo"
            onClick={() => run('toggleLogo')}
            className="flex-1"
          >
            {logo ? 'Logo is on' : 'Logo'}
          </Button>
        </div>
        {canPutBack ? (
          <Button
            size="xl"
            variant="warning"
            instant
            icon={RotateCcw}
            data-testid="simple-put-back"
            onClick={() => run('undo')}
          >
            Put it back
          </Button>
        ) : (
          <Button
            size="xl"
            instant
            icon={Eraser}
            data-testid="simple-clear-all"
            onClick={() => run('clearAll')}
          >
            Clear all
          </Button>
        )}
      </div>
    </div>
  );
}

export function SimpleApp({ info }: { info: AppInfo | null }) {
  const platform = info?.platform ?? 'darwin';
  const dashboardOpen = useNodes((s) => s.dashboard);
  const items = usePlaylists((s) => s.items);
  const openId = usePlaylists((s) => s.openId);
  const repeating = usePlaylists((s) => s.tree.find((n) => n.id === s.openId)?.kind === 'repeat');
  // Next with nothing live starts the playlist at its first item that can play; a Repeat Slides
  // playlist (Session 26d) starts going round.
  const unread = usePlaylists(playlistsUnread);
  const start = useCallback(async () => {
    // Nothing to start while the playlist could not be read (Session 39): say why, never nothing at all.
    if (unread) {
      useNotice.setState({ text: NEXT_UNREAD });
      return;
    }
    if (openId && repeating) return startRepeat(openId);
    const first = items.find(playable);
    if (openId && first) await playItem(openId, first.id);
  }, [items, openId, repeating, unread]);
  const run = useCallback(
    (action: OperatorAction) => {
      void runSimpleAction(action, start);
    },
    [start],
  );
  useKeymap(platform, run, SIMPLE_KEYMAP);
  // A MIDI controller's pads do Simple Mode's own actions; Simple Mode runs no macros.
  useEffect(() => {
    setMidiHandler((action) => {
      if (action.kind === 'next') run('next');
      else if (action.kind === 'back') run('previous');
      else if (action.kind === 'clearAll') run('clearAll');
      else if (action.kind === 'blackout') run('toggleBlackout');
      else if (action.kind === 'logo') run('toggleLogo');
      else useNotice.setState({ text: SIMPLE_MODE_REFUSAL });
    });
    return () => {
      setMidiHandler(null);
    };
  }, [run]);
  // Its key line names only keys that act: not B, . or L while an admin has turned them off (Session 37).
  const keymap = useKeymapNow(SIMPLE_KEYMAP);
  const key = (action: OperatorAction) => shortcutText(action, platform, keymap);
  const covering = key('toggleBlackout') !== '';
  return (
    <div className="flex h-full min-h-0 flex-col bg-ink" data-testid="simple-mode">
      <header
        className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-header px-4 text-on-header"
        data-header=""
      >
        <h1 className="shrink-0 text-lg font-bold tracking-wide">
          <WordMark size={26} />
        </h1>
        <HeaderStates>
          <Badge tone="info">Simple Mode</Badge>
          <OnAirBadges size="lg" />
          <NetworkBadge />
          <div className="min-w-0 flex-1">
            <LiveStatus />
          </div>
        </HeaderStates>
        {/* The way out on Simple Mode's own screen (Session 20), small and far from the big buttons:
            Windows hides the menu bar. It asks the same question as View > Switch to Pro Mode…. */}
        <Button
          className="shrink-0"
          data-testid="simple-leave"
          onClick={() => {
            useMode.setState({ askingToLeave: true });
          }}
        >
          Switch to Pro Mode…
        </Button>
      </header>
      <Band />
      <RecoveryBanner />
      {/* A hall screen that stopped (Session 26h), or no sound on the stream (Session 31): in the flow, so
          they never cover the big buttons. */}
      <EngineUnread />
      <StoppedScreens />
      <NoSoundNotice />
      <StreamPageStopped />
      <SimpleFirstRun platform={platform} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]">
        <PlaylistColumn />
        <main aria-label="On the screens" className="flex min-h-0 flex-col overflow-hidden pb-3">
          <div className="flex min-h-0 items-start gap-2">
            <div className="min-w-0 flex-[3]">
              <LivePreview />
            </div>
            <div className="min-w-0 flex-[2]">
              <NextPreview stacked />
            </div>
          </div>
          <MusicStrip />
          <p className="mt-auto px-3 pt-3 text-xs leading-6 text-muted" data-testid="simple-keys">
            Keys: Next <Kbd>{key('next')}</Kbd> or Page Down · Back <Kbd>{key('previous')}</Kbd> or Page Up ·{' '}
            {covering && (
              <>
                Black-out <Kbd>{key('toggleBlackout')}</Kbd> or <Kbd>.</Kbd> · Logo{' '}
                <Kbd>{key('toggleLogo')}</Kbd> ·{' '}
              </>
            )}
            Clear all <Kbd>{key('clearAll')}</Kbd> · Put it back <Kbd>{key('undo')}</Kbd>
            {!covering && ' · Black-out and Logo: their buttons'}
          </p>
        </main>
      </div>
      <ArtiPrompt big />
      <MacroCountdown big />
      <NoticeArea />
      <BigButtons platform={platform} run={run} />
      <StatusBar info={info} onOpenScreens={null} />
      <LeaveSimpleDialog />
      <GuidesDialog />
      {dashboardOpen && <ScreensDashboard simple onSetUp={null} />}
    </div>
  );
}
