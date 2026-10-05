import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlaylistItemInfo } from '../../../shared/playlists';
import type { OperatorAction } from '../../../shared/keymap';
import { shortcutText, SIMPLE_KEYMAP } from '../../../shared/keymap';
import { useEngine } from '../engine/engine-store';
import { mediaKindIcon, mediaKindLabel } from '../library/MediaList';
import { openPlaylist, usePlaylists } from '../playlists/playlist-store';
import { useRoles } from '../roles/roles-store';
import { PinInput, useWaitText } from '../roles/RolesDialogs';
import { Badge, LiveBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { Field, Select, TextInput } from '../ui/Field';
import { Ban, ListMusic, Presentation, RotateCcw, SkipBack, SkipForward, Stamp, Eraser } from '../ui/icons';
import { Kbd } from '../ui/Kbd';
import { readPersisted, writePersisted } from '../ui/persist';
import { EmptyState } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { playItem, runSimpleAction, useNotice } from '../operator/actions';
import { setMidiHandler } from '../midi/midi-store';
import { SIMPLE_MODE_REFUSAL } from '../../../shared/mode';
import { LivePreview } from '../operator/LivePreview';
import { leaveSimpleMode, useMode } from '../operator/mode-store';
import { NextPreview } from '../operator/NextPreview';
import { RecoveryBanner } from '../operator/RecoveryBanner';
import { LiveStatus } from '../operator/StatusLine';
import { NoticeArea, StatusBar } from '../operator/StatusBar';
import { useKeymap } from '../operator/useKeymap';
import type { AppInfo } from '../../../shared/app-info';
import { OnAirBadges } from '../stream/OnAirBadges';
import { NetworkBadge } from '../network/NetworkBadge';
import { ArtiPrompt } from '../arti/ArtiPrompt';
import { ScreensDashboard } from '../nodes/ScreensDashboard';
import { useNodes } from '../nodes/nodes-store';

/*
 * Simple Mode (PLAN.md section 3): one uncluttered screen for a volunteer.
 * The playlist, what is on the screens and what comes next, and big
 * buttons: Next and Back, Black out, Logo, Clear all (and Put it back after
 * it). Nothing here can change the library, the screens or the sound; the
 * main process refuses that too. Leaving takes View > Switch to Pro Mode…
 * and typing the word.
 */

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
  // The item on the screens now: the playlist's place, while something of it is up.
  const liveItem = useEngine((s) => {
    const st = s.state;
    if (st?.live.playlist?.playlistId !== openId) return null;
    const up = st.layers.slide !== null || st.layers.background !== null || st.layers.audio !== null;
    return up ? st.live.playlist.itemId : null;
  });
  const tree = usePlaylists((s) => s.tree);
  const pathOf = (id: string): string => {
    const node = tree.find((n) => n.id === id);
    if (!node) return '';
    const parent = node.parentId ? pathOf(node.parentId) : '';
    return parent ? `${parent} › ${node.name}` : node.name;
  };
  return (
    <section aria-label="Playlist" className="flex min-h-0 flex-col border-r border-line bg-panel">
      <div className="shrink-0 p-3">
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
        ) : (
          <EmptyState icon={ListMusic} title="No playlists" compact>
            An admin makes the sabha&apos;s playlist in Pro Mode.
          </EmptyState>
        )}
      </div>
      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3" data-testid="simple-items">
        {items.map((item) => {
          if (item.kind === 'header')
            return (
              <li
                key={item.id}
                className="px-2 pt-3 pb-1 text-xs font-bold tracking-wider text-muted uppercase"
                data-testid="simple-header"
              >
                <Truncate text={item.label} />
              </li>
            );
          const isLive = liveItem === item.id;
          const can = playable(item);
          const KindIcon = item.kind === 'media' ? mediaKindIcon[item.media] : Presentation;
          const name = item.kind === 'presentation' ? (item.presentationName ?? item.label) : item.label;
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={!can}
                data-testid="simple-item"
                data-live={isLive ? 'true' : undefined}
                aria-current={isLive ? 'true' : undefined}
                onClick={() => {
                  if (openId) void playItem(openId, item.id);
                }}
                className={cx(
                  'flex min-h-14 w-full items-center gap-3 rounded-lg border-2 px-3 py-2 text-left text-base transition-colors disabled:cursor-not-allowed disabled:opacity-50',
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
 * The way out (View > Switch to Pro Mode… opens it): typing the word on
 * purpose, or with roles on (Session 14) a PIN: the operator PIN, or the
 * admin PIN, which also unlocks setting up.
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
            icon={Ban}
            aria-pressed={blackout}
            data-testid="simple-blackout"
            onClick={() => run('toggleBlackout')}
            className="flex-1"
          >
            {blackout ? 'Black out is on' : 'Black out'}
          </Button>
          <Button
            size="xl"
            variant={logo ? 'live' : 'secondary'}
            icon={Stamp}
            aria-pressed={logo !== null}
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
            icon={RotateCcw}
            data-testid="simple-put-back"
            onClick={() => run('undo')}
          >
            Put it back
          </Button>
        ) : (
          <Button size="xl" icon={Eraser} data-testid="simple-clear-all" onClick={() => run('clearAll')}>
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
  // Next with nothing live starts the playlist at its first item that can play.
  const start = useCallback(async () => {
    const first = items.find(playable);
    if (openId && first) await playItem(openId, first.id);
  }, [items, openId]);
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
  const key = (action: OperatorAction) => shortcutText(action, platform, SIMPLE_KEYMAP);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="simple-mode">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
        <h1 className="shrink-0 text-lg font-bold tracking-wide">Drashti</h1>
        <Badge tone="info">Simple Mode</Badge>
        <OnAirBadges size="lg" />
        <NetworkBadge />
        <div className="min-w-0 flex-1">
          <LiveStatus />
        </div>
      </header>
      <RecoveryBanner />
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
          <p className="mt-auto px-3 pt-3 text-xs leading-6 text-muted">
            Keys: Next <Kbd>{key('next')}</Kbd> or Page Down · Back <Kbd>{key('previous')}</Kbd> or Page Up ·
            Black out <Kbd>{key('toggleBlackout')}</Kbd> or <Kbd>.</Kbd> · Logo <Kbd>{key('toggleLogo')}</Kbd>{' '}
            · Clear all <Kbd>{key('clearAll')}</Kbd> · Put it back <Kbd>{key('undo')}</Kbd>
          </p>
        </main>
      </div>
      <ArtiPrompt big />
      <BigButtons platform={platform} run={run} />
      <StatusBar info={info} onOpenScreens={null} />
      <NoticeArea />
      <LeaveSimpleDialog />
      {dashboardOpen && <ScreensDashboard simple onSetUp={null} />}
    </div>
  );
}
