import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
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
} from '../../shared/engine/state';
import type { EngineTransport } from '../../shared/engine/transport';
import type { EngineAction } from './actions';
import { reduce } from './reducer';
import { remapPosition } from '../../shared/order';
import type { PlayedSlide, PlayOrder, SlideSource } from './slide-source';

type Resolved = { ok: true; actions: EngineAction[] } | Extract<CommandResult, { ok: false }>;

/** What restart recovery puts back (see recovery/live-state.ts). */
export interface RestoreRequest {
  slide: { presentationId: string; slideIndex: number; arrangementId?: string | null } | null;
  background: BackgroundLayer | null;
  blackout: boolean;
}

/**
 * The show engine. It owns the live state, turns commands into actions,
 * and sends every change as a versioned patch through the transport.
 */
export class ShowEngine {
  private state: EngineState = initialEngineState();
  private revision = 0;
  private readonly listeners = new Set<(state: EngineState) => void>();

  constructor(
    private readonly source: SlideSource,
    private readonly transport: EngineTransport,
    private readonly now: () => number = Date.now,
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
    return this.apply(resolved.actions);
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
   * the background as it was (a video carries on from where it would be
   * now), and black-out. A slide that no longer exists is left out.
   */
  restore(request: RestoreRequest): { slide: boolean; background: boolean; blackout: boolean } {
    const actions: EngineAction[] = [];
    let slide = false;
    if (request.slide) {
      const { presentationId, slideIndex, arrangementId } = request.slide;
      const order = this.source.order(presentationId, arrangementId);
      const found = order?.slides[slideIndex];
      if (order && found) {
        actions.push(this.showAction(presentationId, slideIndex, order, found));
        slide = true;
      }
    }
    if (request.background) actions.push({ type: 'background/set', background: request.background });
    if (request.blackout) actions.push({ type: 'blackout/set', on: true });
    this.apply(actions);
    return { slide, background: request.background !== null, blackout: request.blackout };
  }

  /**
   * The operator changed a presentation's order (its selected arrangement).
   * If it is live, the live position follows the new order, with the same
   * slide on screen: Next then carries on in the new order.
   */
  reorderLive(presentationId: string): CommandResult {
    const live = this.state.live;
    if (live.presentationId !== presentationId || live.slideIndex === null)
      return { ok: true, changed: false, rev: this.revision };
    const before = this.source.order(presentationId, live.arrangementId);
    const after = this.source.order(presentationId);
    if (!before || !after) return { ok: true, changed: false, rev: this.revision };
    const slideIndex = remapPosition(
      before.slides.map((s) => ({ slide: s })),
      after.slides.map((s) => ({ slide: s })),
      live.slideIndex,
    );
    return this.apply([
      { type: 'live/move', slideIndex, slideCount: after.slides.length, arrangementId: after.arrangementId },
    ]);
  }

  private showAction(
    presentationId: string,
    slideIndex: number,
    order: PlayOrder,
    played: PlayedSlide,
  ): EngineAction {
    return {
      type: 'slide/show',
      presentationId,
      slideIndex,
      slideCount: order.slides.length,
      arrangementId: order.arrangementId,
      slide: played.slide,
      notes: played.notes,
      at: this.now(),
    };
  }

  private showSlide(presentationId: string, slideIndex: number, arrangementId?: string | null): Resolved {
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
    const actions: EngineAction[] = [this.showAction(presentationId, slideIndex, order, played)];
    // The slide's background and sound go on their layers; a slide without them leaves those layers as they are.
    for (const cue of played.cues) {
      if (cue.kind === 'background') {
        actions.push({ type: 'background/set', background: this.backgroundLayer(cue.background) });
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
  private backgroundLayer(choice: BackgroundChoice): BackgroundLayer {
    if (choice.kind === 'color') return choice;
    const current = this.state.layers.background;
    const same = current?.kind === 'media' && current.mediaId === choice.mediaId;
    return { ...choice, startedAt: same ? current.startedAt : this.now() };
  }

  /**
   * Next / previous: one slide along the live presentation. At either end
   * nothing changes, so Next never repeats a slide. After the slide layer is
   * cleared the cursor stays put, so Next shows the following slide.
   */
  private step(delta: 1 | -1): Resolved {
    const { presentationId, slideIndex, arrangementId } = this.state.live;
    if (presentationId === null || slideIndex === null) {
      return { ok: false, error: 'nothing-live', message: 'Nothing is live yet' };
    }
    // Along the order being played: a repeated chorus comes up again.
    const order = this.source.order(presentationId, arrangementId);
    if (!order)
      return { ok: false, error: 'unknown-presentation', message: `No presentation ${presentationId}` };
    const count = order.slides.length;
    let target = slideIndex + delta;
    // If the presentation got shorter underneath us, Previous goes to its last slide.
    if (delta < 0 && target >= count) target = count - 1;
    if (target < 0 || target >= count) return { ok: true, actions: [] };
    return this.showSlide(presentationId, target, order.arrangementId);
  }

  private resolve(command: EngineCommand): Resolved {
    switch (command.type) {
      case 'goLive':
        return this.showSlide(command.presentationId, command.slideIndex, command.arrangementId);
      case 'next':
        return this.step(1);
      case 'previous':
        return this.step(-1);
      case 'clearLayer':
        return { ok: true, actions: [{ type: 'layer/clear', layer: command.layer }] };
      case 'clearAll':
        return { ok: true, actions: [{ type: 'layers/clearAll' }] };
      case 'setBlackout':
        return { ok: true, actions: [{ type: 'blackout/set', on: command.on }] };
      case 'toggleBlackout':
        return { ok: true, actions: [{ type: 'blackout/set', on: !this.state.blackout }] };
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
    }
  }

  private apply(actions: readonly EngineAction[]): CommandResult {
    const prev = this.state;
    const next = actions.reduce(reduce, prev);
    if (next === prev) return { ok: true, changed: false, rev: this.revision };
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
