import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { EngineState } from '../../../../shared/engine/state';
import { backgroundCueOf, type PresentationDoc } from '../../../../shared/library';
import { itemPlayOrder, type OrderedSlide, ownOrderItem, playOrder } from '../../../../shared/order';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import { isRunning } from '../../../../shared/timers';
import { useEngine } from '../../engine/engine-store';
import { PhoneStopped } from '../Stopped';
import { preloadFonts } from '../../render/fonts';
import { PlacedInParent } from '../../render/Placed';
import { PreviewPicture, PreviewsContext } from '../../render/previews';
import { pipName } from '../../render/pip';
import { Scene } from '../../render/Scene';
import { textLang } from '../../render/lang';
import { useNow } from '../../render/useNow';
import { groupLookIn, type LiveGroupLook } from '../../../../shared/looks';
import {
  SCREEN_SWITCHES,
  type ScreenSwitch,
  type ScreenSwitches,
  SWITCH_NAMES,
} from '../../../../shared/screen-switches';
import { languageView } from '../../../../shared/language-view';
import { deckSlideAt } from '../../../../shared/deck-show';
import { nextCaption } from '../../../../shared/next-caption';
import { isPhoneDeck } from '../../../../shared/phone-decks';
import { PHONE_REFUSAL } from '../../../../shared/phone-rule';
import { SlideView } from '../../render/SlideView';
import { TimerText } from '../../render/TimerText';
import { Mark } from '../../ui/Mark';
import { Badge, LiveBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import {
  AppWindow,
  ChevronLeft,
  ChevronRight,
  FileText,
  ListMusic,
  MessageCircle,
  MonitorOff,
  PictureInPicture2,
  Play,
  Repeat2,
  Timer,
  Video,
} from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { api, current } from '../device';
import { startFeed, useFeed } from '../feed';
import { ConnectionChip } from '../Connection';
import { networkPreviews } from '../previews';
import { tap, useTapNotice } from '../taps';
import { DeviceViewer } from '../viewer/DeviceViewer';
import { LookCloser, LookOverlay, LookThrough } from '../viewer/LookCloser';
import { type RemoteTab, setNotesOpen, startRemote, useRemote, type Viewing } from './remote-store';
import { ClockStyleContext } from '../../render/clock-style';
import { namedBackground } from '../../render/named-background';
import { formatClock, validClockStyle } from '../../../../shared/format';
import { Clears } from './Clears';
import { LiveLines } from './LiveLines';
import type { RemoteSimple } from '../../../../shared/network-phone';
import { FlowLayer, FlowSection } from './FlowSheet';
import { type RemoteLayout, useLayout } from './layout';
import {
  deckLiveIn,
  focusesShow,
  focusWatch,
  phoneControls,
  type PhoneControls,
  TIMER_ALONE_WORDS,
} from './phone-mode';
import { PlaylistTab } from './PlaylistTab';
import { useSimple } from './simple';
import { Swipes, type SwipeWay } from './swipe';
import { ChatBanner, ChatPanel, useUnread } from '../chat/ChatView';
import { chatShowOnScreen, startChat, useChat } from '../chat/chat-store';

/*
 * The remote for a phone or tablet (a Remote device). Since alpha.23 (QA23-PHONE-1, the owner's words: "no video
 * access in either of simple or pro mode in phone, they cant change videos, only ppts an pdfs, that also in pro mode,
 * in simple mode only show the flow, whats running in live, and chat. pro contains more features than simple", then
 * "Only PPT and PDF"), by the computer's mode (phone-mode.ts):
 * - Simple Mode: the Show tab, what is on the screens as a view (Look closer, zoomed on this device only), LIVE's own
 *   lines, the notes, what comes next and the Sabha flow; and the Chat. No control at all.
 * - Pro Mode: that, the Playlist tab (the open playlist's PowerPoints and PDFs), their slides to put up, and Back and
 *   Next (and a swipe on the live picture) and Clear slide while one is live, inside it.
 * Slides are drawn by the outputs' renderer with the bundled fonts, so Gujarati shapes the same on every phone;
 * pictures are small previews. Each tap takes effect after the one before it (taps.ts). Until alpha.23 the remote
 * also had the library, More (the computer's screens, music, the stage screen, messages, timers, the books and the
 * lower thirds), the quick bar, every clear, black-out, the wallpaper, the time bar and what plays: the network refuses
 * them from a phone now, and their files here (Clears' other clears, QuickBar, RemotePlaying, Playing, DesktopTools,
 * PhoneToolsLayer, Media, LibraryPanel, PhoneFiles, MoreTools, StageScreen, Timers, Wallpapers…) are no longer drawn.
 */

const CANVAS = { width: 1920, height: 1080 };

const post = (path: string, body?: unknown) => () => api<{ rev?: number }>(path, { method: 'POST', body });

/** The first line of a slide's words, for its name read out. */
const firstLine = (s: OrderedSlide): string =>
  s.slide.slide.elements
    .flatMap((e) => (e.kind === 'text' ? [e.text.split('\n')[0] ?? ''] : []))[0]
    ?.trim() ?? '';

// ---- what is on the screens ---------------------------------------------------------------------

/**
 * The hall's group's settings (Sessions 31–36, SLD-6): the remote shows the slide, and the
 * next one, in its languages, as the hall's screens and the operator's LIVE do.
 */
function useHallLook(state: EngineState | null): LiveGroupLook {
  const groupId = useRemote((s) => s.hall?.groupId ?? null);
  return groupLookIn(state?.look, groupId);
}

/** What a switch's screens show while it is off (Session 55: the stage screens stay, showing the audience picture). */
const OFF_SHOWS: Readonly<Record<ScreenSwitch, string>> = {
  audience: 'the hall’s screens show its desktop',
  stage: 'the stage screens show the audience picture',
};

/**
 * Which of Main's screens are off, Audience and Stage (Session 50), in words: "Audience off", "Stage off" or
 * both, and what those screens show until they are on again; null while both are on. A phone says so beside its
 * live picture (More turns them on again, Session 54, as the operator does in Drashti).
 */
function switchedOffWords(switches: ScreenSwitches | undefined): { title: string; shows: string } | null {
  if (!switches) return null;
  const off = SCREEN_SWITCHES.filter((which) => !switches[which]);
  const [only] = off;
  if (only === undefined) return null;
  if (off.length === 1)
    return {
      title: `${SWITCH_NAMES[only]} off`,
      shows: `${OFF_SHOWS[only]} until ${SWITCH_NAMES[only]} is on again.`,
    };
  return {
    title: `${off.map((which) => SWITCH_NAMES[which]).join(' and ')} off`,
    shows: `${OFF_SHOWS.audience}, and the stage screens the audience picture, until they are on again.`,
  };
}

/**
 * Swipes on the live picture (Session 55, Part 9): the finger moving left is Next, moving right is Back, like turning
 * a page; two fingers (zooming) never count, nor a drag up or down (the page scrolls: touch-action keeps that the
 * browser's), and a tap still looks closer. The buttons stay. Each goes in turn, as the buttons' taps do. Since alpha.23
 * only in Pro Mode while a PowerPoint or a PDF is live, as Back and Next are (`enabled`, phone-mode.ts).
 */
function useSwipes(enabled: boolean): {
  handlers: Record<
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel',
    (e: ReactPointerEvent<HTMLElement>) => void
  >;
  swiped: SwipeWay | null;
  justSwiped: (at: number) => boolean;
} {
  const swipes = useRef(new Swipes());
  const [swiped, setSwiped] = useState<SwipeWay | null>(null);
  useEffect(() => {
    if (!swiped) return;
    const timer = setTimeout(() => {
      setSwiped(null);
    }, 450);
    return () => {
      clearTimeout(timer);
    };
  }, [swiped]);
  return {
    swiped,
    justSwiped: (at) => swipes.current.justSwiped(at),
    handlers: {
      onPointerDown: (e) => {
        swipes.current.down(e);
      },
      onPointerMove: (e) => {
        swipes.current.move(e);
      },
      onPointerUp: (e) => {
        const way = swipes.current.up(e);
        if (!way || !enabled) return;
        setSwiped(way);
        if (way === 'next') void next();
        else void tap(post('/api/v1/trigger/back'));
      },
      onPointerCancel: (e) => {
        swipes.current.cancel(e);
      },
    },
  };
}

/**
 * On a phone held sideways (alpha.21, the fit pass): the live picture no wider than lets it, with its heading, stand
 * whole in the middle under the header (about 9.5rem of the screen's height), centred.
 */
const SIDEWAYS_PICTURE = { maxWidth: 'calc((100dvh - 9.5rem) * 16 / 9)' } as const;

/** A line under the live picture saying what else is up (a window, a box, a timer, Repeat Slides): said, never changed. */
function UpLine({
  testId,
  icon: LineIcon,
  children,
}: {
  testId: string;
  icon: typeof Play;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="flex min-h-12 items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-1"
    >
      <LineIcon size={18} aria-hidden="true" className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate text-base">{children}</span>
    </div>
  );
}

function LivePicture({
  state,
  sideways = false,
  swipes = false,
}: {
  state: EngineState | null;
  sideways?: boolean;
  /** A swipe turns the page (Pro Mode, a PowerPoint or a PDF live: phone-mode.ts). */
  swipes?: boolean;
}) {
  const translationGroupId = useRemote((s) => s.hall?.groupId ?? null);
  const hallLook = useHallLook(state);
  const { handlers, swiped, justSwiped } = useSwipes(swipes);
  // The switches as the store has them (one object until the next answer), put in words here.
  const switchedOff = switchedOffWords(useRemote((s) => s.hall?.switches));
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
        ) : state?.wallpaper ? (
          <Badge tone="live">Wallpaper</Badge>
        ) : up ? (
          <LiveBadge />
        ) : null}
        {/* Session 54 (D1): larger and sharp, zoomed on this device only (alpha.23: never on the screens). */}
        <LookCloser />
      </div>
      <div
        className={cx(
          'relative overflow-hidden rounded-lg border-2 bg-black [touch-action:pan-y_pinch-zoom] select-none',
          up && !state?.blackout ? 'border-live' : 'border-line-strong',
          sideways && 'mx-auto',
        )}
        style={sideways ? SIDEWAYS_PICTURE : undefined}
        data-testid="remote-live"
        data-a11y-picture
        aria-hidden="true"
        {...(swipes ? handlers : {})}
      >
        <PlacedInParent content={CANVAS} mode="fit" className="relative aspect-video w-full">
          {state && (
            <Scene
              state={state}
              canvas={CANVAS}
              scaling="fit"
              look={hallLook}
              translationGroupId={translationGroupId}
            />
          )}
        </PlacedInParent>
        <LookOverlay ignore={justSwiped} />
        {/* The page turned: said for a moment over the picture (the buttons say it to a screen reader). */}
        {swiped && (
          <span
            className="pointer-events-none absolute top-1/2 rounded-full bg-black/70 px-4 py-2 text-base font-bold text-white"
            style={swiped === 'next' ? { right: '0.75rem' } : { left: '0.75rem' }}
            data-testid="remote-swiped"
            data-way={swiped}
          >
            {swiped === 'next' ? 'Next ›' : '‹ Back'}
          </span>
        )}
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
            <span className="font-bold">{switchedOff.title}</span> on Drashti’s computer: {switchedOff.shows}
          </span>
        </div>
      )}
      {/* What else is up, said only (alpha.23, QA23-PHONE-1: until then each had its clear here): another app's
          window, a video input or a stream link as the background (a phone never draws one: it is on Main's
          computer), the picture-in-picture box, a timer for the audience or in the slide's place, Repeat Slides. */}
      {named && (
        <UpLine testId={`remote-${named.kind}`} icon={named.kind === 'window' ? AppWindow : Video}>
          <span className="font-bold">{named.label}</span> {named.name}
        </UpLine>
      )}
      {state?.layers.pip && (
        <UpLine testId="remote-pip" icon={PictureInPicture2}>
          <span className="font-bold">Picture in picture:</span> {pipName(state.layers.pip.source)}
          {state.layers.pip.swapped ? ' (swapped)' : ''}
        </UpLine>
      )}
      {state?.layers.timer && (
        <UpLine testId="remote-audience-timer" icon={Timer}>
          <span className="font-bold">Timer for the audience:</span>{' '}
          {state.timers.find((t) => t.id === state.layers.timer?.timerId)?.name ?? 'Timer'}
        </UpLine>
      )}
      {state?.layers.slide?.timer && (
        <UpLine testId="remote-timer-alone" icon={Timer}>
          <span className="font-bold">Timer:</span> {state.layers.slide.timer.name}
        </UpLine>
      )}
      {state?.repeat && (
        <UpLine testId="remote-repeating" icon={Repeat2}>
          <span className="font-bold">Repeating</span> · {state.repeat.name}
        </UpLine>
      )}
    </section>
  );
}

function NextLine({ state }: { state: EngineState | null }) {
  const next = state?.next ?? null;
  const hallLook = useHallLook(state);
  // The window's caption, in its words (Session 54, D5 review): the next slide by its item's name (when this phone
  // shows that playlist) or its presentation's, the next item, a deck's click, a missing file or sound.
  const label = useRemote((s) =>
    next?.kind === 'slide'
      ? ((next.itemId ? s.items?.find((i) => i.id === next.itemId)?.label : undefined) ??
        (s.doc?.id === next.presentationId ? s.doc.name : undefined) ??
        null)
      : null,
  );
  return (
    <div className="flex items-center gap-3 text-base" data-testid="remote-next">
      <span className="shrink-0 font-bold tracking-wider text-muted uppercase">Next</span>
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
            <SlideView
              slide={languageView(deckSlideAt(next.slide, next.step ?? 0), hallLook.languages)}
              media="still"
            />
          </PlacedInParent>
        </div>
      )}
      {/* A video input item (Session 51) is named; a phone never draws one. */}
      <span
        className={cx('min-w-0 flex-1', next ? 'text-fg' : 'text-muted')}
        data-testid="remote-next-caption"
      >
        {nextCaption(next, { label })}
      </span>
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
  dimmed = false,
}: {
  s: OrderedSlide;
  live: boolean;
  /** The slide a search found: brought into view and outlined. */
  focus: boolean;
  onTap: () => void;
  /** Not to be put up from here (a23-review-phoneui MUST-2: from no row of this playlist, or a timer shown alone). */
  dimmed?: boolean;
}) {
  // The background cue it plays: its last, when it has more than one (Session 52).
  const bg = backgroundCueOf(s.slide.cues);
  const words = firstLine(s);
  return (
    <li>
      <button
        type="button"
        onClick={onTap}
        disabled={dimmed}
        aria-pressed={live}
        aria-label={`${s.group.name} ${s.position + 1}${words ? `: ${words}` : ''}${live ? ', on the screens' : ''}`}
        data-testid="remote-slide"
        data-position={s.position}
        data-slide-id={s.slide.id}
        data-live={live ? 'true' : undefined}
        data-focus={focus ? 'true' : undefined}
        className={cx(
          'block w-full overflow-hidden rounded-lg border-2 bg-panel-2 text-left disabled:opacity-50',
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
        <span className="flex items-start gap-1.5 px-2 py-1.5 text-base">
          <span
            aria-hidden="true"
            className="mt-1.5 h-3 w-1.5 shrink-0 rounded-sm"
            style={{ background: s.group.color ?? '#4b5563' }}
          />
          {/* Whole, on two lines where it must (alpha.21, the fit pass: beside LIVE a phone's tile cut "1 · Verse 1"). */}
          <span className="min-w-0 flex-1 break-words text-fg">
            {s.position + 1} · {s.slide.label || s.group.name}
          </span>
          {live && <LiveBadge />}
        </span>
      </button>
    </li>
  );
}

/** What the slides shown are drawn from: the remote's store (remote-store.ts), and what is live. */
export interface SlidesShown {
  viewing: Viewing | null;
  doc: PresentationDoc | null;
  items: PlaylistItemInfo[] | null;
  /** A slide a search or a row found: brought into view and outlined. */
  focusSlideId: string | null;
  live: EngineState['live'] | null;
  /** The live presentation's slide on the screens (a timer up alone is none of its slides). */
  shownIndex: number | null;
  /** A timer shown alone in the slide's place: Drashti refuses a phone's every deck command then. */
  timerAlone: boolean;
}

/**
 * Said where the PDF shown is not from this phone's playlist row, so its pages are not put up here (a23-review-phoneui
 * LOW-2): while it is up, by whoever put it up (the computer, another phone from its own playlist), Back and Next go
 * through it; once it is not, nothing is promised.
 */
const NOT_FROM_HERE = 'Not from this phone’s playlist: Back and Next go through it here.';
const NOT_UP_NOW = 'Not on the screens now.';

/** The slides shown (Pro Mode only, phone-mode.ts), from the remote's store. */
function Slides() {
  const viewing = useRemote((s) => s.viewing);
  const doc = useRemote((s) => s.doc);
  const items = useRemote((s) => s.items);
  const focusSlideId = useRemote((s) => s.focusSlideId);
  const live = useEngine((s) => s.state?.live ?? null);
  const shownIndex = useEngine((s) => {
    const shown = s.state?.layers.slide;
    return shown && !shown.timer ? shown.slideIndex : null;
  });
  const timerAlone = useEngine((s) => Boolean(s.state?.layers.slide?.timer));
  // A slide a search found, once its presentation is open: into view.
  useEffect(() => {
    if (!focusSlideId || doc?.id !== viewing?.presentationId) return;
    document
      .querySelector(`[data-testid="remote-slide"][data-slide-id="${CSS.escape(focusSlideId)}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [focusSlideId, doc, viewing]);
  return (
    <SlidesView
      viewing={viewing}
      doc={doc}
      items={items}
      focusSlideId={focusSlideId}
      live={live}
      shownIndex={shownIndex}
      timerAlone={timerAlone}
    />
  );
}

/** The words while no PowerPoint or PDF is shown (the network's own, phone-rule.ts). */
const NO_DECK_SHOWN = PHONE_REFUSAL.noDeck;

/**
 * The live PowerPoint's or PDF's slides, a tap putting one up (QA23-PHONE-1: only a PowerPoint or a PDF goes up from a
 * phone; a kirtan's, words' or a passage's slides are not shown here, nor the library's presentations).
 */
export function SlidesView({ viewing, doc, items, focusSlideId, live, shownIndex, timerAlone }: SlidesShown) {
  if (!viewing || (doc?.id === viewing.presentationId && !isPhoneDeck(doc)))
    return (
      <p className="text-base text-muted" data-testid="remote-slides-none">
        {NO_DECK_SHOWN}
      </p>
    );
  if (doc?.id !== viewing.presentationId) return <p className="text-base text-muted">Opening…</p>;
  const isLiveItem =
    live?.presentationId === viewing.presentationId &&
    (viewing.item ? live.playlist?.itemId === viewing.item.itemId : live.playlist === null);
  // This PDF up at all (from any row, the library or this phone's own playlist row).
  const deckLive = live?.presentationId === viewing.presentationId;
  const item = viewing.item;
  // A page goes up from a phone only from this playlist's row, and never while a timer is shown alone over it
  // (a23-review-phoneui MUST-2: Drashti refuses a phone the rest; from no row, a page would also come off the
  // operator's playlist row).
  const tappable = item !== null && !timerAlone;
  // The item's order as the playlist has it now (Session 55, Part 4b: its own order of slides changes as rows are
  // dragged), else as it was when it was opened.
  const found = item ? items?.find((i) => i.id === item.itemId) : undefined;
  const itemNow = found?.kind === 'presentation' ? found.order : item?.order;
  // The live item's as the engine plays it; its own order of slides ("item:<id>") as the playlist keeps it.
  const order =
    isLiveItem && ownOrderItem(live.arrangementId) === null
      ? playOrder(doc, live.arrangementId)
      : item && itemNow
        ? itemPlayOrder(doc, itemNow, item.itemId)
        : playOrder(doc, doc.selectedArrangementId);
  return (
    <section className="@container space-y-2" aria-labelledby="slides-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="slides-title" className="min-w-48 flex-1 text-base font-bold break-words text-fg">
          {doc.name}
        </h2>
        {/* Session 54 (D1): its slides (a deck's or a PDF's pages) one by one on this device, sharp and zoomed. */}
        <LookThrough
          presentationId={doc.id}
          name={doc.name}
          slides={order.slides}
          from={
            isLiveItem && shownIndex !== null
              ? shownIndex
              : (order.slides.find((s) => s.slide.id === focusSlideId)?.position ?? 0)
          }
        />
        {item && !isLiveItem && !timerAlone && (
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
      {timerAlone ? (
        <p className="text-base text-muted" data-testid="remote-slides-hint">
          {TIMER_ALONE_WORDS}
        </p>
      ) : !item ? (
        <p className="text-base text-muted" data-testid="remote-slides-hint">
          {deckLive ? NOT_FROM_HERE : NOT_UP_NOW}
        </p>
      ) : (
        !deckLive && (
          <p className="text-base text-muted" data-testid="remote-slides-hint">
            Not on the screens. Tap a slide to put it up.
          </p>
        )
      )}
      <ul className="grid grid-cols-2 gap-2 @md:grid-cols-3 @3xl:grid-cols-4" data-testid="remote-slides">
        {order.slides.map((s) => (
          <SlideThumb
            key={`${s.position}`}
            s={s}
            live={deckLive && (isLiveItem || !item) && shownIndex === s.position}
            focus={focusSlideId === s.slide.id}
            dimmed={!tappable}
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

/** A tab's word and icon, under the middle; beside the live picture on a tablet held sideways, 'show' is its slides. */
const TAB: Readonly<Record<RemoteTab, { label: string; panel: string; icon: typeof Play }>> = {
  show: { label: 'Show', panel: 'Slides', icon: Play },
  playlist: { label: 'Playlist', panel: 'Playlist', icon: ListMusic },
  // The day's chat of the paired phones, in Pro Mode and Simple Mode alike (alpha.23, QA23-CHAT-1).
  chat: { label: 'Chat', panel: 'Chat', icon: MessageCircle },
};

/** On a tablet held upright, beside the show: the playlist (Pro Mode), or the chat. */
function SidePanel({ controls }: { controls: PhoneControls }) {
  const chosen = useRemote((s) => s.side);
  const side = controls.sides.includes(chosen) ? chosen : (controls.sides[0] ?? 'chat');
  const unread = useUnread();
  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Beside the show"
        className={cx('grid gap-2', controls.sides.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}
      >
        {controls.sides.map((id) => {
          const TabIcon = TAB[id].icon;
          const on = side === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              data-testid={`remote-side-${id}`}
              onClick={() => useRemote.setState({ side: id })}
              className={cx(
                'relative flex min-h-11 items-center justify-center gap-2 rounded-lg text-base',
                on ? 'bg-panel-3 text-fg' : 'text-muted',
              )}
            >
              <TabIcon size={18} aria-hidden="true" />
              {TAB[id].label}
              {id === 'chat' && <UnreadCount count={unread} />}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" aria-label={TAB[side].label}>
        {side === 'playlist' && <PlaylistTab />}
        {side === 'chat' && <ChatPanel fill={false} />}
      </div>
    </div>
  );
}

// ---- the page ----------------------------------------------------------------------------------

/**
 * What the phone offers in Simple Mode (QA23-PHONE-1: the Sabha flow, what is on the screens and the chat), in the
 * network's own words for a phone there (phone-rule.ts). Dismissed, the note stays away until Simple Mode next comes on.
 */
function SimpleNote({ className }: { className: string }) {
  const simple = useSimple();
  const said = useRemote((s) => s.simpleSaid);
  if (!simple || said) return null;
  return (
    <div className={className}>
      <Notice
        tone="info"
        role="status"
        data-testid="remote-simple"
        onDismiss={() => {
          useRemote.setState({ simpleSaid: true });
        }}
      >
        {PHONE_REFUSAL.simple}
      </Notice>
    </div>
  );
}

/**
 * Next, inside the PowerPoint or PDF live (Drashti keeps it inside: the owner's Q6), with the revision this phone saw
 * (Sessions 31–36, TST-11): if the show has moved since (another phone, the operator), it does nothing, so two Nexts
 * at once move one slide. And the run it is from (Session 53): a tap before this page has the new run's state, Drashti
 * having just restarted, does nothing either. Until alpha.23, with nothing live it started the shown playlist.
 */
function next(): Promise<void> {
  return tap(() => {
    const { rev, session } = useEngine.getState();
    return api<{ rev?: number }>('/api/v1/trigger/next', {
      method: 'POST',
      body: { rev, ...(session !== undefined ? { session } : {}) },
    });
  });
}

/** How many chat messages are not seen yet, beside the Chat tab's word (said in words for a screen reader). */
function UnreadCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      data-badge
      data-testid="chat-unread"
      className="absolute top-0.5 right-1 min-w-5 rounded-full bg-accent px-1 text-center text-xs leading-5 font-bold text-ink"
    >
      {count > 99 ? '99+' : count}
      <span className="sr-only"> not read</span>
    </span>
  );
}

/** The grid for a row of n tabs (Tailwind keeps whole class names). */
const COLUMNS = ['grid-cols-1', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3'] as const;

function TabRow({
  tabs,
  active,
  testId,
  label,
  panel = false,
  square = false,
}: {
  tabs: readonly RemoteTab[];
  /** The tab shown now. */
  active: RemoteTab;
  testId: string;
  label: string;
  /** Beside the live picture on a tablet held sideways: 'show' is its slides there. */
  panel?: boolean;
  /** Two by two (a phone held sideways, beside the middle), not in one row. */
  square?: boolean;
}) {
  const unread = useUnread();
  return (
    <div
      role="tablist"
      aria-label={label}
      // In one row under the middle, or (a phone held sideways, beside it) two by two, as before alpha.23's fewer tabs.
      className={cx('grid gap-2', square ? 'grid-cols-2' : (COLUMNS[tabs.length] ?? 'grid-cols-3'))}
    >
      {tabs.map((id) => {
        const TabIcon = TAB[id].icon;
        const on = id === active;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            data-testid={`${testId}-${id}`}
            // A word under its icon in the tab bar: 12 px, the one place the phone's text is under 16 (design.md).
            data-small-label
            onClick={() => useRemote.setState({ tab: id })}
            className={cx(
              'relative flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-xs',
              on ? 'bg-panel-3 text-fg' : 'text-muted',
            )}
          >
            <TabIcon size={18} aria-hidden="true" />
            {panel ? TAB[id].panel : TAB[id].label}
            {id === 'chat' && <UnreadCount count={unread} />}
          </button>
        );
      })}
    </div>
  );
}

/** The tab shown: the one chosen, while the mode has it (Simple Mode coming on leaves the Playlist), else the first. */
const shownTab = (chosen: RemoteTab, tabs: readonly RemoteTab[]): RemoteTab =>
  tabs.includes(chosen) ? chosen : (tabs[0] ?? 'show');

/**
 * Back and Next (Pro Mode, while a PowerPoint or a PDF is live: phone-mode.ts), and on a phone its tabs: under the
 * middle, or on a phone held sideways at its side (alpha.21), Back over Next and the tabs, where a thumb holding the
 * phone reaches them, the middle keeping the height. Nothing at all on a tablet with neither.
 */
export function BackNext({ layout, controls }: { layout: RemoteLayout; controls: PhoneControls }) {
  const wide = layout === 'wide' || layout === 'landscape';
  const sideways = layout === 'sideways';
  const chosen = useRemote((s) => s.tab);
  if (wide && !controls.backNext) return null;
  return (
    <div
      className={
        sideways
          ? 'flex w-52 shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-panel py-3 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-3'
          : 'shrink-0 border-t border-line bg-panel px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
      }
      data-testid="remote-back-next"
    >
      {controls.backNext && (
        <div className={cx('grid gap-3', sideways ? 'mt-auto grid-cols-1' : 'grid-cols-2')}>
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
      )}
      {!wide && (
        <div
          className={
            sideways ? (controls.backNext ? undefined : 'mt-auto') : controls.backNext ? 'mt-3' : undefined
          }
        >
          <TabRow
            tabs={controls.tabs}
            active={shownTab(chosen, controls.tabs)}
            testId="remote-tab"
            label="What to show"
            square={sideways}
          />
        </div>
      )}
    </div>
  );
}

/**
 * What is live and around it, the Show tab's (QA23-PHONE-1, phone-mode.ts): the live picture as a view (a swipe turns
 * the page only where Back and Next are), LIVE's own lines, the notes, what comes next, Clear slide (Pro Mode, a
 * PowerPoint or a PDF live), the Sabha flow (always, the owner's Q3), and (`withSlides`) the live PowerPoint's or PDF's
 * slides in Pro Mode. `simple` and `controls` are given, so a test can draw either mode.
 */
export function ShowColumn({
  state,
  simple,
  controls,
  sideways = false,
  withSlides,
}: {
  state: EngineState | null;
  simple: RemoteSimple | null;
  controls: PhoneControls;
  sideways?: boolean;
  withSlides: boolean;
}) {
  return (
    <div className="space-y-4" data-mode={simple ? 'simple' : 'pro'}>
      <LivePicture state={state} sideways={sideways} swipes={controls.swipes} />
      <LiveLines state={state} />
      <Notes state={state} />
      <NextLine state={state} />
      {controls.clearSlide && <Clears state={state} only={SLIDE_ONLY} />}
      <FlowSection />
      {withSlides && controls.slides && <Slides />}
    </div>
  );
}

/** The one clear a phone has (the owner's Q7). */
const SLIDE_ONLY = ['slide'] as const;

/**
 * A tap's notice. In a sideways phone's middle, which scrolls, it is brought into view as it comes (a23-review-phoneui
 * S2: with the middle scrolled down to the pages, a refused tap's words were off the screen).
 */
function TapNotice({ text, className, inMiddle }: { text: string; className: string; inMiddle: boolean }) {
  const at = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (inMiddle) at.current?.scrollIntoView({ block: 'nearest' });
  }, [text, inMiddle]);
  return (
    <div ref={at} className={className}>
      <Notice tone="warning" onDismiss={() => useTapNotice.setState({ text: null })}>
        {text}
      </Notice>
    </div>
  );
}

function Layout() {
  const chosen = useRemote((s) => s.tab);
  const state = useEngine((s) => s.state);
  const notice = useTapNotice((s) => s.text);
  const device = useFeed((s) => s.device);
  const simple = useSimple();
  const doc = useRemote((s) => s.doc);
  const items = useRemote((s) => s.items);
  const controls = phoneControls(simple, simple === null && deckLiveIn(state, doc, items));
  const layout = useLayout();
  const sideways = layout === 'sideways';
  const tab = shownTab(chosen, controls.tabs);
  const panelTab = shownTab(chosen, controls.panelTabs);
  // Simple Mode coming on over Pro Mode's controls takes away what had the focus (Back, Next, a row, a tile): it goes to
  // the Show tab, never left on the page itself. Never as a page opens in Simple Mode (a23-review-phoneui LOW-3: a
  // screen reader's cursor would move on its own as the page loads), and only when an element had the focus and went
  // (QA24-PHONE-B: on an iPhone a tap focuses no button, and VoiceOver's cursor jumped to Show at every switch).
  const inSimple = simple !== null;
  const hallHeard = useRemote((s) => s.hall !== null);
  const simpleBefore = useRef<boolean | null>(null);
  const [focus] = useState(() => focusWatch<Element>());
  useEffect(() => {
    const took = (e: FocusEvent) => focus.took(e.target instanceof Element ? e.target : null);
    const left = (e: FocusEvent) => focus.left(e.target instanceof Element ? e.target : null);
    document.addEventListener('focusin', took);
    document.addEventListener('focusout', left);
    return () => {
      document.removeEventListener('focusin', took);
      document.removeEventListener('focusout', left);
    };
  }, [focus]);
  useEffect(() => {
    if (!hallHeard) return;
    if (
      focusesShow(simpleBefore.current, inSimple, focus.wentAway()) &&
      document.activeElement === document.body
    )
      document.querySelector<HTMLElement>('[data-testid="remote-tab-show"]')?.focus();
    simpleBefore.current = inSimple;
  }, [inSimple, hallHeard, focus]);
  // A view of the show on the screen (a tablet's show column or presenter column, or the Show tab): the chat brings
  // no banner then (it would move or cover the show's controls under the finger) and no sound (a22-review-chat P-M1).
  const showOnScreen = layout === 'wide' || layout === 'landscape' || tab === 'show';
  useEffect(() => {
    chatShowOnScreen(showOnScreen);
  }, [showOnScreen]);
  // While the feed is up only: the connection's chip under it says so the moment it is not (a22-review-chat nit).
  const online = useFeed((s) => s.state === 'online');
  const chatBanner = useChat((s) => s.banner !== null) && online;
  const show = (
    <ShowColumn state={state} simple={simple} controls={controls} sideways={sideways} withSlides />
  );
  // A tap's notice and Simple Mode's note: over the middle; on a phone held sideways, at the top of the middle itself,
  // which scrolls (CI run 45610620870: over it they left the middle shorter than the live picture at 740 x 360).
  const notes = (inMiddle: boolean) => {
    const place = inMiddle ? 'mb-4' : 'shrink-0 px-4 pt-3';
    return (
      <>
        {notice && <TapNotice text={notice} className={place} inMiddle={inMiddle} />}
        <SimpleNote className={place} />
      </>
    );
  };
  const tabbed = (
    <>
      {tab === 'show' && show}
      {tab === 'playlist' && <PlaylistTab />}
      {tab === 'chat' && <ChatPanel fill />}
    </>
  );
  return (
    // One screen: the header, a middle that scrolls, and Back and Next below it (nothing scrolls under them); on a
    // phone held sideways, beside it.
    <div className="flex h-dvh flex-col bg-ink" data-testid="remote" data-layout={layout}>
      <header
        className={cx(
          'relative flex shrink-0 items-center gap-3 border-b border-line bg-panel px-4',
          sideways ? 'py-2' : 'py-3',
        )}
      >
        {/* Under a chat message's banner, which takes the header's place for a moment: nothing below it moves. */}
        <div className={cx('flex min-w-0 flex-1 items-center gap-3', chatBanner && 'invisible')}>
          <Mark size={36} />
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold tracking-wide text-fg">Drashti remote</p>
            <p className="truncate text-base text-muted">{device?.name ?? current()?.name ?? ''}</p>
          </div>
          <ConnectionChip />
        </div>
        {/* A new chat message from someone else, off the show and the chat: a tap opens Chat. */}
        {online && (
          <ChatBanner
            onOpen={() => {
              useRemote.setState({ tab: 'chat' });
            }}
          />
        )}
      </header>
      {!sideways && notes(false)}
      {layout === 'landscape' ? (
        // Held sideways: the live picture, the notes and what comes next beside the slides, the playlist or the chat.
        <main className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,40%)_minmax(0,1fr)] gap-6 p-4">
          <div className="relative min-h-0 overflow-y-auto" data-testid="remote-presenter">
            <ShowColumn state={state} simple={simple} controls={controls} withSlides={false} />
          </div>
          <div className="flex min-h-0 flex-col gap-3">
            <TabRow
              tabs={controls.panelTabs}
              active={panelTab}
              testId="remote-panel"
              label="Beside the live picture"
              panel
            />
            <div
              className="relative min-h-0 flex-1 overflow-y-auto"
              role="tabpanel"
              aria-label={TAB[panelTab].panel}
            >
              {panelTab === 'show' && <Slides />}
              {panelTab === 'playlist' && <PlaylistTab />}
              {panelTab === 'chat' && <ChatPanel fill />}
            </div>
          </div>
        </main>
      ) : layout === 'wide' ? (
        <main className="relative grid min-h-0 flex-1 grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] gap-6 overflow-y-auto p-4">
          <SidePanel controls={controls} />
          {show}
        </main>
      ) : sideways ? (
        // Held sideways: the middle the screen's whole height under the header, Back, Next and the tabs at its side.
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <main
              className="relative min-h-0 flex-1 overflow-y-auto p-4"
              role="tabpanel"
              aria-label={TAB[tab].label}
            >
              {notes(true)}
              {tabbed}
            </main>
          </div>
          <BackNext layout={layout} controls={controls} />
        </div>
      ) : (
        <main
          className="relative min-h-0 flex-1 overflow-y-auto p-4"
          role="tabpanel"
          aria-label={TAB[tab].label}
        >
          {tabbed}
        </main>
      )}
      {!sideways && <BackNext layout={layout} controls={controls} />}
    </div>
  );
}

export function RemoteApp() {
  const previews = useMemo(() => networkPreviews(), []);
  useEffect(() => {
    void preloadFonts();
    startRemote();
    // Before the feed: its hello says this page follows the chat.
    startChat();
    startFeed();
  }, []);
  // Drashti's way of writing the time (Sessions 31–36, I18N-8), for the clocks it draws.
  const given = useRemote((s) => s.hall?.clock ?? null);
  const clock = useMemo(() => validClockStyle(given), [given]);
  return (
    <PreviewsContext.Provider value={previews}>
      <ClockStyleContext.Provider value={clock}>
        <Layout />
        <DeviceViewer />
        <FlowLayer />
        <PhoneStopped />
      </ClockStyleContext.Provider>
    </PreviewsContext.Provider>
  );
}
