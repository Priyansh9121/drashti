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
  type Layers,
  type LiveCursor,
  type MaskLayer,
  type MessageItem,
  type PlaylistCursor,
  type PropItem,
  type TickerItem,
  type TickerLayer,
  UPCOMING_ITEMS,
  type UpcomingItem,
  type UpNext,
} from '../../shared/engine/state';
import type { EngineTransport } from '../../shared/engine/transport';
import type { CalendarDay } from '../../shared/calendar';
import type { BackgroundCue } from '../../shared/library';
import type { LiveLook } from '../../shared/looks';
import { CUT, type Transition } from '../../shared/model';
import { elapsedAt, type TimerDefinition, type TimerRun } from '../../shared/timers';
import { remapPosition } from '../../shared/order';
import type { EngineAction } from './actions';
import { NO_PLAYLISTS, type PlayItem, type PlaylistSource } from './playlist-source';
import { reduce, sameData } from './reducer';
import type { PlayedSlide, PlayOrder, SlideSource } from './slide-source';

type Resolved = { ok: true; actions: EngineAction[] } | Extract<CommandResult, { ok: false }>;
type MediaItem = Extract<PlayItem, { kind: 'media' }>;

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
   * switching the Look, from the window, a phone, the API or a macro alike.
   */
  refuse?: (command: EngineCommand) => string | null;
  /** A media file's length in ms, when the library knows it (learned from playing it). */
  mediaLength?: (mediaId: string) => number | null;
  /**
   * A slide's macro cue: the commands the macro runs, or why it does not run
   * (Simple Mode, a macro gone or forbidden): the slide then goes up alone.
   */
  macroCommands?: (
    macroId: string,
  ) => { ok: true; commands: EngineCommand[] } | { ok: false; message: string };
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
  stageMessage?: string | null;
  /** Timer runs: a running timer carries on from its start time, a paused one keeps its count. */
  timers?: readonly { id: string; startedAt: number | null; elapsedMs: number }[];
  /** The slide was moving on by itself: it carries on with the time it had left. */
  autoAdvance?: { leftMs: number; durationMs: number } | null;
  /** The Look that was live (left out or gone: the one already live stays). */
  lookId?: string | null;
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
  stageMessage: boolean;
  timers: number;
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
  private readonly listeners = new Set<(state: EngineState) => void>();
  /** What Clear all took down (from), while the layers are still what it left (to). */
  private cleared: { from: Layers; to: Layers } | null = null;
  /** The Nexts Back can undo, latest last. */
  private steps: Step[] = [];
  /** The auto-advance waiting to run, and how to cancel it. */
  private scheduled: { startedAt: number; durationMs: number } | null = null;
  private cancelScheduled: (() => void) | null = null;
  /** The time of the change being made, read once (null between changes). */
  private at: number | null = null;
  /** The change being made only adds what is known about it (a file's length): not a change to the show. */
  private bookkeeping = false;
  /** Running a macro (or a slide's cue): slides it puts up do not set off their own cues. */
  private inMacro = false;
  /** The macro being run has Clear all in it: Put it back brings back what was up before it. */
  private macroClears = false;

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
    };
  }

  dispatch(command: EngineCommand): CommandResult {
    const refused = this.options.refuse?.(command) ?? null;
    if (refused !== null) return { ok: false, error: 'forbidden', message: refused };
    return this.atOnce(() => {
      const resolved = this.resolve(command);
      if (!resolved.ok) return resolved;
      return this.apply(resolved.actions, command.type);
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
    } else if (playlist?.item.kind === 'media') {
      actions.push({ type: 'live/item', playlist: playlist.cursor });
    }
    if (request.background) actions.push({ type: 'background/set', background: request.background });
    if (request.blackout) actions.push({ type: 'blackout/set', on: true });
    if (request.logo) actions.push({ type: 'logo/set', prop: request.logo });
    // The sound keeps its start time, so it carries on where it would be now, as a video does.
    if (request.audio) actions.push({ type: 'audio/set', audio: request.audio });
    for (const prop of request.props ?? []) actions.push({ type: 'prop/show', prop });
    for (const message of request.messages ?? []) actions.push({ type: 'message/show', message });
    if (request.ticker) actions.push({ type: 'ticker/set', ticker: request.ticker });
    if (request.masks) actions.push({ type: 'mask/set', mask: request.masks });
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
      background: request.background !== null,
      blackout: request.blackout,
      logo: Boolean(request.logo),
      audio: Boolean(request.audio),
      props: request.props?.length ?? 0,
      messages: request.messages?.length ?? 0,
      ticker: request.ticker?.items.length ?? 0,
      masks: Boolean(request.masks),
      stageMessage: Boolean(request.stageMessage),
      timers,
    };
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

  /** The timers as the library defines them (at startup, and after the operator edits one). */
  setTimers(timers: readonly TimerDefinition[]): CommandResult {
    return this.apply([{ type: 'timers/define', timers }]);
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
        },
      ];
    });
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

  /** Layers as they were (Put it back, Back), with the lengths of their files the library knows by now. */
  private withLengths(layers: Layers): Layers {
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
    how: { at?: number; transition?: Transition } = {},
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
    };
  }

  /**
   * How a slide comes on: its own transition, else its presentation's, else
   * Drashti's default. A dissolve of no length is a cut; a cut is left out.
   */
  private transitionFor(order: PlayOrder, played: PlayedSlide): Transition | undefined {
    const t = played.transition ?? order.transition ?? this.options.defaultTransition?.() ?? CUT;
    return t.kind === 'dissolve' && t.durationMs > 0 ? t : undefined;
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
    const actions: EngineAction[] = [
      this.showAction(presentationId, slideIndex, order, played, playlist, {
        at,
        ...(transition ? { transition } : {}),
      }),
    ];
    // The slide's background and sound go on their layers; a slide without them leaves those layers as they are.
    // A new background comes on with the slide (dissolving with it); the same file carries on.
    const fade = transition ? { at, durationMs: transition.durationMs } : undefined;
    for (const cue of played.cues) {
      if (cue.kind === 'background') {
        actions.push({ type: 'background/set', background: this.backgroundLayer(cue.background, fade) });
      } else {
        const { mediaId, volume, loop } = cue;
        actions.push({
          type: 'audio/set',
          audio: this.audioLayer({ id: mediaId, title: cue.label || cue.name, mediaId, volume, loop }),
        });
      }
    }
    // The slide's macro runs in the same change, after the slide is up (never when a macro put the slide up).
    if (played.macroId && !this.inMacro && this.options.macroCommands) {
      const macro = this.options.macroCommands(played.macroId);
      if (macro.ok) {
        const ran = this.resolveAll(macro.commands, actions.reduce(reduce, this.state));
        if (ran.ok) actions.push(...ran.actions);
      }
    }
    return { ok: true, actions };
  }

  /**
   * Commands in order, each as the ones before it left the show (from
   * `from`): their actions together, or why one cannot run. Nothing changes
   * until the caller applies them, as one change.
   */
  private resolveAll(commands: readonly EngineCommand[], from: EngineState = this.state): Resolved {
    const before = this.state;
    const wasInMacro = this.inMacro;
    this.inMacro = true;
    const actions: EngineAction[] = [];
    try {
      this.state = from;
      for (const command of commands) {
        const refused = this.options.refuse?.(command) ?? null;
        if (refused !== null) return { ok: false, error: 'forbidden', message: refused };
        const r = this.resolve(command);
        if (!r.ok) return r;
        actions.push(...r.actions);
        this.state = r.actions.reduce(reduce, this.state);
      }
      return { ok: true, actions };
    } finally {
      this.state = before;
      this.inMacro = wasInMacro;
    }
  }

  /**
   * A macro: its commands in order as one change (one patch, one revision),
   * or none of them if one cannot run. Put it back after a macro with Clear
   * all in it brings back what was up before the macro; Back after any macro
   * is Previous.
   */
  runMacro(commands: readonly EngineCommand[]): CommandResult {
    return this.atOnce(() => {
      const resolved = this.resolveAll(commands);
      if (!resolved.ok) return resolved;
      this.macroClears = commands.some((c) => c.type === 'clearAll');
      try {
        return this.apply(resolved.actions, 'macro');
      } finally {
        this.macroClears = false;
      }
    });
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
      actions: [cue, { type: 'layer/clear', layer: 'slide' }, { type: 'background/set', background }],
    };
  }

  /** Start a playlist item at its first or last slide. Null when it has nothing to play. */
  private startItem(playlistId: string, item: PlayItem, from: 'first' | 'last'): Resolved | null {
    const cursor = { playlistId, itemId: item.id };
    if (item.kind === 'media') return this.showMedia(cursor, item);
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
          : 'That item cannot play';
    return { ok: false, error: 'not-playable', message };
  }

  /** A file's length when the library knows it (left out otherwise). */
  private lengthOf(mediaId: string | null): { durationMs?: number } {
    const ms = mediaId ? (this.options.mediaLength?.(mediaId) ?? null) : null;
    return ms !== null && ms > 0 ? { durationMs: ms } : {};
  }

  /** The audio layer for a choice: as with backgrounds, the file already playing carries on. */
  private audioLayer(choice: AudioChoice): AudioLayer {
    const current = this.state.layers.audio;
    const same = choice.mediaId !== null && current?.mediaId === choice.mediaId;
    return { ...choice, startedAt: same ? current.startedAt : this.now(), ...this.lengthOf(choice.mediaId) };
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
    if (current?.kind === 'media' && current.mediaId === choice.mediaId)
      return {
        ...choice,
        startedAt: current.startedAt,
        ...(current.fade ? { fade: current.fade } : {}),
        ...length,
      };
    return { ...choice, startedAt: fade?.at ?? this.now(), ...(fade ? { fade } : {}), ...length };
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
      const following = order?.slides[live.slideIndex + 1];
      if (following) return this.slideUpNext(live.presentationId, live.slideIndex + 1, following, null);
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
    return {
      kind: 'slide',
      presentationId,
      slideIndex,
      slide: played.slide,
      background: cue?.unplayable === null && !cue.missing ? cue.background : null,
      itemId,
    };
  }

  private resolve(command: EngineCommand): Resolved {
    switch (command.type) {
      case 'goLive': {
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
        return { ok: true, actions: [{ type: 'layer/clear', layer: command.layer }] };
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
          actions: [{ type: 'show/put', live: this.state.live, layers: this.withLengths(cleared.from) }],
        };
      }
      case 'setBlackout':
        return { ok: true, actions: [{ type: 'blackout/set', on: command.on }] };
      case 'toggleBlackout':
        return { ok: true, actions: [{ type: 'blackout/set', on: !this.state.blackout }] };
      case 'showLogo':
        return { ok: true, actions: [{ type: 'logo/set', prop: command.prop }] };
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
        return { ok: true, actions: [{ type: 'prop/show', prop: command.prop }] };
      case 'hideProp':
        return { ok: true, actions: [{ type: 'prop/hide', propId: command.propId }] };
      case 'showMessage':
        return { ok: true, actions: [{ type: 'message/show', message: command.message }] };
      case 'hideMessage':
        return { ok: true, actions: [{ type: 'message/hide', messageId: command.messageId }] };
      case 'setMask':
        return { ok: true, actions: [{ type: 'mask/set', mask: command.mask }] };
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
      case 'setLook': {
        const look = this.options.looks?.look(command.lookId) ?? null;
        if (!look) return { ok: false, error: 'unknown-look', message: 'That look no longer exists' };
        return { ok: true, actions: [{ type: 'look/set', look }] };
      }
    }
  }

  /**
   * Keep what Put it back and Back can undo. Clear all remembers what it took
   * down; each Next remembers what was there before it. Anything else that
   * changes the layers or the position forgets them (black-out, the logo,
   * timers and the stage message do not).
   */
  private keepUndo(
    prev: EngineState,
    next: EngineState,
    cause: EngineCommandType | 'macro' | null,
  ): EngineState {
    if (this.bookkeeping) {
      // What Back and Put it back would undo to stays, now as the layers are.
      if (this.cleared?.to === prev.layers) this.cleared = { ...this.cleared, to: next.layers };
      const last = this.steps.at(-1);
      if (last?.toLayers === prev.layers) last.toLayers = next.layers;
      return next;
    }
    if (cause === 'clearAll' || (cause === 'macro' && this.macroClears)) {
      if (next.layers !== prev.layers) this.cleared = { from: prev.layers, to: next.layers };
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

  private apply(
    actions: readonly EngineAction[],
    cause: EngineCommandType | 'macro' | null = null,
  ): CommandResult {
    return this.atOnce(() => this.applyAt(actions, cause));
  }

  private applyAt(
    actions: readonly EngineAction[],
    cause: EngineCommandType | 'macro' | null,
  ): CommandResult {
    const prev = this.state;
    let next = actions.reduce(reduce, prev);
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
    return { ok: true, changed: true, rev: this.revision };
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

  /** Stop waiting (the engine is going away: tests, and quitting). */
  dispose(): void {
    this.cancelScheduled?.();
    this.cancelScheduled = null;
    this.scheduled = null;
  }
}
