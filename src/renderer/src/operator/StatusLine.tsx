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
  /** The name of the timer up for the audience, when one is and this window knows it (topbar). */
  timer?: string | undefined;
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

/** How many, in words: "2 messages", "3 announcements". */
const howMany = (n: number, one: string) => `${String(n)} ${one}s`;

/**
 * Everything up on the audience screens, the stream or the hall's sound, in words, in this order: the background, the
 * picture-in-picture box, the lower third, the audience's timer, the messages, the ticker, the audio (topbar: before,
 * only the background and the box); null with none of those. A slide is not among them: the line names it.
 */
function upWords(layers: Layers, media: readonly MediaSummary[], timer: string | undefined): string | null {
  const third = layers.lowerThird?.lines.map((l) => l.trim()).find((l) => l !== '');
  const ticker = layers.ticker?.items ?? [];
  const parts = [
    ...(layers.background ? [backgroundName(layers.background, media)] : []),
    ...(layers.pip ? [`Picture in picture · ${boxName(layers.pip.source, media)}`] : []),
    // One for the stream alone is broadcast, so it is said too (the owner's delegate's answer).
    ...(layers.lowerThird ? [third === undefined ? 'Lower third' : `Lower third · ${third}`] : []),
    ...(layers.timer ? [timer === undefined ? 'Timer' : `Timer · ${timer}`] : []),
    ...(layers.messages.length === 1
      ? [`Message · ${layers.messages[0]?.text ?? ''}`]
      : layers.messages.length > 1
        ? [howMany(layers.messages.length, 'message')]
        : []),
    ...(layers.ticker
      ? [
          ticker.length === 1
            ? `Ticker · ${ticker[0]?.text ?? ''}`
            : ticker.length > 1
              ? `Ticker · ${howMany(ticker.length, 'announcement')}`
              : 'Ticker',
        ]
      : []),
    // Its title is beside the line (the audio status), so the line says only that it is the audio.
    ...(layers.audio ? [layers.audio.pausedAtMs === undefined ? 'Audio' : 'Audio · paused'] : []),
  ];
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Whether anything is on the audience screens, the stream or the hall's sound (topbar, the owner's delegate's A to the
 * a25 list's item 4): a slide, a background, the picture-in-picture box, a lower third (the stream's alone too), a
 * message, the ticker, the audio or the audience's timer. Never the wallpaper shown with nothing up, nor Black-out alone
 * (its own badge says that), nor what only the stage screens show (their message and timers are for those on stage).
 */
function somethingLive(layers: Layers): boolean {
  return (
    layers.slide !== null ||
    layers.background !== null ||
    layers.pip !== null ||
    layers.lowerThird !== null ||
    layers.messages.length > 0 ||
    layers.ticker !== null ||
    layers.audio !== null ||
    (layers.timer ?? null) !== null
  );
}

/**
 * LIVE's line in the top bar: whether something is live (its LIVE badge, or Off) and what, in words.
 * A timer up alone first (Session 50), then the presentation's slide the show is at (said cleared once it is), then a
 * playlist's picture, video, sound or video input row (Session 56). Since uitop (alpha.24) its badge is the only LIVE
 * said in words; since topbar (alpha.24, the a25 list's item 4) it is LIVE whenever anything is on the audience
 * screens, the stream or the hall's sound (somethingLive). What is up that the line does not name, it names after it:
 * anything up alone, or under the show's place cleared. With everything cleared it says Off and "Cleared: <the place>",
 * never "Live:" beside Off (item 32). Never LIVE for the wallpaper shown with nothing up, nor Black-out alone.
 */
export function liveLine({ live, layers, presentation, item, media, timer }: LiveLineFacts): LiveLine {
  const slideShown = layers?.slide !== null;
  // A timer up alone in the slide's place (Session 50): named instead of the slide the show is at.
  const timerAlone = layers?.slide?.timer?.name ?? null;
  const itemUp = itemStillUp(item, layers);
  // The show's place, when the line names one, and whether it was cleared.
  let place: string | null = null;
  let cleared = false;
  if (timerAlone !== null) place = `Timer · ${timerAlone}`;
  else if (live?.presentationId && live.slideIndex !== null) {
    // A deck's slide's click (Session 54, C2).
    place = `${presentation ?? 'presentation'} · slide ${String(live.slideIndex + 1)} of ${String(live.slideCount)}${slideShown ? clickWords(layers?.slide) : ''}`;
    cleared = !slideShown;
  } else if (live?.playlist) {
    place = item?.label ?? 'playlist item';
    cleared = !itemUp;
  }
  const up = layers ? somethingLive(layers) : false;
  const onAir =
    up ||
    timerAlone !== null ||
    Boolean(live?.presentationId && slideShown) ||
    Boolean(live?.playlist && !live.presentationId && itemUp);
  // What is up that the line does not name (a slide up without a place in a presentation: "Slide").
  const more = () => (layers ? upWords(layers, media, timer) : null) ?? 'Slide';
  if (place === null) return { onAir, text: up ? `Live: ${more()}` : 'Nothing live' };
  if (!cleared) return { onAir, text: `Live: ${place}` };
  return { onAir, text: onAir ? `Live: ${place} (cleared) · ${more()}` : `Cleared: ${place}` };
}

/** A badge in LIVE's room: the room's whole width, its word in the middle. */
const BADGE_IN_ROOM = 'col-start-1 row-start-1 justify-center';

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
  // The audience's timer up, by its name (topbar).
  const timer = useEngine((s) => {
    const id = s.state?.layers.timer?.timerId;
    return id === undefined ? undefined : s.state?.timers.find((t) => t.id === id)?.name;
  });
  useEffect(() => {
    if (fileUp && !mediaLoaded) void loadMedia();
  }, [fileUp, mediaLoaded]);
  const { onAir, text } = liveLine({
    live,
    layers,
    presentation: name ?? passage ?? repeatName ?? repeating,
    item,
    media,
    timer,
  });
  // LIVE's badge and Off's in one room, the wider one's (topbar): the other is held there unseen and unread, after the
  // one shown, so what is live starts at the same place whichever is said and nothing beside it moves.
  const shown = onAir ? (
    <LiveBadge className={BADGE_IN_ROOM} />
  ) : (
    <Badge className={BADGE_IN_ROOM}>Off</Badge>
  );
  const held = onAir ? <Badge className={BADGE_IN_ROOM}>Off</Badge> : <LiveBadge className={BADGE_IN_ROOM} />;
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm" data-testid="live-status" aria-live="polite">
      <span className="inline-grid shrink-0" data-live-badge-room="">
        {shown}
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 grid">
          {held}
        </span>
      </span>
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
 */
export function ScreensSummary({ onOpen }: { onOpen: (() => void) | null }) {
  // Select the stored array itself: a new [] per call would re-render forever.
  const status = useScreens((s) => s.snapshot?.status) ?? NO_STATUS;
  const { text, tone } = screensSummary(status);
  const IconShape = tone === 'muted' ? Monitor : MonitorOff;
  // Without anything to open: the same words, not a button.
  if (!onOpen)
    return (
      <span
        className={cx(
          'flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5',
          tone === 'danger'
            ? 'bg-danger-bg text-danger-fg'
            : tone === 'warning'
              ? 'bg-warning-bg text-warning-fg'
              : 'text-muted',
        )}
        data-testid="screens-summary"
      >
        <IconShape size={13} aria-hidden="true" />
        {text}
      </span>
    );
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Open the screens dashboard"
      className={cx(
        'flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5',
        tone === 'danger'
          ? 'bg-danger-bg text-danger-fg'
          : tone === 'warning'
            ? 'bg-warning-bg text-warning-fg'
            : 'text-muted hover:text-fg',
      )}
      data-testid="screens-summary"
    >
      <IconShape size={13} aria-hidden="true" />
      {text}
    </button>
  );
}
