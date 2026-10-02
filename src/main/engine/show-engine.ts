import type { CommandResult, EngineCommand, EngineCommandType } from '../../shared/engine/commands';
import { diffState } from '../../shared/engine/patch';
import type { EngineSnapshotMessage } from '../../shared/engine/protocol';
import {
  type AudioChoice,
  type AudioLayer,
  type BackgroundChoice,
  type BackgroundLayer,
  ENGINE_STATE_VERSION,
  type EngineState,
  initialEngineState,
  type Layers,
  type LiveCursor,
  type MessageItem,
  type PlaylistCursor,
  type PropItem,
  type UpNext,
} from '../../shared/engine/state';
import type { EngineTransport } from '../../shared/engine/transport';
import type { BackgroundCue } from '../../shared/library';
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

export interface EngineOptions {
  /** Drashti's own default transition, for presentations without one (a setting; a cut when left out). */
  defaultTransition?: () => Transition;
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
  stageMessage?: string | null;
  /** Timer runs: a running timer carries on from its start time, a paused one keeps its count. */
  timers?: readonly { id: string; startedAt: number | null; elapsedMs: number }[];
}

/** What restart recovery put back. */
export interface Restored {
  slide: boolean;
  background: boolean;
  blackout: boolean;
  logo: boolean;
  audio: boolean;
  props: number;
  messages: number;
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

  constructor(
    private readonly source: SlideSource,
    private readonly transport: EngineTransport,
    private readonly now: () => number = Date.now,
    private readonly playlists: PlaylistSource = NO_PLAYLISTS,
    private readonly options: EngineOptions = {},
  ) {}

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
    const resolved = this.resolve(command);
    if (!resolved.ok) return resolved;
    return this.apply(resolved.actions, command.type);
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
    const actions: EngineAction[] = [];
    let slide = false;
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
    return {
      slide,
      background: request.background !== null,
      blackout: request.blackout,
      logo: Boolean(request.logo),
      audio: Boolean(request.audio),
      props: request.props?.length ?? 0,
      messages: request.messages?.length ?? 0,
      stageMessage: Boolean(request.stageMessage),
      timers,
    };
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

  /** The timers as the library defines them (at startup, and after the operator edits one). */
  setTimers(timers: readonly TimerDefinition[]): CommandResult {
    return this.apply([{ type: 'timers/define', timers }]);
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
    return this.apply([{ type: 'next/set', next: this.upNext(this.state.live) }]);
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

  /** The audio layer for a choice: as with backgrounds, the file already playing carries on. */
  private audioLayer(choice: AudioChoice): AudioLayer {
    const current = this.state.layers.audio;
    const same = choice.mediaId !== null && current?.mediaId === choice.mediaId;
    return { ...choice, startedAt: same ? current.startedAt : this.now() };
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
    if (current?.kind === 'media' && current.mediaId === choice.mediaId)
      return { ...choice, startedAt: current.startedAt, ...(current.fade ? { fade: current.fade } : {}) };
    return { ...choice, startedAt: fade?.at ?? this.now(), ...(fade ? { fade } : {}) };
  }

  /**
   * Next / previous: one slide along the live presentation. At either end,
   * a presentation played from a playlist goes on to the next item's first
   * slide (or back to the previous item's last), stepping over headers and
   * placeholders; otherwise nothing changes, so Next never repeats a slide.
   * After the slide layer is cleared the cursor stays put, so Next shows the
   * following slide.
   */
  private step(delta: 1 | -1): Resolved {
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

  /** What Next will show from here. */
  private upNext(live: LiveCursor): UpNext | null {
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
          return { ok: true, actions: [{ type: 'show/put', live: last.live, layers: last.layers }] };
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
        return { ok: true, actions: [{ type: 'show/put', live: this.state.live, layers: cleared.from }] };
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
    }
  }

  /**
   * Keep what Put it back and Back can undo. Clear all remembers what it took
   * down; each Next remembers what was there before it. Anything else that
   * changes the layers or the position forgets them (black-out, the logo,
   * timers and the stage message do not).
   */
  private keepUndo(prev: EngineState, next: EngineState, cause: EngineCommandType | null): EngineState {
    if (cause === 'clearAll') {
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

  private apply(actions: readonly EngineAction[], cause: EngineCommandType | null = null): CommandResult {
    const prev = this.state;
    let next = actions.reduce(reduce, prev);
    // A new position has a new slide after it.
    if (next.live !== prev.live) {
      const upNext = this.upNext(next.live);
      if (!sameData(next.next, upNext)) next = reduce(next, { type: 'next/set', next: upNext });
    }
    next = this.keepUndo(prev, next, cause);
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
    return { ok: true, changed: true, rev: this.revision };
  }
}
