import { randomUUID } from 'node:crypto';
import type { CommandResult, EngineCommand, EngineCommandType } from '../../shared/engine/commands';
import { diffState } from '../../shared/engine/patch';
import type { EngineSnapshotMessage } from '../../shared/engine/protocol';
import {
  type AudioChoice,
  type AudioLayer,
  type BackgroundChoice,
  type BackgroundLayer,
  type CuedNext,
  ENGINE_STATE_VERSION,
  type EngineState,
  initialEngineState,
  type InputBackground,
  type Layers,
  type LiveCursor,
  type LowerThirdLayer,
  type MaskLayer,
  type MessageItem,
  type MusicRun,
  type PipLayer,
  type PipPlace,
  type PlaylistCursor,
  type PropItem,
  type RepeatRun,
  type SlideLayer,
  type TickerItem,
  type TickerLayer,
  UPCOMING_ITEMS,
  type UpcomingItem,
  type UpNext,
  type WindowBackground,
} from '../../shared/engine/state';
import type { EngineTransport } from '../../shared/engine/transport';
import type { CalendarDay } from '../../shared/calendar';
import type { IdleState, Quote } from '../../shared/idle';
import type { BackgroundCue } from '../../shared/library';
import type { LiveLook } from '../../shared/looks';
import { CUT, type Transition } from '../../shared/model';
import { repeatPlaylistOf, repeatPresentationId } from '../../shared/repeat';
import { mediaInState } from '../../shared/node-media';
import {
  backgroundShowing,
  framed,
  type LiveZoom,
  liveZoomAt,
  PLAIN,
  type PictureLook,
  slideShowing,
} from '../../shared/picture-look';
import { elapsedAt, type TimerDefinition, type TimerRun, zeroAt } from '../../shared/timers';
import { BUILT_IN_TIMER_LOOK, timerAloneSlide, type TimerLook, timerShowId } from '../../shared/timer-slides';
import { INPUT_FADE_MS, type VideoInput } from '../../shared/video-inputs';
import { remapPosition } from '../../shared/order';
import type { EngineAction } from './actions';
import { hidePip, leavingMedia, placePip, restoredPip, showPip, swapPip } from './pip';
import type { MediaMarkers, PlaybackMarker } from '../../shared/markers';
import type { PlaybackClip, PlaybackSeek } from '../../shared/media';
import { NO_PLAYLISTS, type PlayItem, type PlaylistSource } from './playlist-source';
import { reduce, sameData } from './reducer';
import { type SkipJump, skipFrom } from './skip';
import type { PlayedSlide, PlayOrder, SlideSource } from './slide-source';

type Resolved = { ok: true; actions: EngineAction[] } | Extract<CommandResult, { ok: false }>;
type MediaItem = Extract<PlayItem, { kind: 'media' }>;
type InputItem = Extract<PlayItem, { kind: 'input' }>;

const NO_CHANGE: Resolved = { ok: true, actions: [] };

/** These layers without one announcement (as a message or in the ticker). */
function withoutItem(layers: Layers, id: string): Layers {
  const messages = layers.messages.filter((m) => m.id !== id);
  const ticker = layers.ticker;
  const items = ticker?.items.filter((i) => i.id !== id) ?? [];
  return {
    ...layers,
    messages: messages.length === layers.messages.length ? layers.messages : messages,
    ticker:
      !ticker || items.length === ticker.items.length
        ? ticker
        : items.length > 0
          ? { ...ticker, items }
          : null,
  };
}

/** Commands that come back to a playlist item rather than move on to it: its timer cues do not run again. */
const BACKWARDS: ReadonlySet<string> = new Set(['back', 'previous', 'previousItem']);

/**
 * Audio playlists play independently of the slides (Session 14): starting,
 * pausing or moving through one is not a change Back or Put it back undo,
 * and neither is a track ending and the next starting.
 */
const MUSIC_COMMANDS: ReadonlySet<string> = new Set([
  // A jump to a marker moves what plays, not the slides; so do Back 15 s, Forward 15 s and Last 10 s
  // (Session 50).
  'jumpToMarker',
  'skip',
  'playMusic',
  'pauseMusic',
  'resumeMusic',
  'musicNext',
  'musicPrevious',
  'setMusicLoop',
]);

/** A track whose length no window has reported this long after it started (it cannot play) is passed. */
export const MUSIC_UNKNOWN_LENGTH_MS = 20_000;

type MusicLayer = AudioLayer & { music: MusicRun };

/**
 * How a timer shown alone comes on when Drashti's slide transition is a cut (Session 50): a fade of half a
 * second, so it never just appears.
 */
export const TIMER_FADE: Transition = { kind: 'dissolve', durationMs: 500 };

/** The message a timer cue shows: one per timer (showing it again replaces it). */
export const timerMessageId = (timerId: string): string => `timer:${timerId}`;

/** Where the engine finds Looks: the library's, every group's settings filled in. */
export interface LookSource {
  /** A Look, or null when it no longer exists. */
  look(lookId: string): LiveLook | null;
  /** The Look Drashti starts with: the first in the list. */
  start(): LiveLook;
}

export interface EngineOptions {
  /** Drashti's own default transition, for presentations without one (a setting; a cut when left out). */
  defaultTransition?: () => Transition;
  /** Run `run` after `delayMs`; returns a way to cancel it (setTimeout when left out; tests run it by hand). */
  schedule?: (delayMs: number, run: () => void) => () => void;
  /** The library's Looks (none when left out: every group has the defaults). */
  looks?: LookSource;
  /**
   * Why a command is refused now, or null to run it: Simple Mode refuses
   * switching the Look, from the window, a phone or the API alike.
   */
  refuse?: (command: EngineCommand) => string | null;
  /** A media file's length in ms, when the library knows it (learned from playing it). */
  mediaLength?: (mediaId: string) => number | null;
  /** A video's or sound's start and end points and markers (Session 14), when it has any. */
  mediaMarkers?: (mediaId: string) => MediaMarkers | null;
  /** A Repeat Slides playlist's name (Session 26d), or null when it is not one. */
  repeatName?: (playlistId: string) => string | null;
  /** A picture's look (Session 26e), or null: shown as it is. */
  pictureLook?: (mediaId: string) => PictureLook | null;
  /**
   * A media item's kind while it is in Media to play (not missing or deleted), or null: the picture-in-picture
   * box (Session 50) takes a picture or a video as the library has it, never as a page says.
   */
  mediaKind?: (mediaId: string) => 'image' | 'video' | 'audio' | null;
  /**
   * A window Show a Window… has just offered (Session 48), by its id, or null: the only windows the
   * picture-in-picture box can hold (src/main/live-window/).
   */
  windows?: (id: string) => { sourceId: string; name: string } | null;
  /** Where a new picture-in-picture box goes, as the library remembers (DEFAULT_PIP_PLACE when left out). */
  pipPlace?: () => PipPlace;
  /**
   * A video input in this computer's list (Session 50: src/main/video-inputs/), by its id, or null: the only
   * place showInput and the picture-in-picture box (and restart recovery, Put it back and Back) find an input's
   * name, device and fit.
   */
  videoInput?: (inputId: string) => VideoInput | null;
  /**
   * This computer's video input of a name (Session 51: shared/video-inputs.ts inputNamed), or null: the input a
   * slide's background cue names, found as the slide goes up.
   */
  inputNamed?: (name: string) => VideoInput | null;
  /** How a timer shown alone looks (Session 50): the library's default theme's words; Drashti's own when left out. */
  timerLook?: () => TimerLook;
}

/** What restart recovery puts back (see recovery/live-state.ts). */
export interface RestoreRequest {
  slide: { presentationId: string; slideIndex: number; arrangementId?: string | null } | null;
  /** The playlist item that was playing, so Next carries on from it. */
  playlist?: PlaylistCursor | null;
  background: BackgroundLayer | null;
  blackout: boolean;
  /** The logo shown instead of the picture (Simple Mode's Logo). */
  logo?: PropItem | null;
  /** The sound, with when it started: it carries on from where it would be now. */
  audio?: AudioLayer | null;
  props?: readonly PropItem[];
  messages?: readonly MessageItem[];
  /** The announcements ticker, carrying on in step from when it started. */
  ticker?: TickerLayer | null;
  /** The mask up on the Masks layer. */
  masks?: MaskLayer | null;
  /** The lower third up (Session 44): it comes back still, as it was. */
  lowerThird?: LowerThirdLayer | null;
  /** The picture-in-picture box up (Session 50): it comes back still, as it was (see pip.ts restoredPip). */
  pip?: PipLayer | null;
  stageMessage?: string | null;
  /** Timer runs: a running timer carries on from its start time, a paused one keeps its count. */
  timers?: readonly { id: string; startedAt: number | null; elapsedMs: number }[];
  /** The slide was moving on by itself: it carries on with the time it had left. */
  autoAdvance?: { leftMs: number; durationMs: number } | null;
  /** A Repeat Slides playlist was going round (Session 26d): it carries on, from the slide that was up. */
  repeat?: { playlistId: string } | null;
  /** The Look that was live (left out or gone: the one already live stays). */
  lookId?: string | null;
  /** A timer shown alone (Session 50): it comes back over the slide, still, while that timer is in the library. */
  timer?: { timerId: string } | null;
}

/** What restart recovery put back. */
export interface Restored {
  /** The name of the Look that came back, when it was not the one already live (the first); else null. */
  look: string | null;
  slide: boolean;
  background: boolean;
  blackout: boolean;
  logo: boolean;
  audio: boolean;
  props: number;
  messages: number;
  ticker: number;
  masks: boolean;
  lowerThird: boolean;
  /** The picture-in-picture box (Session 50). */
  pip: boolean;
  stageMessage: boolean;
  timers: number;
  /**
   * Another app's window that was the background (Session 48), by name: never put back (it may be gone),
   * only said. Null when there was none.
   */
  window: string | null;
  /** Another app's window that was in the picture-in-picture box (Session 50), by name: the same. */
  pipWindow: string | null;
  /** The video input put back as the background (Session 50), by name (not counted in `background`), or null. */
  input: string | null;
  /** A video input that was the background but is no longer in this computer's list, by name: only said. */
  inputGone: string | null;
  /**
   * A video input that was in the picture-in-picture box but is no longer in this computer's list (Session 51), by
   * name: the box is not put back, only said. Left out when none was.
   */
  pipInputGone?: string;
  /** A timer shown alone came back over the slide (Session 50); left out when none did. */
  timer?: boolean;
}

/**
 * The show engine. It owns the live state, turns commands into actions,
 * and sends every change as a versioned patch through the transport.
 */
/** What a Next changed, so Back can undo it exactly while nothing else has changed. */
interface Step {
  live: LiveCursor;
  layers: Layers;
  /** The position and layers the Next left: still these, or Back cannot undo it. */
  toLive: LiveCursor;
  toLayers: Layers;
}

/** How many Nexts Back can undo, one after another. */
const MAX_STEPS = 50;

export class ShowEngine {
  private state: EngineState = initialEngineState();
  private revision = 0;
  /** This run of the engine: its revisions start from 0 (snapshots say which run they are from). */
  readonly session = randomUUID();
  private readonly listeners = new Set<(state: EngineState) => void>();
  /**
   * What Clear all took down (from), while the layers are still what it left (to), and the Repeat Slides
   * that was going round then (Put it back sets it going again).
   */
  private cleared: { from: Layers; to: Layers; repeat: RepeatRun | null } | null = null;
  /** The Nexts Back can undo, latest last. */
  private steps: Step[] = [];
  /** The auto-advance waiting to run, and how to cancel it. */
  private scheduled: { startedAt: number; durationMs: number } | null = null;
  private cancelScheduled: (() => void) | null = null;
  /** An audio playlist's track waiting to end (its key), and how to cancel the wait. */
  private musicWait: { key: string; cancel: () => void } | null = null;
  /** The slide up going on when a countdown on it reaches zero (Session 50): its key, and how to cancel the wait. */
  private zeroWait: { key: string; cancel: () => void } | null = null;
  /** The last zero that came: it is not waited for again (a slide with nowhere to go holds at 0:00). */
  private zeroDone: string | null = null;
  /** The time of the change being made, read once (null between changes). */
  private at: number | null = null;
  /** The change being made only adds what is known about it (a file's length): not a change to the show. */
  private bookkeeping = false;

  constructor(
    private readonly source: SlideSource,
    private readonly transport: EngineTransport,
    private readonly clock: () => number = Date.now,
    private readonly playlists: PlaylistSource = NO_PLAYLISTS,
    private readonly options: EngineOptions = {},
  ) {}

  /** Now; during a change, the one time everything it does shares (a slide and its count start together). */
  private now(): number {
    return this.at ?? this.clock();
  }

  /** Make one change at one time. */
  private atOnce<T>(change: () => T): T {
    if (this.at !== null) return change();
    this.at = this.clock();
    try {
      return change();
    } finally {
      this.at = null;
    }
  }

  get current(): EngineState {
    return this.state;
  }

  get rev(): number {
    return this.revision;
  }

  snapshot(): EngineSnapshotMessage {
    return {
      kind: 'snapshot',
      version: ENGINE_STATE_VERSION,
      rev: this.revision,
      state: this.state,
      sentAt: this.now(),
      session: this.session,
    };
  }

  dispatch(command: EngineCommand): CommandResult {
    const refused = this.options.refuse?.(command) ?? null;
    if (refused !== null) return { ok: false, error: 'forbidden', message: refused };
    // A Next sent with the revision it saw, the show having moved since (Sessions 31–36, TST-11): nothing.
    if (command.type === 'next' && command.rev !== undefined && command.rev !== this.revision)
      return this.unchanged();
    return this.atOnce(() => {
      const resolved = this.resolve(command);
      if (!resolved.ok) return resolved;
      if (!MUSIC_COMMANDS.has(command.type)) return this.apply(resolved.actions, command.type);
      // An audio playlist: not a change to the slides, so Back and Put it back still do what they would.
      this.bookkeeping = true;
      try {
        return this.apply(resolved.actions, command.type);
      } finally {
        this.bookkeeping = false;
      }
    });
  }

  /** Called after every change, once the change has been sent to the windows. */
  onChange(listener: (state: EngineState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Put back what was live before an unexpected stop: the slide (without
   * running its cues again, so a background cleared since stays cleared),
   * the playlist item it was played from, the background as it was (a video
   * carries on from where it would be now), and black-out. A slide or item
   * that no longer exists is left out.
   */
  restore(request: RestoreRequest): Restored {
    return this.atOnce(() => this.restoreAt(request));
  }

  private restoreAt(request: RestoreRequest): Restored {
    const actions: EngineAction[] = [];
    let slide = false;
    // The Look first, so the screens draw what comes back the way they did.
    const look = request.lookId ? (this.options.looks?.look(request.lookId) ?? null) : null;
    const lookBack = look !== null && look.id !== this.state.look.id;
    if (look) actions.push({ type: 'look/set', look });
    const playlist = request.playlist ? this.checkItem(request.playlist) : null;
    if (request.slide) {
      const { presentationId, slideIndex, arrangementId } = request.slide;
      const order = this.source.order(presentationId, arrangementId);
      const found = order?.slides[slideIndex];
      if (order && found) {
        const from =
          playlist?.item.kind === 'presentation' && playlist.item.presentationId === presentationId;
        actions.push(
          this.showAction(presentationId, slideIndex, order, found, from ? playlist.cursor : null),
        );
        slide = true;
      }
    } else if (
      playlist?.item.kind === 'media' ||
      playlist?.item.kind === 'input' ||
      playlist?.item.kind === 'skip'
    ) {
      // A picture, video or sound item, or a video input's (Session 51); or one that reads as nothing to play now,
      // its file or its input not here since the restart: Next carries on from its place, never from the start.
      actions.push({ type: 'live/item', playlist: playlist.cursor });
    }
    // A timer shown alone (Session 50) comes back over it as it was, still: no transition plays again.
    const wanted = request.timer?.timerId;
    const alone = wanted === undefined ? undefined : this.state.timers.find((t) => t.id === wanted);
    if (alone) actions.push({ type: 'slide/put', layer: this.timerLayer(alone, null) });
    // Another app's window is never put back: it may be gone, or be another window now (Session 48).
    const window = request.background?.kind === 'window' ? request.background.name : null;
    // A video input (Session 50) comes back while it is still in this computer's list, as the list has it now;
    // one no longer there is only said. Whether its camera is plugged in only the screens can tell: the first
    // to draw it says (src/main/video-inputs/), and one that is not there comes off again, named.
    const wasInput = request.background?.kind === 'input' ? request.background : null;
    const input = wasInput ? this.asListed(wasInput) : null;
    let background = window !== null ? null : wasInput ? input : request.background;
    // A video keeps its start time and its last jump, so it carries on where it would be now, between its start
    // and end points (Session 51: since Session 14 it came back as if never jumped, over the whole file).
    if (background?.kind === 'media') {
      const { clip: _clip, marks: _marks, ...played } = background;
      background = { ...played, ...this.libraryOf(played.mediaId, played.durationMs) };
    }
    if (background) actions.push({ type: 'background/set', background });
    if (request.blackout) actions.push({ type: 'blackout/set', on: true });
    if (request.logo) actions.push({ type: 'logo/set', prop: request.logo });
    // The sound keeps its start time and its last jump, so it carries on where it would be now, as a video does.
    if (request.audio) {
      const { clip: _clip, marks: _marks, ...played } = request.audio;
      const audio = { ...played, ...this.libraryOf(played.mediaId, played.durationMs) };
      actions.push({ type: 'audio/set', audio });
    }
    for (const prop of request.props ?? []) actions.push({ type: 'prop/show', prop });
    for (const message of request.messages ?? []) actions.push({ type: 'message/show', message });
    if (request.ticker) actions.push({ type: 'ticker/set', ticker: request.ticker });
    if (request.masks) actions.push({ type: 'mask/set', mask: request.masks });
    if (request.lowerThird) actions.push({ type: 'lowerThird/show', layer: request.lowerThird });
    // The picture-in-picture box (Session 50): never a window, a video input only while it is in the list (one no
    // longer there is only said, Session 51; whether its camera is there the screens tell, as for the background's).
    const box = restoredPip(request.pip ?? null, this.options);
    if (box.layer) actions.push({ type: 'pip/set', layer: box.layer });
    if (request.stageMessage) actions.push({ type: 'stage/message', text: request.stageMessage });
    // Timers that still exist: running ones count on from their start, paused ones keep their count.
    let timers = 0;
    for (const t of request.timers ?? []) {
      if (!this.state.timers.some((x) => x.id === t.id)) continue;
      actions.push({
        type: 'timer/run',
        timerId: t.id,
        run: { startedAt: t.startedAt, elapsedMs: t.elapsedMs },
      });
      timers++;
    }
    // Repeat Slides carries on going round, when its slide came back.
    const repeating = request.repeat ? this.repeatRun(request.repeat.playlistId) : null;
    if (slide && repeating && request.slide?.presentationId === repeatPresentationId(repeating.playlistId))
      actions.push({ type: 'repeat/set', repeat: repeating });
    this.apply(actions);
    // A slide that was moving on by itself carries on with the time it had left.
    const advance = request.autoAdvance;
    if (slide && advance && advance.leftMs >= 0 && advance.durationMs > 0) {
      const left = Math.min(advance.leftMs, advance.durationMs);
      this.apply([
        {
          type: 'advance/set',
          autoAdvance: {
            startedAt: this.now() - (advance.durationMs - left),
            durationMs: advance.durationMs,
          },
        },
      ]);
    }
    return {
      look: lookBack ? look.name : null,
      slide,
      background: background !== null && background.kind !== 'input',
      blackout: request.blackout,
      logo: Boolean(request.logo),
      audio: Boolean(request.audio),
      props: request.props?.length ?? 0,
      messages: request.messages?.length ?? 0,
      ticker: request.ticker?.items.length ?? 0,
      masks: Boolean(request.masks),
      lowerThird: Boolean(request.lowerThird),
      pip: box.layer !== null,
      stageMessage: Boolean(request.stageMessage),
      timers,
      window,
      pipWindow: box.window,
      input: input?.name ?? null,
      inputGone: wasInput && !input ? wasInput.name : null,
      ...(box.inputGone === null ? {} : { pipInputGone: box.inputGone }),
      ...(alone ? { timer: true } : {}),
    };
  }

  /**
   * Another app's window as the background (Session 48), live on every screen of this computer from now,
   * in place of what was there. Only the main process calls this, with a window it offered and the operator
   * chose (src/main/live-window/): no command from a window, a phone or the API can name one.
   */
  showWindow(window: Pick<WindowBackground, 'sourceId' | 'name'>): CommandResult {
    return this.atOnce(() =>
      this.apply([
        {
          type: 'background/set',
          background: { kind: 'window', sourceId: window.sourceId, name: window.name, startedAt: this.now() },
        },
      ]),
    );
  }

  /**
   * A video input changed in this computer's list while it is up (Session 50: renamed, another device, fit or
   * fill): the screens follow at once, the input carrying on. Not a change to the show: what Back and Put it
   * back would undo stays.
   */
  refreshInput(input: VideoInput): CommandResult {
    const actions: EngineAction[] = [];
    const bg = this.state.layers.background;
    if (bg?.kind === 'input' && bg.inputId === input.id) {
      const next: InputBackground = { ...bg, name: input.name, device: input.device, fit: input.fit };
      actions.push({ type: 'background/set', background: next });
    }
    // The same input in the picture-in-picture box (Session 50, section 8's review): it follows too.
    const box = this.state.layers.pip;
    if (box?.source.kind === 'input' && box.source.inputId === input.id)
      actions.push({
        type: 'pip/set',
        layer: { ...box, source: { ...box.source, name: input.name, device: input.device } },
      });
    if (actions.length === 0) return this.unchanged();
    this.bookkeeping = true;
    try {
      return this.apply(actions);
    } finally {
      this.bookkeeping = false;
    }
  }

  /**
   * An announcement in the ticker (approved by the operator). The ticker
   * starts again from the right edge, on every screen at once.
   */
  showTicker(item: TickerItem): CommandResult {
    return this.atOnce(() => this.apply([{ type: 'ticker/show', item, at: this.now() }]));
  }

  /**
   * An announcement's time is up (or the operator took it off): off the
   * screens, as a message or in the ticker, and out of what Put it back
   * would bring back.
   */
  takeDown(id: string): CommandResult {
    return this.atOnce(() => {
      if (this.cleared) this.cleared = { ...this.cleared, from: withoutItem(this.cleared.from, id) };
      return this.apply([
        { type: 'message/hide', messageId: id },
        { type: 'ticker/hide', itemId: id, at: this.now() },
      ]);
    });
  }

  /**
   * The live presentation's order changed (its own arrangement, or the
   * playlist item's). The live position follows the new order, with the same
   * slide on screen: Next then carries on in the new order. Leave out the
   * presentation to check whatever is live.
   */
  reorderLive(presentationId?: string): CommandResult {
    const live = this.state.live;
    if (live.presentationId === null || live.slideIndex === null) return this.unchanged();
    if (presentationId !== undefined && live.presentationId !== presentationId) return this.unchanged();
    const before = this.source.order(live.presentationId, live.arrangementId);
    const after = this.source.order(live.presentationId, this.itemArrangement(live));
    if (!before || !after) return this.unchanged();
    const slideIndex = remapPosition(
      before.slides.map((s) => ({ slide: s })),
      after.slides.map((s) => ({ slide: s })),
      live.slideIndex,
    );
    return this.apply([
      { type: 'live/move', slideIndex, slideCount: after.slides.length, arrangementId: after.arrangementId },
    ]);
  }

  /**
   * The Looks changed in the library (a Look or a group edited, made or
   * removed): the live one is read again, so the screens follow at once.
   * If it was removed, the first Look goes live. At startup this puts the
   * first Look live.
   */
  refreshLook(): CommandResult {
    const looks = this.options.looks;
    if (!looks) return this.unchanged();
    const id = this.state.look.id;
    const look = (id ? looks.look(id) : null) ?? looks.start();
    return this.apply([{ type: 'look/set', look }]);
  }

  /**
   * The timers as the library defines them (at startup, and after the operator edits one). A timer shown alone
   * (Session 50) takes its timer's new name, and goes off, its out from now, when its timer is removed.
   */
  setTimers(timers: readonly TimerDefinition[]): CommandResult {
    return this.atOnce(() => {
      const actions: EngineAction[] = [{ type: 'timers/define', timers }];
      const shown = this.state.layers.slide;
      const alone = shown?.timer;
      if (shown && alone) {
        const t = timers.find((x) => x.id === alone.timerId);
        if (!t) actions.push({ type: 'layer/clear', layer: 'slide', at: this.now() });
        else if (t.name !== alone.name)
          actions.push({ type: 'slide/put', layer: { ...shown, timer: { ...alone, name: t.name } } });
      }
      return this.apply(actions);
    });
  }

  /** What the idle rotation shows (from the admin's settings, the media library and the quotes). */
  setIdle(content: Omit<IdleState, 'startedAt'>): CommandResult {
    const { startedAt: _running, ...was } = this.state.idle;
    if (sameData(was, content)) return this.unchanged();
    return this.apply([{ type: 'idle/set', content }]);
  }

  /** The quote of the day: at midnight, and when the quotes change. */
  setQuote(quote: Quote | null): CommandResult {
    if (sameData(this.state.quote, quote)) return this.unchanged();
    return this.apply([{ type: 'quote/set', quote }]);
  }

  /** Today's calendar entry: from the loaded calendars, at midnight and when they change. */
  setCalendar(calendar: CalendarDay | null): CommandResult {
    if (sameData(this.state.calendar, calendar)) return this.unchanged();
    return this.apply([{ type: 'calendar/set', calendar }]);
  }

  /**
   * What a playlist item's timer cues do as it goes up (shared/playlists.ts
   * TimerCue): start a timer from the beginning, reset it, or show it on the
   * audience screens as a message with its name and time.
   */
  private timerCueActions(cursor: PlaylistCursor, state: EngineState): EngineAction[] {
    const item = this.playlists.items(cursor.playlistId)?.find((i) => i.id === cursor.itemId);
    const cues = item && item.kind !== 'skip' ? (item.timers ?? []) : [];
    const now = this.now();
    return cues.flatMap((cue): EngineAction[] => {
      const t = state.timers.find((x) => x.id === cue.timerId);
      if (!t) return [];
      if (cue.action === 'start')
        return [{ type: 'timer/run', timerId: t.id, run: { startedAt: now, elapsedMs: 0 } }];
      if (cue.action === 'reset')
        return [{ type: 'timer/run', timerId: t.id, run: { startedAt: null, elapsedMs: 0 } }];
      return [
        {
          type: 'message/show',
          message: {
            id: timerMessageId(t.id),
            text: `${t.name} [${t.name}]`,
            parts: [
              { kind: 'text', text: `${t.name} ` },
              { kind: 'timer', timerId: t.id },
            ],
          },
          at: now,
        },
      ];
    });
  }

  /**
   * How a timer shown alone comes on (Session 50), and goes off when it is taken off on its own: Drashti's slide
   * transition, as each screen's Look draws it; a fade after a cut, and instead of a slow zoom (which would grow
   * the time while it is up).
   */
  private timerTransition(): Transition {
    const t = this.options.defaultTransition?.() ?? CUT;
    if (t.kind === 'cut' || t.durationMs <= 0) return TIMER_FADE;
    return { kind: t.kind === 'zoom' ? 'dissolve' : t.kind, durationMs: t.durationMs };
  }

  /** A timer shown alone as the slide layer has it: Drashti's Timer only layout, made for that timer. */
  private timerLayer(t: TimerDefinition, transition: Transition | null): SlideLayer {
    return {
      presentationId: timerShowId(t.id),
      slideIndex: 0,
      slide: timerAloneSlide(t.id, this.options.timerLook?.() ?? BUILT_IN_TIMER_LOOK),
      shownAt: this.now(),
      notes: '',
      ...(transition ? { transition } : {}),
      timer: { timerId: t.id, name: t.name },
    };
  }

  /**
   * Show on the screens (Session 50): a timer up alone in the slide's place, over whatever background is up,
   * coming on with the slide transition. The live position stays where it was, so Next goes on from there,
   * and no presentation is made for it. Shown already, it stays as it is.
   */
  private showTimer(timerId: string): Resolved {
    const t = this.state.timers.find((x) => x.id === timerId);
    if (!t) return { ok: false, error: 'unknown-timer', message: 'That timer no longer exists' };
    if (this.state.layers.slide?.timer?.timerId === timerId) return NO_CHANGE;
    return { ok: true, actions: [{ type: 'slide/put', layer: this.timerLayer(t, this.timerTransition()) }] };
  }

  /** Start, pause or reset a timer: the only changes the windows need to count by themselves. */
  private runTimer(timerId: string, how: 'start' | 'pause' | 'reset'): Resolved {
    const t = this.state.timers.find((x) => x.id === timerId);
    if (!t) return { ok: false, error: 'unknown-timer', message: 'That timer no longer exists' };
    const now = this.now();
    const run: TimerRun =
      how === 'start'
        ? { startedAt: t.startedAt ?? now, elapsedMs: t.elapsedMs }
        : how === 'pause'
          ? { startedAt: null, elapsedMs: elapsedAt(t, now) }
          : { startedAt: null, elapsedMs: 0 };
    return { ok: true, actions: [{ type: 'timer/run', timerId, run }] };
  }

  /**
   * A presentation's slides changed (its words were edited, a theme was
   * applied). If it is live, the slide on the screens shows its new content
   * at once, at its place in the new order; a slide that is gone stays up
   * until the operator moves on.
   */
  refreshLive(presentationId: string): CommandResult {
    return this.atOnce(() => this.refreshLiveAt(presentationId));
  }

  private refreshLiveAt(presentationId: string): CommandResult {
    const live = this.state.live;
    const order =
      live.presentationId === presentationId && live.slideIndex !== null
        ? this.source.order(presentationId, live.arrangementId)
        : null;
    if (!order || live.slideIndex === null) return this.refreshNext();
    const shown = this.state.layers.slide;
    const slideId = shown?.presentationId === presentationId ? shown.slide.id : null;
    // The same slide, nearest to where it was (a repeated chorus comes more than once).
    let index = -1;
    order.slides.forEach((s, i) => {
      if (
        s.id === slideId &&
        (index < 0 || Math.abs(i - (live.slideIndex ?? 0)) < Math.abs(index - (live.slideIndex ?? 0)))
      )
        index = i;
    });
    const played = order.slides[index];
    if (!shown || !played) {
      const slideIndex = index >= 0 ? index : Math.min(live.slideIndex, Math.max(0, order.slides.length - 1));
      this.apply([
        {
          type: 'live/move',
          slideIndex,
          slideCount: order.slides.length,
          arrangementId: order.arrangementId,
        },
      ]);
    } else {
      this.apply([this.showAction(presentationId, index, order, played, live.playlist)]);
    }
    return this.refreshNext();
  }

  /** A playlist or presentation changed: what comes next may be different now. */
  refreshNext(): CommandResult {
    return this.apply([
      { type: 'next/set', next: this.upNext(this.state.live) },
      { type: 'upcoming/set', upcoming: this.upcoming(this.state.live) },
    ]);
  }

  /**
   * A media file's length, learned as a window played it: the background or
   * sound playing it says how long it is (a stage screen shows the time left).
   */
  learnLength(mediaId: string, durationMs: number): CommandResult {
    const actions: EngineAction[] = [];
    const bg = this.state.layers.background;
    if (bg?.kind === 'media' && bg.mediaId === mediaId && bg.durationMs !== durationMs)
      actions.push({ type: 'background/set', background: { ...bg, durationMs } });
    const audio = this.state.layers.audio;
    if (audio?.mediaId === mediaId && audio.durationMs !== durationMs)
      actions.push({ type: 'audio/set', audio: { ...audio, durationMs } });
    if (actions.length === 0) return this.unchanged();
    // Not a change to the show: what Back and Put it back can undo stays (pointing at the layers as they are now).
    this.bookkeeping = true;
    try {
      return this.apply(actions);
    } finally {
      this.bookkeeping = false;
    }
  }

  /**
   * Layers as they were (Put it back, Back), with the lengths of their files
   * the library knows by now. An audio playlist playing now goes on as it is
   * (it is independent of the slides); one that was playing then comes back
   * where it would be now.
   */
  private withLengths(layers: Layers): Layers {
    const playing = this.state.layers.audio;
    if (playing?.music && layers.audio !== playing) layers = { ...layers, audio: playing };
    layers = this.withJumps(layers);
    // A video input as Media has it now (Session 50): renamed or set to fill since, it comes back so. One no
    // longer in this computer's list does not come back (no screen opens an input the list does not have).
    const was = layers.background;
    if (was?.kind === 'input') {
      const listed = this.asListed(was);
      if (!sameData(listed, was)) layers = { ...layers, background: listed };
    }
    // The same for a video input in the picture-in-picture box (S8-1, Session 51): nothing keeps it listed once the
    // box is off.
    const box = layers.pip;
    if (box?.source.kind === 'input') {
      const input = this.options.videoInput?.(box.source.inputId) ?? null;
      const listed = input
        ? { ...box, source: { ...box.source, name: input.name, device: input.device } }
        : null;
      if (!sameData(listed, box)) layers = { ...layers, pip: listed };
    }
    const bg = layers.background;
    const audio = layers.audio;
    const bgLength = bg?.kind === 'media' && bg.durationMs === undefined ? this.lengthOf(bg.mediaId) : {};
    const audioLength = audio && audio.durationMs === undefined ? this.lengthOf(audio.mediaId) : {};
    if (Object.keys(bgLength).length === 0 && Object.keys(audioLength).length === 0) return layers;
    return {
      ...layers,
      background: bg?.kind === 'media' ? { ...bg, ...bgLength } : bg,
      audio: audio ? { ...audio, ...audioLength } : null,
    };
  }

  /**
   * Layers as they were (Back), each file that plays on now as it did then (the same file, from the same
   * start) keeping where it has jumped to since: a marker, Back 15 s, Forward 15 s or Last 10 s (Session 50),
   * so undoing a Next moves the slides, not what plays.
   */
  private withJumps(layers: Layers): Layers {
    const keep = <T extends { mediaId: string | null; startedAt: number; seek?: PlaybackSeek }>(
      was: T,
      is: T | null,
    ): T => {
      if (!is || is.mediaId !== was.mediaId || is.startedAt !== was.startedAt || sameData(is.seek, was.seek))
        return was;
      const { seek: _then, ...rest } = was;
      return (is.seek ? { ...rest, seek: is.seek } : rest) as T;
    };
    const bg = layers.background;
    const bgNow = this.state.layers.background;
    const background = bg?.kind === 'media' ? keep(bg, bgNow?.kind === 'media' ? bgNow : null) : bg;
    const audio = layers.audio ? keep(layers.audio, this.state.layers.audio) : null;
    return background === bg && audio === layers.audio ? layers : { ...layers, background, audio };
  }

  /** The playlist's next items after the one playing, headers included (for a stage screen). */
  private upcoming(live: LiveCursor): UpcomingItem[] {
    const at = live.playlist ? this.checkItem(live.playlist) : null;
    if (!at) return [];
    const out: UpcomingItem[] = [];
    for (const item of at.items.slice(at.index + 1)) {
      if (out.length >= UPCOMING_ITEMS) break;
      if (item.kind === 'presentation')
        out.push({ id: item.id, label: item.label ?? '', kind: 'presentation' });
      else if (item.kind === 'media') out.push({ id: item.id, label: item.label, kind: 'media' });
      else if (item.kind === 'input') out.push({ id: item.id, label: item.label, kind: 'input' });
      else if (item.header) out.push({ id: item.id, label: item.label ?? '', kind: 'header' });
    }
    return out;
  }

  private unchanged(): CommandResult {
    return { ok: true, changed: false, rev: this.revision };
  }

  /** The order the live presentation plays in by its playlist item (undefined: the presentation's own). */
  private itemArrangement(live: LiveCursor): string | null | undefined {
    const found = live.playlist ? this.checkItem(live.playlist) : null;
    return found?.item.kind === 'presentation' && found.item.presentationId === live.presentationId
      ? found.item.arrangementId
      : undefined;
  }

  /** A playlist item that exists, with its neighbours. */
  private checkItem(
    cursor: PlaylistCursor,
  ): { cursor: PlaylistCursor; item: PlayItem; items: readonly PlayItem[]; index: number } | null {
    const items = this.playlists.items(cursor.playlistId);
    const index = items?.findIndex((i) => i.id === cursor.itemId) ?? -1;
    const item = items?.[index];
    return items && item
      ? { cursor: { playlistId: cursor.playlistId, itemId: item.id }, item, items, index }
      : null;
  }

  private showAction(
    presentationId: string,
    slideIndex: number,
    order: PlayOrder,
    played: PlayedSlide,
    playlist: PlaylistCursor | null,
    how: { at?: number; transition?: Transition; inputMissing?: string | null } = {},
  ): EngineAction {
    return {
      type: 'slide/show',
      presentationId,
      slideIndex,
      slideCount: order.slides.length,
      arrangementId: order.arrangementId,
      playlist,
      slide: played.slide,
      notes: played.notes,
      at: how.at ?? this.now(),
      ...(how.transition ? { transition: how.transition } : {}),
      ...(how.inputMissing !== undefined ? { inputMissing: how.inputMissing } : {}),
    };
  }

  /**
   * How a slide comes on: its own transition, else its presentation's, else
   * Drashti's default. Anything of no length is a cut, and a cut is left
   * out; but a slow zoom of no length still zooms. A slow zoom on a slide
   * that moves on by itself zooms until the next one has come on.
   */
  private transitionFor(order: PlayOrder, played: PlayedSlide): Transition | undefined {
    const t = played.transition ?? order.transition ?? this.options.defaultTransition?.() ?? CUT;
    if (t.kind === 'cut' || (t.durationMs <= 0 && t.kind !== 'zoom')) return undefined;
    const { spanMs: _span, ...plain } = t;
    const up = played.autoAdvanceMs ?? null;
    return t.kind === 'zoom' && up !== null && up > 0 ? { ...plain, spanMs: up + t.durationMs } : plain;
  }

  private showSlide(
    presentationId: string,
    slideIndex: number,
    arrangementId: string | null | undefined,
    playlist: PlaylistCursor | null,
  ): Resolved {
    const order = this.source.order(presentationId, arrangementId);
    if (!order)
      return { ok: false, error: 'unknown-presentation', message: `No presentation ${presentationId}` };
    const played = order.slides[slideIndex];
    if (!played) {
      return {
        ok: false,
        error: 'slide-out-of-range',
        message: `Slide ${slideIndex + 1} of ${order.slides.length} does not exist`,
      };
    }
    const at = this.now();
    const transition = this.transitionFor(order, played);
    // The slide's background and sound go on their layers; a slide without them leaves those layers as they are.
    // A new background comes on with the slide (dissolving with it); the same file carries on. A video input
    // (Session 51) is this computer's input of the name the cue keeps, coming on with its own fixed fade (the same
    // input carries on); with none of that name, the background stays as it was (never black because of it) and
    // the slide says which input it named, for LIVE to say so.
    const fade =
      transition && transition.durationMs > 0 ? { at, durationMs: transition.durationMs } : undefined;
    const layers: EngineAction[] = [];
    let inputMissing: string | null = null;
    for (const cue of played.cues) {
      if (cue.kind === 'background') {
        const bg = cue.background;
        if (bg.kind === 'input') {
          const input = this.options.inputNamed?.(bg.name) ?? null;
          if (input) layers.push({ type: 'background/set', background: this.inputLayer(input) });
          else inputMissing = bg.name;
        } else layers.push({ type: 'background/set', background: this.backgroundLayer(bg, fade) });
      } else {
        const { mediaId, volume, loop } = cue;
        layers.push({
          type: 'audio/set',
          audio: this.audioLayer({ id: mediaId, title: cue.label || cue.name, mediaId, volume, loop }),
        });
      }
    }
    const actions: EngineAction[] = [
      this.showAction(presentationId, slideIndex, order, played, playlist, {
        at,
        ...(transition ? { transition } : {}),
        inputMissing,
      }),
      ...layers,
    ];
    // A slide's macro cue (from before Session 44) stays in the library, and never runs: macros are gone.
    return { ok: true, actions };
  }

  /**
   * A picture or video item goes on the background layer and takes the
   * slide off (it is what the audience should see); a sound goes on the
   * audio layer and leaves the picture as it is.
   */
  private showMedia(cursor: PlaylistCursor, item: MediaItem): Resolved {
    const cue: EngineAction = { type: 'live/item', playlist: cursor };
    if (item.media === 'audio') {
      const { mediaId, label } = item;
      return {
        ok: true,
        actions: [
          cue,
          {
            type: 'audio/set',
            audio: this.audioLayer({ id: mediaId, title: label, mediaId, volume: 1, loop: false }),
          },
        ],
      };
    }
    const background = this.backgroundLayer({
      kind: 'media',
      mediaId: item.mediaId,
      media: item.media,
      fit: 'fit',
      loop: false,
    });
    return {
      ok: true,
      actions: [
        cue,
        { type: 'layer/clear', layer: 'slide', at: this.now() },
        { type: 'background/set', background },
      ],
    };
  }

  /**
   * A video input item (Session 51) goes up as a picture or video item does: the input as the background, with
   * its own fixed fade (the same input carries on), and the slide taken off. Null when this computer's list no
   * longer has it (removed since the playlist was read): nothing to play.
   */
  private showInputItem(cursor: PlaylistCursor, item: InputItem): Resolved | null {
    const input = this.options.videoInput?.(item.inputId) ?? null;
    if (!input) return null;
    return {
      ok: true,
      actions: [
        { type: 'live/item', playlist: cursor },
        { type: 'layer/clear', layer: 'slide', at: this.now() },
        { type: 'background/set', background: this.inputLayer(input) },
      ],
    };
  }

  /** Start a playlist item at its first or last slide. Null when it has nothing to play. */
  private startItem(playlistId: string, item: PlayItem, from: 'first' | 'last'): Resolved | null {
    const cursor = { playlistId, itemId: item.id };
    if (item.kind === 'media') return this.showMedia(cursor, item);
    if (item.kind === 'input') return this.showInputItem(cursor, item);
    if (item.kind === 'skip') return null;
    const order = this.source.order(item.presentationId, item.arrangementId);
    if (!order || order.slides.length === 0) return null;
    const index = from === 'first' ? 0 : order.slides.length - 1;
    return this.showSlide(item.presentationId, index, order.arrangementId, cursor);
  }

  /** The next (or previous) item that can play, stepping over headers, placeholders and anything gone. */
  private stepItem(cursor: PlaylistCursor, delta: 1 | -1, from: 'first' | 'last'): Resolved {
    const at = this.checkItem(cursor);
    if (!at) return NO_CHANGE;
    for (let i = at.index + delta; i >= 0 && i < at.items.length; i += delta) {
      const item = at.items[i];
      const started = item ? this.startItem(cursor.playlistId, item, from) : null;
      if (started) return started;
    }
    return NO_CHANGE;
  }

  /** The picture a live zoom zooms (Session 26e): a slide's own picture, else the background picture. */
  private zoomTarget(state: EngineState): { mediaId: string; showing: string } | null {
    const slide = state.layers.slide;
    const picture = slide?.slide.elements.find((e) => e.kind === 'image');
    if (slide && picture?.kind === 'image')
      return { mediaId: picture.mediaId, showing: slideShowing(slide.shownAt) };
    const bg = state.layers.background;
    if (bg?.kind === 'media' && bg.media === 'image')
      return { mediaId: bg.mediaId, showing: backgroundShowing(bg.startedAt) };
    return null;
  }

  /**
   * The looks of the pictures on the screens and coming next (Session 26e), and of a picture-in-picture box's
   * picture while its out plays (Session 50).
   */
  private picturesFor(state: EngineState): Record<string, PictureLook> {
    const look = this.options.pictureLook;
    if (!look) return {};
    const { now, next } = mediaInState(state);
    const leaving = leavingMedia(state.pipOff);
    const out: Record<string, PictureLook> = {};
    for (const id of [...now, ...next, ...(leaving === null ? [] : [leaving])]) {
      const found = look(id);
      if (found) out[id] = found;
    }
    return out;
  }

  /** A picture's look changed in the library (the Picture editor, Keep this zoom): the screens follow at once. */
  refreshPictures(): CommandResult {
    return this.atOnce(() => this.apply([{ type: 'pictures/set', pictures: this.picturesFor(this.state) }]));
  }

  /** The live zoom ends (kept as the picture's look, say): the screens show its kept look. */
  clearLiveZoom(): CommandResult {
    return this.apply([{ type: 'zoom/set', liveZoom: null }]);
  }

  /** A Repeat Slides playlist going round, as the state names it. */
  private repeatRun(playlistId: string): RepeatRun {
    return { playlistId, name: this.options.repeatName?.(playlistId) ?? 'Repeat Slides' };
  }

  /** A Repeat Slides playlist goes round, from its slide `slideIndex` (Session 26d). */
  private startRepeat(playlistId: string, slideIndex: number): Resolved {
    const presentationId = repeatPresentationId(playlistId);
    const order = this.source.order(presentationId);
    if (!order)
      return { ok: false, error: 'unknown-item', message: 'That Repeat Slides playlist no longer exists.' };
    if (order.slides.length === 0)
      return {
        ok: false,
        error: 'not-playable',
        message: 'That Repeat Slides playlist has no pictures or slides yet.',
      };
    const shown = this.showSlide(presentationId, Math.min(slideIndex, order.slides.length - 1), null, null);
    if (!shown.ok) return shown;
    return {
      ok: true,
      actions: [...shown.actions, { type: 'repeat/set', repeat: this.repeatRun(playlistId) }],
    };
  }

  private playItem(playlistId: string, itemId: string): Resolved {
    const found = this.checkItem({ playlistId, itemId });
    if (!found) return { ok: false, error: 'unknown-item', message: 'That playlist item no longer exists' };
    const { item } = found;
    const started = this.startItem(playlistId, item, 'first');
    if (started) return started;
    const message =
      item.kind === 'skip'
        ? item.why
        : item.kind === 'presentation'
          ? 'That presentation has no slides'
          : item.kind === 'input'
            ? 'That video input is not on this computer.'
            : 'That item cannot play';
    return { ok: false, error: 'not-playable', message };
  }

  /** A file's start and end points as the library has them (left out when it has none). */
  private clipOf(mediaId: string | null): { clip?: PlaybackClip; marks?: PlaybackMarker[] } {
    const m = mediaId ? (this.options.mediaMarkers?.(mediaId) ?? null) : null;
    if (!m) return {};
    return {
      ...(m.startMs !== null || m.endMs !== null
        ? { clip: { startMs: m.startMs ?? 0, endMs: m.endMs } }
        : {}),
      ...(m.markers.length > 0 ? { marks: m.markers } : {}),
    };
  }

  /**
   * A file's markers changed in the library: what is playing it now plays
   * between its new points (carrying on), with its new markers.
   */
  refreshMarkers(mediaId: string): CommandResult {
    const actions: EngineAction[] = [];
    const strip = <T extends { clip?: unknown; marks?: unknown }>(layer: T): T => {
      const { clip: _c, marks: _m, ...rest } = layer;
      return rest as T;
    };
    const bg = this.state.layers.background;
    if (bg?.kind === 'media' && bg.mediaId === mediaId)
      actions.push({ type: 'background/set', background: { ...strip(bg), ...this.clipOf(mediaId) } });
    const audio = this.state.layers.audio;
    if (audio?.mediaId === mediaId)
      actions.push({ type: 'audio/set', audio: { ...strip(audio), ...this.clipOf(mediaId) } });
    if (actions.length === 0) return this.unchanged();
    this.bookkeeping = true;
    try {
      return this.apply(actions);
    } finally {
      this.bookkeeping = false;
    }
  }

  /**
   * When a playing sound ends (ms since the epoch), from its start (or the
   * marker it jumped to) to its end point or the end of the file; null while
   * its length is not known.
   */
  private endsAt(a: AudioLayer): number | null {
    if (a.durationMs === undefined) return null;
    const start = Math.min(a.durationMs, a.clip?.startMs ?? 0);
    const end = Math.max(start, Math.min(a.durationMs, a.clip?.endMs ?? a.durationMs));
    if (a.seek) return a.seek.at + Math.max(0, end - Math.min(end, Math.max(start, a.seek.toMs)));
    return a.startedAt + (end - start);
  }

  /** How long a playing sound has played since its start point (ms), jumps included. */
  private playedOf(a: AudioLayer, now: number): number {
    if (a.seek) return Math.max(0, a.seek.toMs - (a.clip?.startMs ?? 0)) + Math.max(0, now - a.seek.at);
    return Math.max(0, now - a.startedAt);
  }

  /**
   * What the library says of a video or a sound put back after an unexpected stop (Session 51): its start and
   * end points and markers as they are now (restart recovery keeps none of them: the library is where they
   * live, as refreshMarkers has it), and its length when it was not known.
   */
  private libraryOf(
    mediaId: string | null,
    durationMs: number | undefined,
  ): { durationMs?: number; clip?: PlaybackClip; marks?: PlaybackMarker[] } {
    return { ...(durationMs === undefined ? this.lengthOf(mediaId) : {}), ...this.clipOf(mediaId) };
  }

  /** A file's length when the library knows it (left out otherwise). */
  private lengthOf(mediaId: string | null): { durationMs?: number } {
    const ms = mediaId ? (this.options.mediaLength?.(mediaId) ?? null) : null;
    return ms !== null && ms > 0 ? { durationMs: ms } : {};
  }

  /** An audio playlist's track on the audio layer, from `startedAt`. */
  private musicLayer(music: MusicRun, startedAt: number): AudioLayer {
    const track = music.tracks[music.index] ?? music.tracks[0];
    return {
      id: `music:${music.playlistId}`,
      title: track?.title ?? '',
      mediaId: track?.mediaId ?? null,
      volume: 1,
      loop: false,
      startedAt,
      music,
      ...this.lengthOf(track?.mediaId ?? null),
      ...this.clipOf(track?.mediaId ?? null),
    };
  }

  /**
   * The track `by` away, from `startedAt`: round again at the end when the
   * playlist loops, and otherwise the end (the layer clears); before the
   * first track, the first (or, looping, the last).
   */
  private musicStep(a: MusicLayer, by: 1 | -1, startedAt: number): EngineAction {
    const m = a.music;
    let index = m.index + by;
    if (index >= m.tracks.length) {
      if (!m.loop) return { type: 'layer/clear', layer: 'audio' };
      index = 0;
    }
    if (index < 0) index = m.loop ? m.tracks.length - 1 : 0;
    return { type: 'audio/set', audio: this.musicLayer({ ...m, index }, startedAt) };
  }

  private musicNow(): MusicLayer | null {
    const a = this.state.layers.audio;
    return a?.music ? (a as MusicLayer) : null;
  }

  /**
   * Back 15 s, Forward 15 s or Last 10 s (Session 50) on the background video or the sound playing: a jump,
   * made as a jump to a marker is (the layer's seek), so every screen, the audio player, the nodes and the
   * stream play on from there in step. At the end, the end does what it always does: a looping file goes
   * round, one played once holds its end, an audio playlist's track goes on to the next. A paused track waits
   * at its new point: at a track's end, the next waits at its start; the last waits at its end.
   */
  private skip(layer: 'background' | 'audio', jump: SkipJump): Resolved {
    const now = this.now();
    const noLength: Resolved = {
      ok: false,
      error: 'no-length',
      message: 'Its length is not known yet: try again in a moment, once it has started playing.',
    };
    if (layer === 'background') {
      const bg = this.state.layers.background;
      if (bg?.kind !== 'media' || bg.media !== 'video')
        return { ok: false, error: 'nothing-playing', message: 'No video is playing as the background.' };
      const to = skipFrom(bg, jump, now);
      if (!to) return noLength;
      if (to.toMs === to.atMs) return NO_CHANGE;
      return {
        ok: true,
        actions: [{ type: 'background/set', background: { ...bg, seek: { at: now, toMs: to.toMs } } }],
      };
    }
    const a = this.state.layers.audio;
    if (!a?.mediaId) return { ok: false, error: 'nothing-playing', message: 'No sound is playing.' };
    const to = skipFrom(a, jump, now);
    if (!to) return noLength;
    // An audio playlist's track at its end: on to the next track, as at any end.
    const next = a.music && to.atEnd ? this.musicStep(a as MusicLayer, 1, now) : null;
    if (a.pausedAtMs !== undefined) {
      if (next?.type === 'audio/set')
        return { ok: true, actions: [{ type: 'audio/set', audio: { ...next.audio, pausedAtMs: 0 } }] };
      // The last track waits at its end: Back 15 s can still bring it back, and Play ends the music.
      const pausedAtMs = to.toMs - to.startMs;
      if (pausedAtMs === a.pausedAtMs) return NO_CHANGE;
      return { ok: true, actions: [{ type: 'audio/set', audio: { ...a, pausedAtMs } }] };
    }
    if (next) return { ok: true, actions: [next] };
    if (to.toMs === to.atMs) return NO_CHANGE;
    return { ok: true, actions: [{ type: 'audio/set', audio: { ...a, seek: { at: now, toMs: to.toMs } } }] };
  }

  /** The audio layer for a choice: as with backgrounds, the file already playing carries on. */
  private audioLayer(choice: AudioChoice): AudioLayer {
    const current = this.state.layers.audio;
    const same = choice.mediaId !== null && current?.mediaId === choice.mediaId;
    return {
      ...choice,
      startedAt: same ? current.startedAt : this.now(),
      ...this.lengthOf(choice.mediaId),
      ...this.clipOf(choice.mediaId),
      // The same file carrying on keeps a jump it made.
      ...(same && current.seek ? { seek: current.seek } : {}),
    };
  }

  /**
   * The background layer for a choice. The file already on the layer keeps
   * its start time, so it carries on playing instead of restarting.
   */
  private backgroundLayer(
    choice: BackgroundChoice,
    fade?: { at: number; durationMs: number },
  ): BackgroundLayer {
    if (choice.kind === 'color') return choice;
    const current = this.state.layers.background;
    const length = this.lengthOf(choice.mediaId);
    const clip = this.clipOf(choice.mediaId);
    if (current?.kind === 'media' && current.mediaId === choice.mediaId)
      return {
        ...choice,
        startedAt: current.startedAt,
        ...(current.fade ? { fade: current.fade } : {}),
        ...length,
        ...clip,
        // The same file carrying on keeps a jump it made.
        ...(current.seek ? { seek: current.seek } : {}),
      };
    return { ...choice, startedAt: fade?.at ?? this.now(), ...(fade ? { fade } : {}), ...length, ...clip };
  }

  /**
   * A video input as the background layer (Session 50). A new one dissolves in from the background before, over
   * INPUT_FADE_MS (as a video does with its slide; never a cut, never through black); the one already up carries
   * on, with its time and fade, as Media has it now.
   */
  private inputLayer(input: VideoInput): InputBackground {
    const current = this.state.layers.background;
    const listed = { inputId: input.id, name: input.name, device: input.device, fit: input.fit };
    if (current?.kind === 'input' && current.inputId === input.id) return { ...current, ...listed };
    const at = this.now();
    return { kind: 'input', ...listed, startedAt: at, fade: { at, durationMs: INPUT_FADE_MS } };
  }

  /** An input background as this computer's list has it now (its time kept), or null when it is not there. */
  private asListed(layer: InputBackground): InputBackground | null {
    const input = this.options.videoInput?.(layer.inputId) ?? null;
    return input ? { ...layer, name: input.name, device: input.device, fit: input.fit } : null;
  }

  /**
   * Next / previous: one slide along the live presentation. At either end,
   * a presentation played from a playlist goes on to the next item's first
   * slide (or back to the previous item's last), stepping over headers and
   * placeholders; otherwise nothing changes, so Next never repeats a slide.
   * After the slide layer is cleared the cursor stays put, so Next shows the
   * following slide.
   */
  /** What was cued (the arti at its time), from its first slide; in its playlist when the playlist has it. */
  private playCue(): Resolved | null {
    const cue = this.state.cue;
    if (!cue) return null;
    const item = cue.playlist ? this.checkItem(cue.playlist) : null;
    const arrangement = item?.item.kind === 'presentation' ? item.item.arrangementId : undefined;
    const order = this.source.order(cue.presentationId, arrangement);
    if (!order || order.slides.length === 0) return null;
    const shown = this.showSlide(cue.presentationId, 0, order.arrangementId, item?.cursor ?? null);
    return shown.ok ? { ok: true, actions: [...shown.actions, { type: 'cue/set', cue: null }] } : shown;
  }

  private step(delta: 1 | -1): Resolved {
    // Next plays what was cued.
    const cued = delta > 0 ? this.playCue() : null;
    if (cued) return cued;
    const { presentationId, slideIndex, arrangementId, playlist } = this.state.live;
    if (presentationId !== null && slideIndex !== null) {
      // Along the order being played: a repeated chorus comes up again.
      const order = this.source.order(presentationId, arrangementId);
      if (!order && !playlist)
        return { ok: false, error: 'unknown-presentation', message: `No presentation ${presentationId}` };
      if (order) {
        const count = order.slides.length;
        let target = slideIndex + delta;
        // If the presentation got shorter underneath us, Previous goes to its last slide.
        if (delta < 0 && target >= count) target = count - 1;
        // Repeat Slides goes round by hand too: after the last, the first, and before the first, the last.
        if (repeatPlaylistOf(presentationId) !== null && count > 0) target = (target + count) % count;
        if (target >= 0 && target < count)
          return this.showSlide(presentationId, target, order.arrangementId, playlist);
      }
    }
    if (playlist) return this.stepItem(playlist, delta, delta > 0 ? 'first' : 'last');
    if (presentationId === null) return { ok: false, error: 'nothing-live', message: 'Nothing is live yet' };
    return NO_CHANGE;
  }

  /** What Next will show from here: what was cued, else the next slide or item. */
  private upNext(live: LiveCursor, cue: CuedNext | null = this.state.cue): UpNext | null {
    if (cue) {
      const item = cue.playlist ? this.checkItem(cue.playlist) : null;
      const arrangement = item?.item.kind === 'presentation' ? item.item.arrangementId : undefined;
      const first = this.source.order(cue.presentationId, arrangement)?.slides[0];
      if (first) return this.slideUpNext(cue.presentationId, 0, first, item?.cursor.itemId ?? null);
    }
    if (live.presentationId !== null && live.slideIndex !== null) {
      const order = this.source.order(live.presentationId, live.arrangementId);
      // Repeat Slides comes round to its first slide after its last.
      const index =
        order && repeatPlaylistOf(live.presentationId) !== null && order.slides.length > 1
          ? (live.slideIndex + 1) % order.slides.length
          : live.slideIndex + 1;
      const following = order?.slides[index];
      if (following && index !== live.slideIndex)
        return this.slideUpNext(live.presentationId, index, following, null);
    }
    const at = live.playlist ? this.checkItem(live.playlist) : null;
    if (!at) return null;
    for (const item of at.items.slice(at.index + 1)) {
      if (item.kind === 'media')
        return {
          kind: 'media',
          itemId: item.id,
          mediaId: item.mediaId,
          media: item.media,
          label: item.label,
        };
      // A video input item (Session 51), as Media has it now; one gone from the list since is stepped over.
      if (item.kind === 'input') {
        const input = this.options.videoInput?.(item.inputId) ?? null;
        if (input)
          return { kind: 'input', itemId: item.id, inputId: input.id, name: input.name, label: item.label };
      }
      if (item.kind === 'presentation') {
        const first = this.source.order(item.presentationId, item.arrangementId)?.slides[0];
        if (first) return this.slideUpNext(item.presentationId, 0, first, item.id);
      }
    }
    return null;
  }

  private slideUpNext(
    presentationId: string,
    slideIndex: number,
    played: PlayedSlide,
    itemId: string | null,
  ): UpNext {
    const cue = played.cues.find((c): c is BackgroundCue => c.kind === 'background');
    const bg = cue?.background;
    return {
      kind: 'slide',
      presentationId,
      slideIndex,
      slide: played.slide,
      background: cue?.unplayable === null && !cue.missing && bg?.kind === 'media' ? bg : null,
      // A video input behind it (Session 51), by the name its cue keeps.
      ...(bg?.kind === 'input' ? { input: bg.name } : {}),
      itemId,
      notes: played.notes,
    };
  }

  private resolve(command: EngineCommand): Resolved {
    switch (command.type) {
      case 'goLive': {
        // One of a Repeat Slides playlist's slides put up: it goes round from there (Session 26d).
        const repeating = repeatPlaylistOf(command.presentationId);
        if (repeating !== null) return this.startRepeat(repeating, command.slideIndex);
        // Played from a playlist item: only when the item is that presentation, so Next knows where to go.
        const found = command.playlist ? this.checkItem(command.playlist) : null;
        const playlist =
          found?.item.kind === 'presentation' && found.item.presentationId === command.presentationId
            ? found.cursor
            : null;
        return this.showSlide(command.presentationId, command.slideIndex, command.arrangementId, playlist);
      }
      case 'playItem':
        return this.playItem(command.playlistId, command.itemId);
      case 'startRepeat':
        return this.startRepeat(command.playlistId, command.slideIndex ?? 0);
      case 'zoomLive':
      case 'resetLiveZoom': {
        // The picture on the screens: the slide's own picture, else the background picture.
        const target = this.zoomTarget(this.state);
        if (!target)
          return { ok: false, error: 'no-picture', message: 'No picture is on the screens to zoom.' };
        const kept = this.options.pictureLook?.(target.mediaId) ?? PLAIN;
        const z = this.state.liveZoom;
        const now = this.now();
        const from =
          z?.mediaId === target.mediaId && z.showing === target.showing
            ? liveZoomAt(z, now)
            : { zoom: kept.zoom, x: kept.x, y: kept.y };
        const to =
          command.type === 'resetLiveZoom'
            ? { zoom: kept.zoom, x: kept.x, y: kept.y }
            : framed({ ...kept, zoom: command.zoom, x: command.x, y: command.y });
        const liveZoom: LiveZoom = { ...target, zoom: to.zoom, x: to.x, y: to.y, from, at: now };
        return { ok: true, actions: [{ type: 'zoom/set', liveZoom }] };
      }
      case 'stopRepeat':
        // The slide on the screens stays up; it no longer moves on.
        return this.state.repeat
          ? { ok: true, actions: [{ type: 'repeat/set', repeat: null }] }
          : { ok: false, error: 'not-repeating', message: 'Nothing is repeating.' };
      case 'next':
        return this.step(1);
      case 'previous':
        return this.step(-1);
      case 'back': {
        // Undo the last Next exactly, while what it left is still on the screens.
        const last = this.steps.at(-1);
        if (last?.toLive === this.state.live && last.toLayers === this.state.layers) {
          this.steps.pop();
          return {
            ok: true,
            actions: [{ type: 'show/put', live: last.live, layers: this.withLengths(last.layers) }],
          };
        }
        this.steps = [];
        return this.step(-1);
      }
      case 'nextItem':
      case 'previousItem': {
        const { playlist } = this.state.live;
        if (!playlist)
          return { ok: false, error: 'nothing-live', message: 'Nothing is playing from a playlist' };
        return this.stepItem(playlist, command.type === 'nextItem' ? 1 : -1, 'first');
      }
      case 'clearLayer':
        return { ok: true, actions: [{ type: 'layer/clear', layer: command.layer, at: this.now() }] };
      case 'clearAll':
        return { ok: true, actions: [{ type: 'layers/clearAll' }] };
      case 'putBack': {
        const cleared = this.cleared;
        if (cleared?.to !== this.state.layers)
          return {
            ok: false,
            error: 'nothing-to-put-back',
            message: 'There is nothing to put back: something else has gone up since Clear all.',
          };
        return {
          ok: true,
          actions: [
            { type: 'show/put', live: this.state.live, layers: this.withLengths(cleared.from) },
            // Repeat Slides that was going round goes round again.
            ...(cleared.repeat ? [{ type: 'repeat/set' as const, repeat: cleared.repeat }] : []),
          ],
        };
      }
      case 'setBlackout':
        return { ok: true, actions: [{ type: 'blackout/set', on: command.on }] };
      case 'toggleBlackout':
        return { ok: true, actions: [{ type: 'blackout/set', on: !this.state.blackout }] };
      case 'showLogo':
        return { ok: true, actions: [{ type: 'logo/set', prop: command.prop, at: this.now() }] };
      case 'hideLogo':
        return { ok: true, actions: [{ type: 'logo/set', prop: null }] };
      case 'setBackground':
        return {
          ok: true,
          actions: [{ type: 'background/set', background: this.backgroundLayer(command.background) }],
        };
      case 'playAudio':
        return { ok: true, actions: [{ type: 'audio/set', audio: this.audioLayer(command.audio) }] };
      case 'showProp':
        return { ok: true, actions: [{ type: 'prop/show', prop: command.prop, at: this.now() }] };
      case 'hideProp':
        return { ok: true, actions: [{ type: 'prop/hide', propId: command.propId }] };
      case 'showMessage':
        return { ok: true, actions: [{ type: 'message/show', message: command.message, at: this.now() }] };
      case 'hideMessage':
        return { ok: true, actions: [{ type: 'message/hide', messageId: command.messageId }] };
      case 'setMask':
        return { ok: true, actions: [{ type: 'mask/set', mask: command.mask }] };
      case 'showLowerThird':
        return {
          ok: true,
          actions: [{ type: 'lowerThird/show', layer: { ...command.lowerThird, shownAt: this.now() } }],
        };
      case 'hideLowerThird':
        return this.state.layers.lowerThird
          ? { ok: true, actions: [{ type: 'lowerThird/hide', at: this.now() }] }
          : NO_CHANGE;
      case 'startTimer':
        return this.runTimer(command.timerId, 'start');
      case 'pauseTimer':
        return this.runTimer(command.timerId, 'pause');
      case 'resetTimer':
        return this.runTimer(command.timerId, 'reset');
      case 'setStageMessage':
        return { ok: true, actions: [{ type: 'stage/message', text: command.text }] };
      case 'clearStageMessage':
        return { ok: true, actions: [{ type: 'stage/message', text: null }] };
      case 'cueNext': {
        const order = this.source.order(command.presentationId);
        if (!order || order.slides.length === 0)
          return {
            ok: false,
            error: 'unknown-presentation',
            message: `No presentation ${command.presentationId}`,
          };
        // In the live playlist, when it has that presentation: the show then goes on through the playlist.
        const at = this.state.live.playlist;
        const items = at ? (this.playlists.items(at.playlistId) ?? []) : [];
        const item = items.find(
          (i) => i.kind === 'presentation' && i.presentationId === command.presentationId,
        );
        const cue: CuedNext = {
          presentationId: command.presentationId,
          label: command.label,
          playlist: at && item ? { playlistId: at.playlistId, itemId: item.id } : null,
        };
        return { ok: true, actions: [{ type: 'cue/set', cue }] };
      }
      case 'clearCue':
        return { ok: true, actions: [{ type: 'cue/set', cue: null }] };
      case 'playCue':
        return this.playCue() ?? { ok: false, error: 'nothing-cued', message: 'Nothing is cued' };
      case 'startIdle':
        return this.state.idle.startedAt === null
          ? { ok: true, actions: [{ type: 'idle/run', startedAt: this.now() }] }
          : NO_CHANGE;
      case 'stopIdle':
        return this.state.idle.startedAt === null
          ? NO_CHANGE
          : { ok: true, actions: [{ type: 'idle/run', startedAt: null }] };
      case 'setLook': {
        const look = this.options.looks?.look(command.lookId) ?? null;
        if (!look) return { ok: false, error: 'unknown-look', message: 'That look no longer exists' };
        return { ok: true, actions: [{ type: 'look/set', look }] };
      }
      case 'playMusic': {
        const index = Math.min(command.index, command.music.tracks.length - 1);
        return {
          ok: true,
          actions: [{ type: 'audio/set', audio: this.musicLayer({ ...command.music, index }, this.now()) }],
        };
      }
      case 'pauseMusic': {
        const a = this.musicNow();
        if (!a) return { ok: false, error: 'no-music', message: 'No audio playlist is playing' };
        if (a.pausedAtMs !== undefined) return NO_CHANGE;
        const into = this.playedOf(a, this.now());
        const pausedAtMs = a.durationMs !== undefined ? Math.min(into, a.durationMs) : into;
        const { seek: _jump, ...rest } = a;
        return { ok: true, actions: [{ type: 'audio/set', audio: { ...rest, pausedAtMs } }] };
      }
      case 'resumeMusic': {
        const a = this.musicNow();
        if (!a) return { ok: false, error: 'no-music', message: 'No audio playlist is playing' };
        if (a.pausedAtMs === undefined) return NO_CHANGE;
        const { pausedAtMs, ...playing } = a;
        return {
          ok: true,
          actions: [{ type: 'audio/set', audio: { ...playing, startedAt: this.now() - pausedAtMs } }],
        };
      }
      case 'musicNext':
      case 'musicPrevious': {
        const a = this.musicNow();
        if (!a) return { ok: false, error: 'no-music', message: 'No audio playlist is playing' };
        return { ok: true, actions: [this.musicStep(a, command.type === 'musicNext' ? 1 : -1, this.now())] };
      }
      case 'jumpToMarker': {
        const layer = command.layer === 'audio' ? this.state.layers.audio : this.state.layers.background;
        const mediaId = layer && 'mediaId' in layer ? layer.mediaId : null;
        const marker = mediaId
          ? this.options.mediaMarkers?.(mediaId)?.markers.find((m) => m.id === command.markerId)
          : undefined;
        if (!layer || !mediaId || !marker)
          return { ok: false, error: 'unknown-marker', message: 'That marker is not on what is playing' };
        const seek = { at: this.now(), toMs: marker.atMs };
        if (command.layer === 'audio' && this.state.layers.audio) {
          const { pausedAtMs: _paused, ...audio } = this.state.layers.audio;
          return { ok: true, actions: [{ type: 'audio/set', audio: { ...audio, seek } }] };
        }
        const bg = this.state.layers.background;
        if (bg?.kind !== 'media')
          return { ok: false, error: 'unknown-marker', message: 'Nothing is playing there' };
        return { ok: true, actions: [{ type: 'background/set', background: { ...bg, seek } }] };
      }
      case 'skip':
        return this.skip(command.layer, command.jump);
      case 'setMusicLoop': {
        const a = this.musicNow();
        if (!a) return { ok: false, error: 'no-music', message: 'No audio playlist is playing' };
        if (a.music.loop === command.loop) return NO_CHANGE;
        return {
          ok: true,
          actions: [{ type: 'audio/set', audio: { ...a, music: { ...a.music, loop: command.loop } } }],
        };
      }
      case 'showTimer':
        return this.showTimer(command.timerId);
      // Picture in picture (Session 50, pip.ts): what the box holds is looked up here, never taken from a page.
      case 'showPip':
        return showPip(this.state.layers.pip, command.source, command.place, this.now(), this.options);
      case 'hidePip':
        return hidePip(this.state.layers.pip, this.now());
      case 'swapPip':
        return swapPip(this.state.layers.pip, this.now());
      case 'placePip':
        return placePip(this.state.layers.pip, command.place, this.now());
      case 'showInput': {
        // Only an input of this computer's list, looked up here: a page never names a device (Session 50).
        const input = this.options.videoInput?.(command.inputId) ?? null;
        if (!input)
          return { ok: false, error: 'unknown-input', message: 'That video input is not on this computer.' };
        return { ok: true, actions: [{ type: 'background/set', background: this.inputLayer(input) }] };
      }
    }
  }

  /**
   * Keep what Put it back and Back can undo. Clear all remembers what it took
   * down; each Next remembers what was there before it. Anything else that
   * changes the layers or the position forgets them (black-out, the logo,
   * timers and the stage message do not).
   */
  private keepUndo(prev: EngineState, next: EngineState, cause: EngineCommandType | null): EngineState {
    if (this.bookkeeping) {
      // What Back and Put it back would undo to stays, now as the layers are.
      if (this.cleared?.to === prev.layers) this.cleared = { ...this.cleared, to: next.layers };
      const last = this.steps.at(-1);
      if (last?.toLayers === prev.layers) last.toLayers = next.layers;
      return next;
    }
    if (cause === 'clearAll') {
      if (next.layers !== prev.layers)
        this.cleared = { from: prev.layers, to: next.layers, repeat: prev.repeat };
    } else if (this.cleared && next.layers !== this.cleared.to) {
      this.cleared = null;
    }
    const moved = next.layers !== prev.layers || next.live !== prev.live;
    if ((cause === 'next' || cause === 'nextItem') && moved) {
      this.steps.push({ live: prev.live, layers: prev.layers, toLive: next.live, toLayers: next.layers });
      if (this.steps.length > MAX_STEPS) this.steps.shift();
    } else if (cause !== 'back' && moved) {
      this.steps = [];
    }
    const canPutBack = this.cleared !== null;
    return next.canPutBack === canPutBack ? next : { ...next, canPutBack };
  }

  private apply(actions: readonly EngineAction[], cause: EngineCommandType | null = null): CommandResult {
    return this.atOnce(() => this.applyAt(actions, cause));
  }

  private applyAt(actions: readonly EngineAction[], cause: EngineCommandType | null): CommandResult {
    const prev = this.state;
    let next = actions.reduce(reduce, prev);
    // Repeat Slides goes round only while its slides are up: anything else going up, Clear all or the
    // slide cleared ends it (Stop and Esc leave its slide up).
    if (next.repeat && next.layers.slide?.presentationId !== repeatPresentationId(next.repeat.playlistId))
      next = reduce(next, { type: 'repeat/set', repeat: null });
    // A live zoom lasts for that showing only (Session 26e): another slide or background ends it.
    const zoomed = next.liveZoom;
    if (zoomed) {
      const target = this.zoomTarget(next);
      if (target?.mediaId !== zoomed.mediaId || target.showing !== zoomed.showing)
        next = reduce(next, { type: 'zoom/set', liveZoom: null });
    }
    // The idle rotation, once started, stops by itself when a slide or a picture goes up (so a later
    // Clear all does not bring it back): a picture-in-picture box too, as it goes up (Session 50).
    const boxUp = next.layers.pip;
    if (
      next.idle.startedAt !== null &&
      next.idle === prev.idle &&
      ((next.layers.slide !== null && next.layers.slide !== prev.layers.slide) ||
        (next.layers.background !== null && next.layers.background !== prev.layers.background) ||
        (boxUp !== null && boxUp.shownAt !== prev.layers.pip?.shownAt))
    )
      next = reduce(next, { type: 'idle/run', startedAt: null });
    // What was cued goes once it is live (however it got there).
    if (next.live !== prev.live && next.live.presentationId === next.cue?.presentationId)
      next = reduce(next, { type: 'cue/set', cue: null });
    // A new position (or a cue) has a new slide after it, and other items coming up.
    if (next.live !== prev.live || next.cue !== prev.cue) {
      const upNext = this.upNext(next.live, next.cue);
      if (!sameData(next.next, upNext)) next = reduce(next, { type: 'next/set', next: upNext });
      next = reduce(next, { type: 'upcoming/set', upcoming: this.upcoming(next.live) });
    }
    // A playlist item going up runs its timer cues, in the same change (not when Back, Previous or
    // recovery come back to it).
    const item = next.live.playlist;
    if (item && item.itemId !== prev.live.playlist?.itemId && cause !== null && !BACKWARDS.has(cause))
      next = this.timerCueActions(item, next).reduce(reduce, next);
    // An audio playlist's track that has ended by now (put back, recovered, or just ended) moves on.
    const audio = this.caughtUp(next.layers.audio);
    if (audio !== next.layers.audio)
      next = reduce(next, audio ? { type: 'audio/set', audio } : { type: 'layer/clear', layer: 'audio' });
    // The pictures on the screens and coming next carry their looks (Session 26e).
    if (
      next.layers !== prev.layers ||
      next.next !== prev.next ||
      next.idle !== prev.idle ||
      next.logo !== prev.logo ||
      next.pipOff !== prev.pipOff
    )
      next = reduce(next, { type: 'pictures/set', pictures: this.picturesFor(next) });
    next = this.keepUndo(prev, next, cause);
    next = this.withAutoAdvance(prev, next);
    if (next === prev) return this.unchanged();
    const ops = diffState(prev, next);
    this.state = next;
    const baseRev = this.revision;
    this.revision += 1;
    this.transport.broadcast({
      kind: 'patch',
      version: ENGINE_STATE_VERSION,
      baseRev,
      rev: this.revision,
      ops,
      sentAt: this.now(),
    });
    for (const listener of this.listeners) listener(next);
    this.scheduleAdvance();
    this.scheduleMusic();
    this.scheduleZero();
    return { ok: true, changed: true, rev: this.revision };
  }

  /** What identifies an audio playlist's track as it plays: a new key, a new wait. */
  private musicKey(a: MusicLayer | null): string | null {
    if (!a || a.pausedAtMs !== undefined) return null;
    return `${a.music.playlistId}/${String(a.music.index)}@${String(a.startedAt)}/${String(this.endsAt(a) ?? '?')}`;
  }

  /** Wait for the track playing to end (its start and length; a file that never says how long is passed). */
  private scheduleMusic(): void {
    const a = this.musicNow();
    const key = this.musicKey(a);
    if (key === (this.musicWait?.key ?? null)) return;
    this.musicWait?.cancel();
    this.musicWait = null;
    if (!a || key === null) return;
    const ends = this.endsAt(a) ?? a.startedAt + MUSIC_UNKNOWN_LENGTH_MS;
    const schedule =
      this.options.schedule ??
      ((ms: number, run: () => void) => {
        const t = setTimeout(run, ms);
        return () => {
          clearTimeout(t);
        };
      });
    const cancel = schedule(Math.max(0, ends - this.now()), () => {
      if (this.musicWait?.key === key) this.musicWait = null;
      this.musicEnded(key);
      // A timer can come a moment early (its clock and this one differ by a millisecond or so): then
      // nothing has ended yet and nothing changed, so wait again for what is left.
      this.scheduleMusic();
    });
    this.musicWait = { key, cancel };
  }

  /**
   * The audio playlist's track where it would be by now: every track that
   * would have ended since is passed, each next one starting where the last
   * ended (after Put it back, Back or recovery, and as a track ends). Null
   * when the playlist ended meanwhile.
   */
  private caughtUp(audio: AudioLayer | null): AudioLayer | null {
    if (!audio?.music || audio.pausedAtMs !== undefined) return audio;
    const now = this.now();
    let a = audio as MusicLayer;
    for (let i = 0; i < 1000; i++) {
      const ends = this.endsAt(a);
      if (ends === null || ends > now) break;
      const step = this.musicStep(a, 1, ends);
      if (step.type !== 'audio/set') return null;
      a = step.audio as MusicLayer;
    }
    return a;
  }

  /**
   * A track ended (or, with no length known, will not play): on to the next.
   * Not a change to the show: Back and Put it back keep what they undo.
   */
  private musicEnded(key: string): void {
    this.atOnce(() => {
      const a = this.musicNow();
      if (!a || this.musicKey(a) !== key) return;
      this.bookkeeping = true;
      try {
        // A known length: catching up (in applyAt) moves on; a file that never said: passed now.
        this.apply(a.durationMs === undefined ? [this.musicStep(a, 1, this.now())] : []);
      } finally {
        this.bookkeeping = false;
      }
    });
  }

  /**
   * Auto-advance (PLAN.md 5.2, Session 7): the slide on the screens counts
   * down when it says so and there is somewhere to go (a slide after it,
   * or the first again when the presentation loops). A different slide
   * coming on (whatever the operator did) starts its own count; the slide
   * going off stops it; the same slide with new content (an edit) keeps
   * its start. Black-out and the logo change no slide, so they leave it.
   */
  private withAutoAdvance(prev: EngineState, next: EngineState): EngineState {
    const want = this.countFor(prev, next);
    return sameData(next.autoAdvance, want) ? next : { ...next, autoAdvance: want };
  }

  private countFor(prev: EngineState, next: EngineState): EngineState['autoAdvance'] {
    const slide = next.layers.slide;
    if (!slide) return null;
    // A slide on the screens from a presentation that is not the one playing (it cannot move on).
    if (next.live.presentationId !== slide.presentationId) return null;
    // Repeat Slides moves on only while it is going round: stopped, its slide stays up as it is.
    const repeating = repeatPlaylistOf(slide.presentationId);
    if (repeating !== null && next.repeat?.playlistId !== repeating) return null;
    const order = this.source.order(slide.presentationId, next.live.arrangementId);
    const played = order?.slides[slide.slideIndex];
    const ms = played?.autoAdvanceMs ?? null;
    if (!order || !played || ms === null || ms <= 0) return null;
    const goesOn =
      slide.slideIndex + 1 < order.slides.length || (order.loop === true && order.slides.length > 1);
    if (!goesOn) return null;
    const before = prev.layers.slide;
    const same =
      before?.presentationId === slide.presentationId &&
      before.slide.id === slide.slide.id &&
      before.shownAt === slide.shownAt;
    const running = next.autoAdvance;
    // Repeat Slides' settings changed take effect from the next slide: this one keeps its count.
    if (same && running && repeating !== null) return running;
    return same && running
      ? { startedAt: running.startedAt, durationMs: ms }
      : { startedAt: this.now(), durationMs: ms };
  }

  /** Wait for the count to run out (again when it changed). */
  private scheduleAdvance(): void {
    const count = this.state.autoAdvance;
    if (sameData(count, this.scheduled)) return;
    this.cancelScheduled?.();
    this.cancelScheduled = null;
    this.scheduled = count;
    if (!count) return;
    const delay = Math.max(0, count.startedAt + count.durationMs - this.now());
    const schedule =
      this.options.schedule ??
      ((ms: number, run: () => void) => {
        const t = setTimeout(run, ms);
        return () => {
          clearTimeout(t);
        };
      });
    this.cancelScheduled = schedule(delay, () => {
      this.cancelScheduled = null;
      this.scheduled = null;
      this.advance(count);
    });
  }

  /** The count ran out: on to the next slide in play order, or the first when looping. */
  private advance(count: { startedAt: number; durationMs: number }): void {
    this.atOnce(() => {
      if (!sameData(this.state.autoAdvance, count)) return;
      const { presentationId, slideIndex, arrangementId, playlist } = this.state.live;
      if (presentationId === null || slideIndex === null) return;
      const order = this.source.order(presentationId, arrangementId);
      const target = order && slideIndex + 1 < order.slides.length ? slideIndex + 1 : order?.loop ? 0 : null;
      if (!order || target === null) {
        this.apply([{ type: 'advance/set', autoAdvance: null }]);
        return;
      }
      const shown = this.showSlide(presentationId, target, order.arrangementId, playlist);
      if (shown.ok) this.apply(shown.actions);
    });
  }

  /** Run `run` after `ms` (the schedule option's way when given); returns how to cancel it. */
  private wait(ms: number, run: () => void): () => void {
    if (this.options.schedule) return this.options.schedule(ms, run);
    const t = setTimeout(run, ms);
    return () => {
      clearTimeout(t);
    };
  }

  /**
   * When the slide up goes on at zero (Session 50): the soonest of its countdowns that say so and are running,
   * that had not reached zero when it went up, while it is the live presentation's slide. Null when none.
   */
  private zeroFor(state: EngineState): { at: number; key: string } | null {
    const slide = state.layers.slide;
    if (!slide || slide.timer || state.live.presentationId !== slide.presentationId) return null;
    let at: number | null = null;
    for (const el of slide.slide.elements) {
      if (el.kind !== 'timer' || el.atZero !== 'next') continue;
      const t = state.timers.find((x) => x.id === el.timerId);
      const zero = t ? zeroAt(t, this.now()) : null;
      if (zero !== null && zero > slide.shownAt && (at === null || zero < at)) at = zero;
    }
    return at === null ? null : { at, key: `${slide.slide.id}@${String(slide.shownAt)}>${String(at)}` };
  }

  /** Wait for the slide up to reach zero (again when that changed), when it goes on then. */
  private scheduleZero(): void {
    const found = this.zeroFor(this.state);
    // A zero already gone by unwaited for (the slide edited to go on at zero after it came): it holds.
    if (found && found.at <= this.now() && found.key !== this.zeroWait?.key) this.zeroDone = found.key;
    const want = found && found.key !== this.zeroDone ? found : null;
    if ((want?.key ?? null) === (this.zeroWait?.key ?? null)) return;
    this.zeroWait?.cancel();
    this.zeroWait = null;
    if (!want) return;
    const cancel = this.wait(Math.max(0, want.at - this.now()), () => {
      if (this.zeroWait?.key === want.key) this.zeroWait = null;
      this.atZero(want.key);
    });
    this.zeroWait = { key: want.key, cancel };
  }

  /**
   * A countdown on the slide up reached zero: the next slide comes on with its transition, as Next would bring
   * it (on into the next playlist item at the end of a presentation). Nowhere to go: it holds at 0:00.
   */
  private atZero(key: string): void {
    this.atOnce(() => {
      const found = this.zeroFor(this.state);
      if (found?.key !== key) return;
      // A timer can come a moment early (its clock and this one differ by a millisecond or so): wait again.
      if (this.now() < found.at) {
        this.scheduleZero();
        return;
      }
      this.zeroDone = key;
      const moved = this.step(1);
      if (moved.ok) this.apply(moved.actions);
    });
  }

  /** Stop waiting (the engine is going away: tests, and quitting). */
  dispose(): void {
    this.zeroWait?.cancel();
    this.zeroWait = null;
    this.cancelScheduled?.();
    this.cancelScheduled = null;
    this.scheduled = null;
    this.musicWait?.cancel();
    this.musicWait = null;
  }
}
