import { useEffect } from 'react';
import type { ScreenStatus } from '../../../shared/screens';
import { screensSummary } from '../../../shared/screens-summary';
import { useEngine } from '../engine/engine-store';
import { loadMedia, useLibrary, useMedia } from '../library/library-store';
import { usePlaylists } from '../playlists/playlist-store';
import { usePassageName } from '../shastra/passage-names';
import { useScreens } from '../screens/screens-store';
import { Badge, LiveBadge } from '../ui/Badge';
import { cx } from '../ui/cx';
import { Monitor, MonitorOff, Music } from '../ui/icons';
import { Truncate } from '../ui/Truncate';
import type { BackgroundLayer, Layers, LiveCursor, SlideLayer } from '../../../shared/engine/state';
import { lastStep, stepOf } from '../../../shared/deck-show';
import type { MediaSummary, PlaylistItemInfo } from '../../../shared/playlists';
import { boxName } from './pip-store';
import { repeatPlaylistOf } from '../../../shared/repeat';

/** A deck's slide's click, in words, after "slide N of M" (Session 54, C2): "click 1 of 2", "2 clicks to come". */
export function clickWords(layer: SlideLayer | null | undefined): string {
  const clicks = lastStep(layer?.slide.deck);
  if (!layer || clicks === 0) return '';
  const at = stepOf(layer);
  return at === 0
    ? ` · ${String(clicks)} ${clicks === 1 ? 'click' : 'clicks'} to come`
    : ` · click ${String(at)} of ${String(clicks)}`;
}

/**
 * Whether a picture, video, sound or video input row put up from a playlist is still up (Session 56: LIVE shows one
 * thing at a time): its picture or input as the background, its sound on the audio layer. Black-out or the Wallpaper
 * going on takes a video off, and a clear or Clear all takes any of them off: LIVE's line then says the row was cleared,
 * never that it is live beside the cover. The row not known here (its playlist not open): a picture or a sound is up.
 */
export function itemStillUp(item: PlaylistItemInfo | undefined, layers: Layers | null | undefined): boolean {
  if (!layers) return false;
  const bg = layers.background;
  if (item?.kind === 'media')
    return item.media === 'audio'
      ? layers.audio?.mediaId === item.mediaId
      : bg?.kind === 'media' && bg.mediaId === item.mediaId;
  if (item?.kind === 'input') return bg?.kind === 'input' && bg.name === item.name;
  return bg !== null || layers.audio !== null;
}

const NO_STATUS: ScreenStatus[] = [];

/** What LIVE's line in the top bar is told: the show's place and layers, and the names this window knows. */
export interface LiveLineFacts {
  live: LiveCursor | null | undefined;
  layers: Layers | null | undefined;
  /** The live presentation's name: the library's, a Shastra passage's reference, or a Repeat's playlist. */
  presentation: string | undefined;
  /** The playlist row the show is at, when its playlist is open. */
  item: PlaylistItemInfo | undefined;
  /** Media's files, as this window has read them (none yet: a picture or video is named by its kind). */
  media: readonly MediaSummary[];
}

/** LIVE's line: its LIVE badge (or Off) and its words. */
export interface LiveLine {
  onAir: boolean;
  text: string;
}

/** A background up, in words: its kind and its name (a file's as Media names it, when this window knows it). */
function backgroundName(background: BackgroundLayer, media: readonly MediaSummary[]): string {
  switch (background.kind) {
    case 'color':
      return 'Background colour';
    case 'media': {
      const kind = background.media === 'video' ? 'Video' : 'Picture';
      const name = media.find((m) => m.id === background.mediaId)?.name;
      return name === undefined ? kind : `${kind} · ${name}`;
    }
    case 'input':
      return `Video input · ${background.name}`;
    case 'window':
      return `Window · ${background.name}`;
    case 'link':
      return `Stream link · ${background.name}`;
  }
}

/** The background and the picture-in-picture box up, in words, the background first; null with neither. */
function upWords(layers: Layers, media: readonly MediaSummary[]): string | null {
  const parts = [
    ...(layers.background ? [backgroundName(layers.background, media)] : []),
    ...(layers.pip ? [`Picture in picture · ${boxName(layers.pip.source, media)}`] : []),
  ];
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * LIVE's line in the top bar: whether something is on the screens (its LIVE badge, or Off) and what, in words.
 * A timer up alone first (Session 50), then the presentation's slide the show is at (said cleared once it is), then a
 * playlist's picture, video, sound or video input row (Session 56). Since uitop (alpha.24) its badge is the only LIVE
 * said in words, so it is LIVE too whenever the LIVE column's red frame is (its own badge before): a slide, a
 * background or the picture-in-picture box up (livesay). What is up that the line does not name, it names after it:
 * a background or the box up alone, or under the show's place cleared. Never for the wallpaper shown with nothing up,
 * nor Black-out alone (its own badge says that), nor a message, a ticker, a lower third or a timer for the audience
 * alone (the LIVE column never counted those either).
 */
export function liveLine({ live, layers, presentation, item, media }: LiveLineFacts): LiveLine {
  const slideShown = layers?.slide !== null;
  // A timer up alone in the slide's place (Session 50): named instead of the slide the show is at.
  const timerAlone = layers?.slide?.timer?.name ?? null;
  const itemUp = itemStillUp(item, layers);
  let text = 'Nothing live';
  // Whether the line names what is up.
  let named = false;
  if (timerAlone !== null) {
    text = `Live: Timer · ${timerAlone}`;
    named = true;
  } else if (live?.presentationId && live.slideIndex !== null) {
    // A deck's slide's click (Session 54, C2).
    text = `Live: ${presentation ?? 'presentation'} · slide ${live.slideIndex + 1} of ${live.slideCount}${slideShown ? clickWords(layers?.slide) : ' (cleared)'}`;
    named = slideShown;
  } else if (live?.playlist) {
    text = `Live: ${item?.label ?? 'playlist item'}${itemUp ? '' : ' (cleared)'}`;
    named = itemUp;
  }
  // On the screens as the LIVE column's red frame has it (operator/LivePreview.tsx's somethingUp).
  const onScreens = layers
    ? layers.slide !== null || layers.background !== null || layers.pip !== null
    : false;
  if (onScreens && !named && layers) {
    const up = upWords(layers, media) ?? 'Slide';
    text = text === 'Nothing live' ? `Live: ${up}` : `${text} · ${up}`;
  }
  const onAir =
    onScreens ||
    timerAlone !== null ||
    Boolean(live?.presentationId && slideShown) ||
    Boolean(live?.playlist && !live.presentationId && itemUp);
  return { onAir, text };
}

/** What is on the screens, in words: the header says it at all times. */
export function LiveStatus() {
  const live = useEngine((s) => s.state?.live);
  const blackout = useEngine((s) => s.state?.blackout ?? false);
  const audio = useEngine((s) => s.state?.layers.audio?.title ?? null);
  const name = useLibrary((s) => s.presentations.find((p) => p.id === live?.presentationId)?.name);
  // A Shastra passage is not in the library's list: its reference instead.
  const passage = usePassageName(live?.presentationId);
  // Nor are Repeat Slides' slides (`repeat:<playlistId>`): its playlist's name, going round or stopped with its slide
  // left up (Session 55: it said "presentation").
  const repeatName = usePlaylists((s) => {
    const playlistId = live?.presentationId ? repeatPlaylistOf(live.presentationId) : null;
    return playlistId === null ? undefined : s.tree.find((n) => n.id === playlistId)?.name;
  });
  const repeating = useEngine((s) => s.state?.repeat?.name);
  // A picture, video or sound from a playlist: its name, when that playlist is open; and whether it is still up
  // (Session 56: a cover going on takes a video off).
  const item = usePlaylists((s) => s.items.find((i) => i.id === live?.playlist?.itemId));
  const layers = useEngine((s) => s.state?.layers);
  // A file up is named as Media names it (livesay): its list read once, when one is up and this window has not yet.
  const media = useMedia((s) => s.media);
  const mediaLoaded = useMedia((s) => s.loaded);
  const fileUp = layers?.background?.kind === 'media' || layers?.pip?.source.kind === 'media';
  useEffect(() => {
    if (fileUp && !mediaLoaded) void loadMedia();
  }, [fileUp, mediaLoaded]);
  const { onAir, text } = liveLine({
    live,
    layers,
    presentation: name ?? passage ?? repeatName ?? repeating,
    item,
    media,
  });
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm" data-testid="live-status" aria-live="polite">
      {onAir ? <LiveBadge /> : <Badge>Off</Badge>}
      <Truncate text={text} className={cx('font-medium', !onAir && 'text-muted')} data-testid="live-text" />
      {blackout && <Badge tone="live">Black-out</Badge>}
      {audio !== null && (
        <span
          className="flex min-w-0 items-center gap-1 text-xs text-muted"
          data-testid="audio-status"
          title="On the audio layer"
        >
          <Music size={13} aria-hidden="true" className="shrink-0" />
          <Truncate text={audio || 'Audio'} />
        </span>
      )}
    </div>
  );
}

/**
 * "2 screens showing · 1 display not connected · 1 keeps restarting · 1 stopped", so a volunteer notices a dead
 * output (the words: shared/screens-summary.ts).
 *
 * The status bar's first item (alpha.24, lead 2's statusbar; alpha.25 item 17): its words in a held room, as wide as
 * its steady forms ("No screens set up", and "N screens showing" with as many digits as now, all one width), so Sound,
 * the calendar and Help after it hold still as screens come and go; only a longer line, a display not connected or a
 * screen stopped, takes more. 24 px tall (WCAG 2.5.8).
 */
export function ScreensSummary({ onOpen }: { onOpen: (() => void) | null }) {
  // Select the stored array itself: a new [] per call would re-render forever.
  const status = useScreens((s) => s.snapshot?.status) ?? NO_STATUS;
  const { text, tone } = screensSummary(status);
  const IconShape = tone === 'muted' ? Monitor : MonitorOff;
  const place = 'col-start-1 row-start-1 flex min-h-6 items-center gap-1.5 rounded-sm px-1.5';
  const look = cx(
    place,
    tone === 'danger'
      ? 'bg-danger-bg text-danger-fg'
      : tone === 'warning'
        ? 'bg-warning-bg text-warning-fg'
        : 'text-muted',
  );
  // Without anything to open: the same words, not a button.
  const shown = !onOpen ? (
    <span className={look} data-testid="screens-summary">
      <IconShape size={13} aria-hidden="true" />
      {text}
    </span>
  ) : (
    <button
      type="button"
      onClick={onOpen}
      title="Open the screens dashboard"
      className={cx(look, tone === 'muted' && 'hover:text-fg')}
      data-testid="screens-summary"
    >
      <IconShape size={13} aria-hidden="true" />
      {text}
    </button>
  );
  return (
    // The room: the summary over its steady forms' unseen copies, as wide as the widest (outside it, so its words are
    // only its own).
    <span className="grid shrink-0 tabular-nums">
      {shown}
      {heldForms(text).map((form) => (
        <span key={form} aria-hidden="true" className={cx(place, 'invisible')}>
          <span className="inline-block w-[13px] shrink-0" />
          {form}
        </span>
      ))}
    </span>
  );
}

/** The summary's steady forms, for its room: none set up, and the most with as many digits as it says now. */
function heldForms(text: string): string[] {
  const digits = Math.max(1, /\d+/u.exec(text)?.[0].length ?? 1);
  return ['No screens set up', `${'8'.repeat(digits)} screens showing`];
}
