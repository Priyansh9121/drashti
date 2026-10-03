import { useEffect, useMemo, useState } from 'react';
import type { EngineState } from '../../../../shared/engine/state';
import type { PresentationDoc } from '../../../../shared/library';
import { fieldOf, type MessageTemplate, messageItemId, templateFields } from '../../../../shared/messages';
import { type OrderedSlide, playOrder } from '../../../../shared/order';
import type { ItemOrder, PlaylistItemInfo } from '../../../../shared/playlists';
import { isRunning, type TimerState } from '../../../../shared/timers';
import { useEngine } from '../../engine/engine-store';
import { preloadFonts } from '../../render/fonts';
import { PlacedInParent } from '../../render/Placed';
import { PreviewPicture, PreviewsContext } from '../../render/previews';
import { Scene } from '../../render/Scene';
import { SlideView } from '../../render/SlideView';
import { TimerText } from '../../render/TimerText';
import { Badge, LiveBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Layers,
  ListMusic,
  Pause,
  Play,
  RotateCcw,
  Stamp,
  Timer,
} from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { api, current } from '../device';
import { startFeed, useFeed } from '../feed';
import { ConnectionChip } from '../Connection';
import { networkPreviews } from '../previews';
import { tap, useTapNotice } from '../taps';
import { loadPlaylists, type RemoteTab, showPlaylist, startRemote, useRemote, view } from './remote-store';

/*
 * The remote for a phone or tablet (a Remote device): what is on the screens
 * and what comes next, Back and Next always in reach, the clears, black-out,
 * the logo and Put it back, the shown item's slides (tap one to put it up),
 * the playlist, timers and messages. Slides are drawn by the outputs'
 * renderer with the bundled fonts, so Gujarati shapes the same on every
 * phone; pictures and videos are small previews. Each tap takes effect after
 * the one before it (taps.ts).
 */

const CANVAS = { width: 1920, height: 1080 };

const post = (path: string, body?: unknown) => () => api<{ rev?: number }>(path, { method: 'POST', body });

/** On a tablet or a wide window, everything at once; on a phone, tabs. */
function useWide(): boolean {
  const query = '(min-width: 768px)';
  const [wide, setWide] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

const itemArrangement = (order: ItemOrder, doc: PresentationDoc): string | null =>
  order.mode === 'all'
    ? null
    : order.mode === 'arrangement'
      ? order.arrangementId
      : doc.selectedArrangementId;

/** The first line of a slide's words, for its name read out. */
const firstLine = (s: OrderedSlide): string =>
  s.slide.slide.elements
    .flatMap((e) => (e.kind === 'text' ? [e.text.split('\n')[0] ?? ''] : []))[0]
    ?.trim() ?? '';

// ---- what is on the screens ---------------------------------------------------------------------

function LivePicture({ state }: { state: EngineState | null }) {
  const up = state ? state.layers.slide !== null || state.layers.background !== null : false;
  return (
    <section className="space-y-2" aria-labelledby="live-title">
      <div className="flex items-center gap-2">
        <h2 id="live-title" className="flex-1 text-sm font-bold tracking-wider text-muted uppercase">
          On the screens
        </h2>
        {state?.blackout ? (
          <Badge tone="live">Black-out</Badge>
        ) : state?.logo ? (
          <Badge tone="live">Logo</Badge>
        ) : up ? (
          <LiveBadge />
        ) : null}
      </div>
      <div
        className={cx(
          'overflow-hidden rounded-lg border-2 bg-black',
          up && !state?.blackout ? 'border-live' : 'border-line-strong',
        )}
        data-testid="remote-live"
        data-a11y-picture
        aria-hidden="true"
      >
        <PlacedInParent content={CANVAS} mode="fit" className="relative aspect-video w-full">
          {state && <Scene state={state} canvas={CANVAS} scaling="fit" />}
        </PlacedInParent>
      </div>
    </section>
  );
}

function NextLine({ state }: { state: EngineState | null }) {
  const next = state?.next ?? null;
  return (
    <div className="flex items-center gap-3 text-sm" data-testid="remote-next">
      <span className="shrink-0 font-bold tracking-wider text-muted uppercase">Next</span>
      {!next && <span className="text-muted">Nothing after this</span>}
      {next?.kind === 'media' && <span className="truncate text-fg">{next.label}</span>}
      {next?.kind === 'slide' && (
        <div
          className="w-28 shrink-0 overflow-hidden rounded border border-line bg-black"
          data-a11y-picture
          aria-hidden="true"
        >
          <PlacedInParent
            content={{ width: next.slide.width, height: next.slide.height }}
            mode="fit"
            className="relative aspect-video w-full"
          >
            <SlideView slide={next.slide} media="still" />
          </PlacedInParent>
        </div>
      )}
    </div>
  );
}

function QuickActions({ state }: { state: EngineState | null }) {
  const logoMarked = useRemote((s) => s.logo !== null);
  const blackout = state?.blackout ?? false;
  const logoOn = state?.logo != null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="remote-actions">
      <Button
        size="lg"
        className="min-h-12"
        icon={Eraser}
        disabled={!state?.layers.slide}
        onClick={() => void tap(post('/api/v1/clear/slide'))}
      >
        Clear slide
      </Button>
      <Button
        size="lg"
        className="min-h-12"
        icon={Layers}
        onClick={() => void tap(post('/api/v1/clear/all'))}
      >
        Clear all
      </Button>
      <Button
        size="lg"
        className="min-h-12"
        icon={Ban}
        variant={blackout ? 'live' : 'secondary'}
        aria-pressed={blackout}
        onClick={() => void tap(post('/api/v1/blackout', { on: !blackout }))}
      >
        Black-out
      </Button>
      <Button
        size="lg"
        className="min-h-12"
        icon={Stamp}
        variant={logoOn ? 'live' : 'secondary'}
        aria-pressed={logoOn}
        disabled={!logoMarked && !logoOn}
        onClick={() => void tap(post('/api/v1/logo', { on: !logoOn }))}
      >
        Logo
      </Button>
      <Button
        size="lg"
        className="min-h-12"
        icon={RotateCcw}
        variant={state?.canPutBack ? 'warning' : 'secondary'}
        disabled={!state?.canPutBack}
        onClick={() => void tap(post('/api/v1/put-back'))}
      >
        Put it back
      </Button>
    </div>
  );
}

// ---- the shown item's slides -----------------------------------------------------------------

function SlideThumb({ s, live, onTap }: { s: OrderedSlide; live: boolean; onTap: () => void }) {
  const bg = s.slide.cues.find((c) => c.kind === 'background');
  const words = firstLine(s);
  return (
    <li>
      <button
        type="button"
        onClick={onTap}
        aria-pressed={live}
        aria-label={`${s.group.name} ${s.position + 1}${words ? `: ${words}` : ''}${live ? ', on the screens' : ''}`}
        data-testid="remote-slide"
        data-position={s.position}
        data-live={live ? 'true' : undefined}
        className={cx(
          'block w-full overflow-hidden rounded-lg border-2 bg-panel-2 text-left',
          live ? 'border-live' : 'border-line',
        )}
      >
        <div className="relative bg-black" aria-hidden="true" data-a11y-picture>
          <PlacedInParent
            content={{ width: s.slide.slide.width, height: s.slide.slide.height }}
            mode="fit"
            className="relative aspect-video w-full"
          >
            <div style={{ position: 'relative', width: s.slide.slide.width, height: s.slide.slide.height }}>
              {bg?.kind === 'background' && (
                <PreviewPicture
                  mediaId={bg.background.mediaId}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
              )}
              <div style={{ position: 'absolute', inset: 0 }}>
                <SlideView slide={s.slide.slide} media="still" />
              </div>
            </div>
          </PlacedInParent>
        </div>
        <span className="flex items-center gap-1.5 px-2 py-1.5 text-sm">
          <span
            aria-hidden="true"
            className="h-3 w-1.5 shrink-0 rounded-sm"
            style={{ background: s.group.color ?? '#4b5563' }}
          />
          <span className="min-w-0 flex-1 truncate text-fg">
            {s.position + 1} · {s.slide.label || s.group.name}
          </span>
          {live && <LiveBadge />}
        </span>
      </button>
    </li>
  );
}

function Slides() {
  const viewing = useRemote((s) => s.viewing);
  const doc = useRemote((s) => s.doc);
  const live = useEngine((s) => s.state?.live ?? null);
  const shownIndex = useEngine((s) => s.state?.layers.slide?.slideIndex ?? null);
  if (!viewing)
    return (
      <p className="text-base text-muted">Nothing is live. Choose an item in the playlist, or press Next.</p>
    );
  if (doc?.id !== viewing.presentationId) return <p className="text-base text-muted">Opening…</p>;
  const isLiveItem =
    live?.presentationId === viewing.presentationId &&
    (viewing.item ? live.playlist?.itemId === viewing.item.itemId : live.playlist === null);
  const arrangementId = isLiveItem
    ? live.arrangementId
    : viewing.item
      ? itemArrangement(viewing.item.order, doc)
      : doc.selectedArrangementId;
  const order = playOrder(doc, arrangementId);
  const item = viewing.item;
  return (
    <section className="space-y-2" aria-labelledby="slides-title">
      <div className="flex items-center gap-2">
        <h2 id="slides-title" className="min-w-0 flex-1 truncate text-base font-bold text-fg">
          {doc.name}
        </h2>
        {item && !isLiveItem && (
          <Button
            size="lg"
            icon={Play}
            data-testid="remote-start-item"
            onClick={() =>
              void tap(post('/api/v1/trigger/item', { playlistId: item.playlistId, itemId: item.itemId }))
            }
          >
            Start this item
          </Button>
        )}
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-testid="remote-slides">
        {order.slides.map((s) => (
          <SlideThumb
            key={`${s.position}`}
            s={s}
            live={isLiveItem && shownIndex === s.position}
            onTap={() =>
              void tap(
                post('/api/v1/trigger/slide', {
                  presentationId: doc.id,
                  slideIndex: s.position,
                  arrangementId: order.arrangementId,
                  playlist: item ? { playlistId: item.playlistId, itemId: item.itemId } : null,
                }),
              )
            }
          />
        ))}
      </ul>
    </section>
  );
}

// ---- the playlist ---------------------------------------------------------------------------

const playable = (i: PlaylistItemInfo) =>
  (i.kind === 'presentation' && i.presentationName !== null) ||
  (i.kind === 'media' && !i.missing && i.unplayable === null);

function Playlist() {
  const playlists = useRemote((s) => s.playlists);
  const playlistId = useRemote((s) => s.playlistId);
  const items = useRemote((s) => s.items);
  const live = useEngine((s) => s.state?.live.playlist ?? null);
  return (
    <section className="space-y-3" aria-labelledby="playlist-title">
      <h2 id="playlist-title" className="text-sm font-bold tracking-wider text-muted uppercase">
        Playlist
      </h2>
      {playlists && playlists.length > 0 ? (
        <select
          aria-label="Which playlist"
          value={playlistId ?? ''}
          onChange={(e) => void showPlaylist(e.target.value)}
          className="h-12 w-full rounded-lg border border-field bg-panel-2 px-3 text-base text-fg"
          data-testid="remote-playlist"
        >
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-base text-muted">{playlists ? 'There are no playlists.' : 'Loading…'}</p>
      )}
      <ul className="space-y-1.5" data-testid="remote-items">
        {(items ?? []).map((i) => {
          if (i.kind === 'header')
            return (
              <li key={i.id} className="pt-2 text-sm font-bold text-muted">
                {i.label}
              </li>
            );
          const isLive = live?.playlistId === playlistId && live.itemId === i.id;
          const can = playable(i);
          return (
            <li key={i.id}>
              <button
                type="button"
                disabled={!can}
                data-testid="remote-item"
                data-live={isLive ? 'true' : undefined}
                onClick={() => {
                  if (!playlistId) return;
                  if (i.kind === 'presentation')
                    view({
                      presentationId: i.presentationId,
                      item: { playlistId, itemId: i.id, order: i.order },
                    });
                  else void tap(post('/api/v1/trigger/item', { playlistId, itemId: i.id }));
                }}
                className={cx(
                  'flex min-h-12 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-base disabled:opacity-50',
                  isLive ? 'border-live bg-panel-2' : 'border-line bg-panel-2',
                )}
              >
                <span className="min-w-0 flex-1 truncate text-fg">{i.label}</span>
                {i.kind === 'media' && (
                  <Badge>{i.media === 'image' ? 'Picture' : i.media === 'video' ? 'Video' : 'Sound'}</Badge>
                )}
                {i.kind === 'placeholder' && <Badge tone="warning">Empty</Badge>}
                {isLive && <LiveBadge />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---- timers and messages -----------------------------------------------------------------------

function TimerRow({ timer }: { timer: TimerState }) {
  const running = isRunning(timer);
  return (
    <li
      className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2"
      data-testid="remote-timer"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base text-fg">{timer.name}</span>
        <span className="block font-mono text-2xl text-fg">
          <TimerText timer={timer} />
        </span>
      </span>
      <Button
        size="lg"
        className="min-h-12"
        icon={running ? Pause : Play}
        onClick={() =>
          void tap(post(`/api/v1/timers/${encodeURIComponent(timer.id)}/${running ? 'pause' : 'start'}`))
        }
      >
        {running ? 'Pause' : 'Start'}
      </Button>
      <Button
        size="lg"
        className="min-h-12"
        icon={RotateCcw}
        onClick={() => void tap(post(`/api/v1/timers/${encodeURIComponent(timer.id)}/reset`))}
      >
        Reset
      </Button>
    </li>
  );
}

function MessageRow({ template, shown }: { template: MessageTemplate; shown: boolean }) {
  const fields = templateFields(template.template).filter((n) => fieldOf(template, n).kind === 'text');
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <li className="space-y-2 rounded-lg border border-line bg-panel-2 px-3 py-2" data-testid="remote-message">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-base text-fg">{template.name}</span>
        {shown && <Badge tone="live">On the screens</Badge>}
      </div>
      <p className="text-sm text-muted">{template.template}</p>
      {fields.map((name) => (
        <label key={name} className="block space-y-1">
          <span className="block text-sm text-muted">{name}</span>
          <input
            value={values[name] ?? ''}
            onChange={(e) => setValues({ ...values, [name]: e.target.value })}
            maxLength={200}
            className="h-12 w-full rounded-lg border border-field bg-panel-3 px-3 text-base text-fg"
          />
        </label>
      ))}
      <div className="flex gap-2">
        <Button
          size="lg"
          className="min-h-12 flex-1"
          variant="primary"
          onClick={() =>
            void tap(post(`/api/v1/messages/${encodeURIComponent(template.id)}/show`, { values }))
          }
        >
          {shown ? 'Show again' : 'Show'}
        </Button>
        {shown && (
          <Button
            size="lg"
            className="min-h-12 flex-1"
            onClick={() => void tap(post(`/api/v1/messages/${encodeURIComponent(template.id)}/hide`))}
          >
            Take off
          </Button>
        )}
      </div>
    </li>
  );
}

// Selectors return the state's own arrays, never a fresh one (a fresh one each time would loop).
const NO_TIMERS: TimerState[] = [];
const NO_MESSAGES: EngineState['layers']['messages'] = [];

/** The Looks: tapping one makes it live (every screen group changes at once). */
function Looks() {
  const looks = useRemote((s) => s.looks);
  const liveId = useEngine((s) => s.state?.look.id ?? '');
  if (!looks || looks.length < 2) return null;
  return (
    <section className="space-y-2" aria-labelledby="looks-title">
      <h2 id="looks-title" className="text-sm font-bold tracking-wider text-muted uppercase">
        Looks
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="remote-looks">
        {looks.map((look) => {
          const live = look.id === liveId;
          return (
            <Button
              key={look.id}
              size="lg"
              className="min-h-12"
              variant={live ? 'live' : 'secondary'}
              aria-pressed={live}
              data-look={look.id}
              onClick={() => {
                if (!live) void tap(post(`/api/v1/looks/${encodeURIComponent(look.id)}/live`));
              }}
            >
              <span className="truncate">{look.name}</span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}

function TimersAndMessages() {
  const timers = useEngine((s) => s.state?.timers) ?? NO_TIMERS;
  const shown = useEngine((s) => s.state?.layers.messages) ?? NO_MESSAGES;
  const templates = useRemote((s) => s.templates);
  return (
    <div className="space-y-5">
      <Looks />
      <section className="space-y-2" aria-labelledby="timers-title">
        <h2 id="timers-title" className="text-sm font-bold tracking-wider text-muted uppercase">
          Timers
        </h2>
        {timers.length === 0 ? (
          <p className="text-base text-muted">There are no timers.</p>
        ) : (
          <ul className="space-y-2">
            {timers.map((t) => (
              <TimerRow key={t.id} timer={t} />
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2" aria-labelledby="messages-title">
        <h2 id="messages-title" className="text-sm font-bold tracking-wider text-muted uppercase">
          Messages
        </h2>
        {!templates || templates.length === 0 ? (
          <p className="text-base text-muted">{templates ? 'There are no messages.' : 'Loading…'}</p>
        ) : (
          <ul className="space-y-2">
            {templates.map((t) => (
              <MessageRow key={t.id} template={t} shown={shown.some((m) => m.id === messageItemId(t.id))} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---- the page ----------------------------------------------------------------------------------

/**
 * Next, or, with nothing live, the shown playlist from its first item that can play (as Simple Mode
 * does). Which it is is decided in its turn, once the taps before it have been seen to take effect:
 * decided at the tap, a second quick Next would see nothing live yet and start the item again.
 */
function next(): Promise<void> {
  return tap(() => {
    const live = useEngine.getState().state?.live;
    const somethingLive = live?.presentationId != null || live?.playlist != null;
    const { playlistId, items } = useRemote.getState();
    const first = items?.find(playable);
    if (!somethingLive && playlistId && first)
      return api<{ rev?: number }>('/api/v1/trigger/item', {
        method: 'POST',
        body: { playlistId, itemId: first.id },
      });
    return api<{ rev?: number }>('/api/v1/trigger/next', { method: 'POST' });
  });
}

const TABS: { id: RemoteTab; label: string; icon: typeof Play }[] = [
  { id: 'show', label: 'Show', icon: Play },
  { id: 'playlist', label: 'Playlist', icon: ListMusic },
  { id: 'more', label: 'More', icon: Timer },
];

function BackNext({ wide }: { wide: boolean }) {
  const tab = useRemote((s) => s.tab);
  return (
    <div className="shrink-0 border-t border-line bg-panel px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="grid grid-cols-2 gap-3">
        <Button
          size="xl"
          icon={ChevronLeft}
          onClick={() => void tap(post('/api/v1/trigger/back'))}
          data-testid="remote-back"
        >
          Back
        </Button>
        <Button
          size="xl"
          variant="primary"
          iconEnd={ChevronRight}
          onClick={() => void next()}
          data-testid="remote-next-button"
        >
          Next
        </Button>
      </div>
      {!wide && (
        <div role="tablist" aria-label="What to show" className="mt-3 grid grid-cols-3 gap-2">
          {TABS.map((t) => {
            const TabIcon = t.icon;
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                data-testid={`remote-tab-${t.id}`}
                onClick={() => useRemote.setState({ tab: t.id })}
                className={cx(
                  'flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-xs',
                  on ? 'bg-panel-3 text-fg' : 'text-muted',
                )}
              >
                <TabIcon size={18} aria-hidden="true" />
                {t.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Layout() {
  const tab = useRemote((s) => s.tab);
  const state = useEngine((s) => s.state);
  const notice = useTapNotice((s) => s.text);
  const device = useFeed((s) => s.device);
  const wide = useWide();
  const show = (
    <div className="space-y-4">
      <LivePicture state={state} />
      <NextLine state={state} />
      <QuickActions state={state} />
      <Slides />
    </div>
  );
  return (
    // One screen: the header, a middle that scrolls, and Back and Next below it (nothing scrolls under them).
    <div className="flex h-dvh flex-col" data-testid="remote">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold tracking-wide text-fg">Drashti remote</p>
          <p className="truncate text-sm text-muted">{device?.name ?? current()?.name ?? ''}</p>
        </div>
        <ConnectionChip />
      </header>
      {notice && (
        <div className="shrink-0 px-4 pt-3">
          <Notice tone="warning" onDismiss={() => useTapNotice.setState({ text: null })}>
            {notice}
          </Notice>
        </div>
      )}
      {wide ? (
        <main className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] gap-6 overflow-y-auto p-4">
          <Playlist />
          <div className="space-y-6">
            {show}
            <TimersAndMessages />
          </div>
        </main>
      ) : (
        <main
          className="min-h-0 flex-1 overflow-y-auto p-4"
          role="tabpanel"
          aria-label={TABS.find((t) => t.id === tab)?.label}
        >
          {tab === 'show' && show}
          {tab === 'playlist' && <Playlist />}
          {tab === 'more' && <TimersAndMessages />}
        </main>
      )}
      <BackNext wide={wide} />
    </div>
  );
}

export function RemoteApp() {
  const previews = useMemo(() => networkPreviews(), []);
  useEffect(() => {
    void preloadFonts();
    startRemote();
    startFeed();
    void loadPlaylists();
  }, []);
  return (
    <PreviewsContext.Provider value={previews}>
      <Layout />
    </PreviewsContext.Provider>
  );
}
