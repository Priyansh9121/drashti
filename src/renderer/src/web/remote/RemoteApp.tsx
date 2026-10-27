import type { ReactNode } from 'react';
import { useContext, useEffect, useMemo, useState } from 'react';
import type { RemotePresentation } from '../../../../shared/network-api';
import { KIRTAN_FIELD_NAMES, type SearchHit } from '../../../../shared/search';
import type { EngineState } from '../../../../shared/engine/state';
import { backgroundCueOf, type PresentationDoc } from '../../../../shared/library';
import { fieldOf, type MessageTemplate, messageItemId, templateFields } from '../../../../shared/messages';
import { type OrderedSlide, playOrder } from '../../../../shared/order';
import type { ItemOrder, PlaylistItemInfo } from '../../../../shared/playlists';
import { isRunning } from '../../../../shared/timers';
import { useEngine } from '../../engine/engine-store';
import { preloadFonts } from '../../render/fonts';
import { PlacedInParent } from '../../render/Placed';
import { PreviewPicture, PreviewsContext } from '../../render/previews';
import { pipName } from '../../render/pip';
import { Scene } from '../../render/Scene';
import { textLang } from '../../render/lang';
import { useNow } from '../../render/useNow';
import { groupLookIn, type LiveGroupLook } from '../../../../shared/looks';
import { SCREEN_SWITCHES, type ScreenSwitches, SWITCH_NAMES } from '../../../../shared/screen-switches';
import { languageView } from '../../../../shared/language-view';
import { SlideView } from '../../render/SlideView';
import { TimerText } from '../../render/TimerText';
import { Mark } from '../../ui/Mark';
import { Badge, LiveBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import {
  AppWindow,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eraser,
  FileText,
  ListMusic,
  MonitorOff,
  PictureInPicture2,
  Play,
  Repeat2,
  Square,
  Timer,
  Tv,
  Video,
  X,
} from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { api, current } from '../device';
import { startFeed, useFeed } from '../feed';
import { ConnectionChip } from '../Connection';
import { networkPreviews } from '../previews';
import { tap, useTapNotice } from '../taps';
import { PhoneFiles } from './PhoneFiles';
import { startPhoneFiles } from './phone-files-store';
import {
  loadLibrary,
  loadPlaylists,
  openPresentation,
  type RemoteTab,
  searchLibrary,
  setNotesOpen,
  showPlaylist,
  startRemote,
  useRemote,
  view,
  viewLive,
} from './remote-store';
import { ClockStyleContext } from '../../render/clock-style';
import { namedBackground } from '../../render/named-background';
import { formatClock, validClockStyle } from '../../../../shared/format';
import { Clears } from './Clears';
import { itemLine } from './item-line';
import { LibraryPanel } from './LibraryPanel';
import { LiveLines } from './LiveLines';
import { MessageFields } from './MessageFields';
import { startMirror } from './mirror-store';
import { MoreTools } from './MoreTools';
import { MusicList } from './MusicList';
import { Playing } from './Playing';
import { Props } from './Props';
import { RemotePlaying } from './RemotePlaying';
import { StageScreen } from './StageScreen';
import { Timers } from './Timers';

/*
 * The remote for a phone or tablet (a Remote device): what is on the screens
 * and what comes next, Back and Next always in reach, the clears, black-out,
 * the logo and Put it back, the shown item's slides (tap one to put it up),
 * the playlist, timers and messages. Slides are drawn by the outputs'
 * renderer with the bundled fonts, so Gujarati shapes the same on every
 * phone; pictures and videos are small previews. Each tap takes effect after
 * the one before it (taps.ts).
 *
 * For a presenter (Session 18): the whole library, searched or by name (open
 * a presentation, tap a slide to put it up), the live slide's notes and the
 * next one's under the live picture, and, on a tablet held sideways, the
 * live picture, the notes and Next beside the slides.
 *
 * A mirror of the operator window (Session 54, D5): the clears in its order
 * with its keys' names (Clears.tsx), LIVE's own lines and what is playing
 * under it, the library's media beside its presentations, and More in the
 * window's order: Music, the stage screen, messages, timers, props, Looks,
 * Shastra, the lower thirds and the idle rotation (each in a file of its
 * own here). Never the screens' setup, video inputs, windows or anything
 * that changes the library.
 */

const CANVAS = { width: 1920, height: 1080 };

const post = (path: string, body?: unknown) => () => api<{ rev?: number }>(path, { method: 'POST', body });

/**
 * How the page is laid out: tabs on a phone; on a tablet held upright (or a narrow window), the
 * playlist or the library beside the show; held sideways (or a wide window), the live picture, the
 * notes and Next beside the slides (Session 18).
 */
type RemoteLayout = 'phone' | 'wide' | 'landscape';
const WIDE = '(min-width: 768px)';
const LANDSCAPE = '(min-width: 1000px) and (orientation: landscape)';

function useLayout(): RemoteLayout {
  const read = (): RemoteLayout =>
    matchMedia(LANDSCAPE).matches ? 'landscape' : matchMedia(WIDE).matches ? 'wide' : 'phone';
  const [layout, setLayout] = useState(read);
  useEffect(() => {
    const queries = [matchMedia(LANDSCAPE), matchMedia(WIDE)];
    const on = () => {
      setLayout(read());
    };
    for (const q of queries) q.addEventListener('change', on);
    return () => {
      for (const q of queries) q.removeEventListener('change', on);
    };
  }, []);
  return layout;
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

/**
 * The hall's group's settings in the live Look (Sessions 31–36, SLD-6): the remote shows the slide, and the
 * next one, in its languages, as the hall's screens and the operator's LIVE do.
 */
function useHallLook(state: EngineState | null): LiveGroupLook {
  const groupId = useRemote((s) => s.hall?.groupId ?? null);
  return groupLookIn(state?.look, groupId);
}

/**
 * Which of Main's screens are off, Audience and Stage (Session 50), in words: "Audience off", "Stage off" or
 * both; null while both are on. A phone says so, and cannot turn them (the operator does, in Drashti).
 */
function switchedOffWords(switches: ScreenSwitches | undefined): string | null {
  if (!switches) return null;
  const off = SCREEN_SWITCHES.filter((which) => !switches[which]).map((which) => SWITCH_NAMES[which]);
  return off.length === 0 ? null : `${off.join(' and ')} off`;
}

function LivePicture({ state }: { state: EngineState | null }) {
  const hallLook = useHallLook(state);
  const switchedOff = useRemote((s) => switchedOffWords(s.hall?.switches));
  const up = state
    ? state.layers.slide !== null || state.layers.background !== null || state.layers.pip !== null
    : false;
  const named = namedBackground(state?.layers.background);
  return (
    <section className="space-y-2" aria-labelledby="live-title">
      <div className="flex items-center gap-2">
        <h2 id="live-title" className="flex-1 text-base font-bold tracking-wider text-muted uppercase">
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
          {state && <Scene state={state} canvas={CANVAS} scaling="fit" look={hallLook} />}
        </PlacedInParent>
      </div>
      {/* Audience or Stage off on Main's computer (Session 50): said, with no button (the operator turns it on). */}
      {switchedOff && (
        <div
          role="status"
          data-testid="remote-switched-off"
          className="flex items-center gap-2 rounded-lg border border-warning/60 bg-warning-bg px-3 py-2 text-warning-fg"
        >
          <MonitorOff size={18} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1 text-base">
            <span className="font-bold">{switchedOff}</span> on Drashti’s computer: those screens show its
            desktop until the operator turns them on again.
          </span>
        </div>
      )}
      {/* Another app's window (Session 48) or a video input (Session 50) as the background: named, and cleared
          like any background; a phone can never choose one, nor draw it (it is on Main's computer). */}
      {named && (
        <div
          role="status"
          data-testid={`remote-${named.kind}`}
          className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 py-1 pr-1 pl-3"
        >
          {named.kind === 'window' ? (
            <AppWindow size={18} aria-hidden="true" className="shrink-0 text-muted" />
          ) : (
            <Video size={18} aria-hidden="true" className="shrink-0 text-muted" />
          )}
          <span className="min-w-0 flex-1 truncate text-base">
            <span className="font-bold">{named.label}</span> {named.name}
          </span>
          <Button
            size="lg"
            className="min-h-12"
            instant
            icon={Eraser}
            data-testid={`remote-${named.kind}-clear`}
            onClick={() => void tap(post('/api/v1/clear/background'))}
          >
            Clear
          </Button>
        </div>
      )}
      {/* The picture-in-picture box (Session 50): named, and taken off; a phone never sets one up. */}
      {state?.layers.pip && (
        <div
          role="status"
          data-testid="remote-pip"
          className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 py-1 pr-1 pl-3"
        >
          <PictureInPicture2 size={18} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-base">
            <span className="font-bold">Picture in picture:</span> {pipName(state.layers.pip.source)}
            {state.layers.pip.swapped ? ' (swapped)' : ''}
          </span>
          <Button
            size="lg"
            className="min-h-12"
            instant
            icon={X}
            data-testid="remote-pip-take-off"
            onClick={() => void tap(post('/api/v1/clear/pip'))}
          >
            Take off
          </Button>
        </div>
      )}
      {/* A timer up alone in the slide's place (Session 50): named, and taken off as the slide is. */}
      {state?.layers.slide?.timer && (
        <div
          role="status"
          data-testid="remote-timer-alone"
          className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 py-1 pr-1 pl-3"
        >
          <Timer size={18} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-base">
            <span className="font-bold">Timer:</span> {state.layers.slide.timer.name}
          </span>
          <Button
            size="lg"
            className="min-h-12"
            instant
            icon={Eraser}
            data-testid="remote-timer-clear"
            onClick={() => void tap(post('/api/v1/clear/slide'))}
          >
            Clear
          </Button>
        </div>
      )}
      {/* Repeat Slides going round (Session 26d): which, and Stop (its slide stays up). */}
      {state?.repeat && (
        <div
          role="status"
          data-testid="remote-repeating"
          className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 py-1 pr-1 pl-3"
        >
          <Repeat2 size={18} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-base">
            <span className="font-bold">Repeating</span> · {state.repeat.name}
          </span>
          <Button
            size="lg"
            className="min-h-12"
            instant
            icon={Square}
            data-testid="remote-repeat-stop"
            onClick={() => void tap(post('/api/v1/repeat/stop'))}
          >
            Stop
          </Button>
        </div>
      )}
    </section>
  );
}

function NextLine({ state }: { state: EngineState | null }) {
  const next = state?.next ?? null;
  const hallLook = useHallLook(state);
  return (
    <div className="flex items-center gap-3 text-base" data-testid="remote-next">
      <span className="shrink-0 font-bold tracking-wider text-muted uppercase">Next</span>
      {!next && <span className="text-muted">Nothing after this</span>}
      {next?.kind === 'media' && <span className="truncate text-fg">{next.label}</span>}
      {/* A video input item (Session 51): named; a phone never draws one. */}
      {next?.kind === 'input' && <span className="truncate text-fg">{`Video input: ${next.name}`}</span>}
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
            <SlideView slide={languageView(next.slide, hallLook.languages)} media="still" />
          </PlacedInParent>
        </div>
      )}
    </div>
  );
}

/**
 * The time as Drashti's computer writes it (its locale and time zone, as the stage screens do), and the first
 * running timer, beside the notes, in figures that do not jump (Sessions 31–36, SLD-6).
 */
function ClockAndTimer({ state }: { state: EngineState | null }) {
  const now = useNow();
  const clock = useContext(ClockStyleContext);
  const timer = state?.timers.find((t) => t.kind !== 'clock' && isRunning(t)) ?? null;
  return (
    <div className="flex items-baseline gap-3 text-lg tabular-nums" data-testid="remote-clock-row">
      <span className="font-bold" data-testid="remote-clock">
        {formatClock(now, clock)}
      </span>
      {timer && (
        <span className="min-w-0 truncate text-base text-muted" data-testid="remote-running-timer">
          {timer.name}{' '}
          <span className="font-bold text-fg">
            <TimerText timer={timer} />
          </span>
        </span>
      )}
    </div>
  );
}

/** The live slide's notes and the next slide's, for a presenter; one tap shows or hides them (Session 18). */
function Notes({ state }: { state: EngineState | null }) {
  const open = useRemote((s) => s.notesOpen);
  const live = state?.layers.slide?.notes.trim() ?? '';
  const next = state?.next?.kind === 'slide' ? state.next.notes.trim() : '';
  return (
    <section className="space-y-2" aria-labelledby="notes-title" data-testid="remote-notes-section">
      <div className="flex items-center gap-2">
        <h2 id="notes-title" className="text-base font-bold tracking-wider text-muted uppercase">
          Notes
        </h2>
        <div className="min-w-0 flex-1">
          <ClockAndTimer state={state} />
        </div>
        <Button
          size="lg"
          icon={FileText}
          aria-expanded={open}
          aria-controls="remote-notes"
          data-testid="remote-notes-toggle"
          onClick={() => {
            setNotesOpen(!open);
          }}
        >
          {open ? 'Hide notes' : 'Show notes'}
        </Button>
      </div>
      {open && (
        <div
          id="remote-notes"
          className="space-y-2 rounded-lg border border-line bg-panel-2 px-3 py-2"
          data-testid="remote-notes"
          // The operator's own words: never machine-translated by the phone's browser.
          translate="no"
        >
          <p
            className={cx('text-lg whitespace-pre-wrap', live ? 'text-fg' : 'text-muted')}
            data-testid="remote-notes-live"
            lang={live ? textLang(live) : undefined}
          >
            {live || (state?.layers.slide ? 'No notes on this slide.' : 'No slide on the screens.')}
          </p>
          <p
            className="border-t border-line pt-2 text-base whitespace-pre-wrap text-muted"
            data-testid="remote-notes-next"
          >
            <span className="font-bold">Next: </span>
            {next ? (
              <span lang={textLang(next)}>{next}</span>
            ) : state?.next?.kind === 'slide' ? (
              'no notes'
            ) : (
              'no slide'
            )}
          </p>
        </div>
      )}
    </section>
  );
}

// ---- the shown item's slides -----------------------------------------------------------------

function SlideThumb({
  s,
  live,
  focus,
  onTap,
}: {
  s: OrderedSlide;
  live: boolean;
  /** The slide a search found: brought into view and outlined. */
  focus: boolean;
  onTap: () => void;
}) {
  // The background cue it plays: its last, when it has more than one (Session 52).
  const bg = backgroundCueOf(s.slide.cues);
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
        data-slide-id={s.slide.id}
        data-live={live ? 'true' : undefined}
        data-focus={focus ? 'true' : undefined}
        className={cx(
          'block w-full overflow-hidden rounded-lg border-2 bg-panel-2 text-left',
          live ? 'border-live' : focus ? 'border-accent' : 'border-line',
        )}
      >
        <div className="relative bg-black" aria-hidden="true" data-a11y-picture>
          <PlacedInParent
            content={{ width: s.slide.slide.width, height: s.slide.slide.height }}
            mode="fit"
            className="relative aspect-video w-full"
          >
            <div style={{ position: 'relative', width: s.slide.slide.width, height: s.slide.slide.height }}>
              {/* A picture or video behind it; a video input (Session 51) is Main's alone, never drawn here. */}
              {bg?.background.kind === 'media' && (
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
        <span className="flex items-center gap-1.5 px-2 py-1.5 text-base">
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
  const focusSlideId = useRemote((s) => s.focusSlideId);
  const live = useEngine((s) => s.state?.live ?? null);
  // The live presentation's slide on the screens; a timer up alone (Session 50) is none of its slides.
  const shownIndex = useEngine((s) => {
    const shown = s.state?.layers.slide;
    return shown && !shown.timer ? shown.slideIndex : null;
  });
  // A slide a search found, once its presentation is open: into view.
  useEffect(() => {
    if (!focusSlideId || doc?.id !== viewing?.presentationId) return;
    document
      .querySelector(`[data-testid="remote-slide"][data-slide-id="${CSS.escape(focusSlideId)}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [focusSlideId, doc, viewing]);
  if (!viewing)
    return (
      <p className="text-base text-muted">
        Nothing is live. Choose an item in the playlist or a presentation in the library, or press Next.
      </p>
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
  const otherThanLive = live?.presentationId != null && live.presentationId !== viewing.presentationId;
  return (
    <section className="space-y-2" aria-labelledby="slides-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="slides-title" className="min-w-0 flex-1 truncate text-base font-bold text-fg">
          {doc.name}
        </h2>
        {otherThanLive && (
          <Button size="lg" icon={Tv} data-testid="remote-show-live" onClick={viewLive}>
            On the screens
          </Button>
        )}
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
      {!isLiveItem && !item && (
        <p className="text-base text-muted" data-testid="remote-slides-hint">
          Not on the screens. Tap a slide to put it up.
        </p>
      )}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-testid="remote-slides">
        {order.slides.map((s) => (
          <SlideThumb
            key={`${s.position}`}
            s={s}
            live={isLiveItem && shownIndex === s.position}
            focus={focusSlideId === s.slide.id}
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
  (i.kind === 'shastra' && !i.missing) ||
  (i.kind === 'media' && !i.missing && i.unplayable === null) ||
  // A video input item (Session 51), while Main's computer has one of its name: tapped, it goes up there.
  (i.kind === 'input' && !i.missing);

function Playlist() {
  const playlists = useRemote((s) => s.playlists);
  const playlistId = useRemote((s) => s.playlistId);
  const items = useRemote((s) => s.items);
  const live = useEngine((s) => s.state?.live.playlist ?? null);
  return (
    <section className="space-y-3" aria-labelledby="playlist-title">
      <h2 id="playlist-title" className="text-base font-bold tracking-wider text-muted uppercase">
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
      ) : playlists ? (
        <p className="text-base text-muted">
          There are no playlists yet: they are made in Drashti on the computer, in Pro Mode.
        </p>
      ) : (
        <p role="status" className="text-base text-muted">
          Loading the playlists…
        </p>
      )}
      <ul className="space-y-1.5" data-testid="remote-items">
        {(items ?? []).map((i) => {
          if (i.kind === 'header')
            return (
              <li key={i.id} className="pt-2 text-base font-bold text-muted">
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
                  // A Shastra passage plays like a presentation, its slides in order.
                  else if (i.kind === 'shastra')
                    view({
                      presentationId: i.passageId,
                      item: { playlistId, itemId: i.id, order: { mode: 'all' } },
                    });
                  else void tap(post('/api/v1/trigger/item', { playlistId, itemId: i.id }));
                }}
                className={cx(
                  'flex min-h-12 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-base disabled:opacity-50',
                  isLive ? 'border-live bg-panel-2' : 'border-line bg-panel-2',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-fg">{i.label}</span>
                  <span className="block truncate text-muted">{itemLine(i)}</span>
                </span>
                {i.kind === 'input' && (
                  <Badge tone={i.missing ? 'warning' : 'neutral'} data-testid="remote-item-input">
                    {i.missing ? 'Not on Drashti’s computer' : 'Video input'}
                  </Badge>
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

// ---- the library (Session 18) -----------------------------------------------------------------------

function LibraryRow({
  name,
  detail,
  live,
  onOpen,
}: {
  name: string;
  detail: ReactNode;
  live: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid="remote-library-item"
        data-live={live ? 'true' : undefined}
        className={cx(
          'flex min-h-12 w-full items-center gap-2 rounded-lg border bg-panel-2 px-3 py-2 text-left',
          live ? 'border-live' : 'border-line',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base text-fg" lang={textLang(name)}>
            {name}
          </span>
          {detail && <span className="block truncate text-base text-muted">{detail}</span>}
        </span>
        {live && <LiveBadge />}
      </button>
    </li>
  );
}

/** Where a search found a presentation: its title, a kirtan's detail, or a line of its words (in their language). */
const matchText = (hit: SearchHit): ReactNode =>
  hit.match.kind === 'title' ? (
    hit.libraryName
  ) : hit.match.kind === 'detail' ? (
    <>
      {KIRTAN_FIELD_NAMES[hit.match.field]}: <span lang={textLang(hit.match.value)}>{hit.match.value}</span>
    </>
  ) : (
    <>
      “<span lang={textLang(hit.match.line)}>{hit.match.line}</span>”
    </>
  );

const listedText = (p: RemotePresentation): string =>
  [p.libraryName, p.category, `${String(p.slideCount)} ${p.slideCount === 1 ? 'slide' : 'slides'}`]
    .filter(Boolean)
    .join(' · ');

function Library() {
  const library = useRemote((s) => s.library);
  const liveId = useEngine((s) => s.state?.live.presentationId ?? null);
  const [typed, setTyped] = useState(library.query);
  // The list by name, the first time the library is shown.
  useEffect(() => {
    if (!useRemote.getState().library.list) void loadLibrary();
  }, []);
  // Searched a moment after the last key, as the window does.
  useEffect(() => {
    const timer = setTimeout(() => {
      void searchLibrary(typed);
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);
  const searching = library.query !== '';
  return (
    <section className="space-y-3" aria-labelledby="library-title" data-testid="remote-library">
      {/* Session 54: Shared from Drashti, and Add from this Phone… (PhoneFiles.tsx). */}
      <PhoneFiles />
      <h2 id="library-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Library
      </h2>
      <input
        type="search"
        aria-label="Search the library"
        placeholder="A title, a kavi, or words on a slide"
        value={typed}
        maxLength={200}
        enterKeyHint="search"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => {
          setTyped(e.target.value);
        }}
        className="h-12 w-full rounded-lg border border-field bg-panel-2 px-3 text-base text-fg"
        data-testid="remote-library-search"
      />
      {searching ? (
        library.hits === null ? (
          <p role="status" className="text-base text-muted">
            Searching…
          </p>
        ) : library.hits.length === 0 ? (
          <p className="text-base text-muted" data-testid="remote-library-none">
            Nothing found for “{library.query}”.
          </p>
        ) : (
          <>
            <ul className="space-y-1.5" aria-label="Found">
              {library.hits.map((h) => (
                <LibraryRow
                  key={`${h.presentationId}:${h.match.kind === 'text' ? h.match.slideId : h.match.kind}`}
                  name={h.name}
                  detail={matchText(h)}
                  live={liveId === h.presentationId}
                  onOpen={() => {
                    openPresentation(h.presentationId, h.match.kind === 'text' ? h.match.slideId : null);
                  }}
                />
              ))}
            </ul>
            {library.more && (
              <p className="text-base text-muted">
                More were found than are listed: add a word to narrow it down.
              </p>
            )}
          </>
        )
      ) : library.list === null ? (
        <p role="status" className="text-base text-muted">
          Loading the library…
        </p>
      ) : library.list.length === 0 ? (
        <p className="text-base text-muted">
          The library is empty: presentations are imported in Drashti on the computer, in Pro Mode.
        </p>
      ) : (
        <>
          <ul className="space-y-1.5" aria-label="Presentations">
            {library.list.map((p) => (
              <LibraryRow
                key={p.id}
                name={p.name}
                detail={listedText(p)}
                live={liveId === p.id}
                onOpen={() => {
                  openPresentation(p.id);
                }}
              />
            ))}
          </ul>
          {library.list.length < library.total && (
            <Button
              size="lg"
              className="w-full"
              data-testid="remote-library-more"
              onClick={() => void loadLibrary(true)}
            >
              Show more ({String(library.total - library.list.length)} more)
            </Button>
          )}
        </>
      )}
    </section>
  );
}

/** On a tablet held upright, the playlist or the library beside the show. */
function SidePanel() {
  const side = useRemote((s) => s.side);
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Beside the show" className="grid grid-cols-2 gap-2">
        {(
          [
            { id: 'playlist', label: 'Playlist', icon: ListMusic },
            { id: 'library', label: 'Library', icon: BookOpen },
          ] as const
        ).map((t) => {
          const TabIcon = t.icon;
          const on = side === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              data-testid={`remote-side-${t.id}`}
              onClick={() => useRemote.setState({ side: t.id })}
              className={cx(
                'flex min-h-11 items-center justify-center gap-2 rounded-lg text-base',
                on ? 'bg-panel-3 text-fg' : 'text-muted',
              )}
            >
              <TabIcon size={18} aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" aria-label={side === 'playlist' ? 'Playlist' : 'Library'}>
        {side === 'playlist' ? <Playlist /> : <LibraryPanel presentations={<Library />} />}
      </div>
    </div>
  );
}

// ---- timers and messages -----------------------------------------------------------------------

function MessageRow({ template, shown }: { template: MessageTemplate; shown: boolean }) {
  const fields = templateFields(template.template).filter((n) => fieldOf(template, n).kind === 'text');
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <li className="space-y-2 rounded-lg border border-line bg-panel-2 px-3 py-2" data-testid="remote-message">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-base text-fg">{template.name}</span>
        {shown && <Badge tone="live">On the screens</Badge>}
      </div>
      <p className="text-base text-muted">{template.template}</p>
      <MessageFields template={template} />
      {fields.map((name) => (
        <label key={name} className="block space-y-1">
          <span className="block text-base text-muted">{name}</span>
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
          {shown ? 'Update' : 'Show'}
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
const NO_MESSAGES: EngineState['layers']['messages'] = [];

/** The Looks: tapping one makes it live (every screen group changes at once). */
function Looks() {
  const looks = useRemote((s) => s.looks);
  const liveId = useEngine((s) => s.state?.look.id ?? '');
  if (!looks || looks.length < 2) return null;
  return (
    <section className="space-y-2" aria-labelledby="looks-title">
      <h2 id="looks-title" className="text-base font-bold tracking-wider text-muted uppercase">
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

/** The audio playlist (Session 14): Play and Pause, and the next track; what plays shows as it changes. */
function Music() {
  const audio = useEngine((s) => s.state?.layers.audio ?? null);
  const music = audio?.music ? audio : null;
  const paused = music?.pausedAtMs !== undefined;
  return (
    <section className="space-y-2" aria-labelledby="music-title" data-testid="remote-music">
      <h2 id="music-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Music
      </h2>
      {music && (
        <p className="truncate text-base" role="status">
          {paused ? 'Paused: ' : ''}
          {music.title} <span className="text-muted">({music.music?.name})</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {music && !paused ? (
          <Button size="lg" className="flex-1" onClick={() => void tap(post('/api/v1/music/pause'))}>
            Pause music
          </Button>
        ) : (
          <Button size="lg" className="flex-1" onClick={() => void tap(post('/api/v1/music/play'))}>
            Play music
          </Button>
        )}
        {music && (
          <Button size="lg" onClick={() => void tap(post('/api/v1/music/previous'))}>
            Previous track
          </Button>
        )}
        {music && (
          <Button size="lg" onClick={() => void tap(post('/api/v1/music/next'))}>
            Next track
          </Button>
        )}
      </div>
      <MusicList />
    </section>
  );
}

/** A Shastra passage by its reference (the loaded texts' own abbreviations): it goes up at once. */
function Shastra() {
  const texts = useRemote((s) => s.shastra);
  const [reference, setReference] = useState('');
  if (!texts || texts.length === 0) return null;
  const example = texts[0] ? `${texts[0].abbreviation} 1` : 'SD 14';
  return (
    <section className="space-y-2" aria-labelledby="shastra-title">
      <h2 id="shastra-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Shastra
      </h2>
      <form
        className="flex gap-2"
        data-testid="remote-shastra"
        onSubmit={(e) => {
          e.preventDefault();
          if (reference.trim() !== '') void tap(post('/api/v1/shastra', { reference }));
        }}
      >
        <input
          aria-label="Reference"
          placeholder={example}
          value={reference}
          onChange={(e) => {
            setReference(e.target.value);
          }}
          maxLength={120}
          autoCapitalize="characters"
          spellCheck={false}
          className="h-12 min-w-0 flex-1 rounded-lg border border-field bg-panel-3 px-3 text-base text-fg"
        />
        <Button type="submit" size="lg" variant="primary" className="min-h-12">
          Show
        </Button>
      </form>
      <p className="text-base text-muted">{texts.map((t) => `${t.abbreviation}: ${t.name}`).join(' · ')}</p>
    </section>
  );
}

function TimersAndMessages() {
  const shown = useEngine((s) => s.state?.layers.messages) ?? NO_MESSAGES;
  const templates = useRemote((s) => s.templates);
  return (
    // The operator window's right column in its order (Session 54, D5): Music, the stage screen, messages, timers,
    // props, the Looks and Shastra, then its More tools; in two columns where a tablet has the width for them.
    <div className="@container">
      <div className="@lg:columns-2 @lg:gap-6 [&>*]:mb-5 [&>*]:break-inside-avoid">
        <Music />
        <StageScreen />
        <section className="space-y-2" aria-labelledby="messages-title">
          <h2 id="messages-title" className="text-base font-bold tracking-wider text-muted uppercase">
            Messages
          </h2>
          {!templates || templates.length === 0 ? (
            templates ? (
              <p className="text-base text-muted">
                There are no messages yet: they are made in Drashti on the computer, under Messages in Pro
                Mode.
              </p>
            ) : (
              <p role="status" className="text-base text-muted">
                Loading the messages…
              </p>
            )
          ) : (
            <ul className="space-y-2">
              {templates.map((t) => (
                <MessageRow key={t.id} template={t} shown={shown.some((m) => m.id === messageItemId(t.id))} />
              ))}
            </ul>
          )}
        </section>
        <Timers />
        <Props />
        <Looks />
        <Shastra />
        <MoreTools />
      </div>
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
    // With the revision this phone saw (Sessions 31–36, TST-11): if the show has moved since (another phone,
    // the operator), it does nothing, so two Nexts at once move one slide. And the run it is from (Session 53): a
    // tap before this page has the new run's state, Drashti having just restarted, does nothing either.
    const { rev, session } = useEngine.getState();
    return api<{ rev?: number }>('/api/v1/trigger/next', {
      method: 'POST',
      body: { rev, ...(session !== undefined ? { session } : {}) },
    });
  });
}

const TABS: { id: RemoteTab; label: string; icon: typeof Play }[] = [
  { id: 'show', label: 'Show', icon: Play },
  { id: 'playlist', label: 'Playlist', icon: ListMusic },
  { id: 'library', label: 'Library', icon: BookOpen },
  { id: 'more', label: 'More', icon: Timer },
];

/** On a tablet held sideways, the slides, the playlist, the library or the rest, beside the live picture. */
const PANEL_TABS: { id: RemoteTab; label: string; icon: typeof Play }[] = [
  { id: 'show', label: 'Slides', icon: Play },
  { id: 'playlist', label: 'Playlist', icon: ListMusic },
  { id: 'library', label: 'Library', icon: BookOpen },
  { id: 'more', label: 'More', icon: Timer },
];

function TabRow({ tabs, testId, label }: { tabs: typeof TABS; testId: string; label: string }) {
  const tab = useRemote((s) => s.tab);
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx('grid gap-2', tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}
    >
      {tabs.map((t) => {
        const TabIcon = t.icon;
        const on = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            data-testid={`${testId}-${t.id}`}
            // A word under its icon in the tab bar: 12 px, the one place the phone's text is under 16 (design.md).
            data-small-label
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
  );
}

function BackNext({ wide }: { wide: boolean }) {
  return (
    <div className="shrink-0 border-t border-line bg-panel px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="grid grid-cols-2 gap-3">
        <Button
          size="xl"
          instant
          icon={ChevronLeft}
          onClick={() => void tap(post('/api/v1/trigger/back'))}
          data-testid="remote-back"
        >
          Back
        </Button>
        <Button
          size="xl"
          variant="primary"
          instant
          iconEnd={ChevronRight}
          onClick={() => void next()}
          data-testid="remote-next-button"
        >
          Next
        </Button>
      </div>
      {!wide && (
        <div className="mt-3">
          <TabRow tabs={TABS} testId="remote-tab" label="What to show" />
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
  const layout = useLayout();
  const show = (
    <div className="space-y-4">
      <LivePicture state={state} />
      {/* The time bar for what plays (Session 54), as under LIVE in Drashti. */}
      <RemotePlaying state={state} />
      <LiveLines state={state} />
      <Playing />
      <Notes state={state} />
      <NextLine state={state} />
      <Clears state={state} />
      <Slides />
    </div>
  );
  return (
    // One screen: the header, a middle that scrolls, and Back and Next below it (nothing scrolls under them).
    <div className="flex h-dvh flex-col bg-ink" data-testid="remote" data-layout={layout}>
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-4 py-3">
        <Mark size={36} />
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold tracking-wide text-fg">Drashti remote</p>
          <p className="truncate text-base text-muted">{device?.name ?? current()?.name ?? ''}</p>
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
      {layout === 'landscape' ? (
        // Held sideways: the live picture, the notes and what comes next beside the slides.
        <main className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,40%)_minmax(0,1fr)] gap-6 p-4">
          <div className="min-h-0 space-y-4 overflow-y-auto" data-testid="remote-presenter">
            <LivePicture state={state} />
            <RemotePlaying state={state} />
            <LiveLines state={state} />
            <Playing />
            <Notes state={state} />
            <NextLine state={state} />
            <Clears state={state} />
          </div>
          <div className="flex min-h-0 flex-col gap-3">
            <TabRow tabs={PANEL_TABS} testId="remote-panel" label="Beside the live picture" />
            <div
              className="min-h-0 flex-1 overflow-y-auto"
              role="tabpanel"
              aria-label={PANEL_TABS.find((t) => t.id === tab)?.label}
            >
              {tab === 'show' && <Slides />}
              {tab === 'playlist' && <Playlist />}
              {tab === 'library' && <LibraryPanel presentations={<Library />} />}
              {tab === 'more' && <TimersAndMessages />}
            </div>
          </div>
        </main>
      ) : layout === 'wide' ? (
        <main className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] gap-6 overflow-y-auto p-4">
          <SidePanel />
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
          {tab === 'library' && <LibraryPanel presentations={<Library />} />}
          {tab === 'more' && <TimersAndMessages />}
        </main>
      )}
      <BackNext wide={layout !== 'phone'} />
    </div>
  );
}

export function RemoteApp() {
  const previews = useMemo(() => networkPreviews(), []);
  useEffect(() => {
    void preloadFonts();
    startRemote();
    startMirror();
    startPhoneFiles();
    startFeed();
    void loadPlaylists();
  }, []);
  // Drashti's way of writing the time (Sessions 31–36, I18N-8), for the clocks it draws.
  const given = useRemote((s) => s.hall?.clock ?? null);
  const clock = useMemo(() => validClockStyle(given), [given]);
  return (
    <PreviewsContext.Provider value={previews}>
      <ClockStyleContext.Provider value={clock}>
        <Layout />
      </ClockStyleContext.Provider>
    </PreviewsContext.Provider>
  );
}
