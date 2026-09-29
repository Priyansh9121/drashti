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
import type { SlideSource } from './slide-source';

type Resolved = { ok: true; actions: EngineAction[] } | Extract<CommandResult, { ok: false }>;

/**
 * The show engine. It owns the live state, turns commands into actions,
 * and sends every change as a versioned patch through the transport.
 */
/** What restart recovery puts back (see recovery/live-state.ts). */
export interface RestoreRequest {
  slide: { presentationId: string; slideIndex: number } | null;
  background: BackgroundLayer | null;
  blackout: boolean;
}

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
      const { presentationId, slideIndex } = request.slide;
      const count = this.source.slideCount(presentationId);
      const found =
        count !== null && slideIndex < count ? this.source.slide(presentationId, slideIndex) : null;
      if (count !== null && found) {
        actions.push({
          type: 'slide/show',
          presentationId,
          slideIndex,
          slideCount: count,
          slide: found,
          at: this.now(),
        });
        slide = true;
      }
    }
    if (request.background) actions.push({ type: 'background/set', background: request.background });
    if (request.blackout) actions.push({ type: 'blackout/set', on: true });
    this.apply(actions);
    return { slide, background: request.background !== null, blackout: request.blackout };
  }

  private showSlide(presentationId: string, slideIndex: number): Resolved {
    const count = this.source.slideCount(presentationId);
    if (count === null)
      return { ok: false, error: 'unknown-presentation', message: `No presentation ${presentationId}` };
    const slide = slideIndex < count ? this.source.slide(presentationId, slideIndex) : null;
    if (!slide) {
      return {
        ok: false,
        error: 'slide-out-of-range',
        message: `Slide ${slideIndex + 1} of ${count} does not exist`,
      };
    }
    const actions: EngineAction[] = [
      { type: 'slide/show', presentationId, slideIndex, slideCount: count, slide, at: this.now() },
    ];
    // The slide's background and sound go on their layers; a slide without them leaves those layers as they are.
    for (const cue of this.source.cues(presentationId, slideIndex)) {
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
    const { presentationId, slideIndex } = this.state.live;
    if (presentationId === null || slideIndex === null) {
      return { ok: false, error: 'nothing-live', message: 'Nothing is live yet' };
    }
    const count = this.source.slideCount(presentationId);
    if (count === null)
      return { ok: false, error: 'unknown-presentation', message: `No presentation ${presentationId}` };
    let target = slideIndex + delta;
    // If the presentation got shorter underneath us, Previous goes to its last slide.
    if (delta < 0 && target >= count) target = count - 1;
    if (target < 0 || target >= count) return { ok: true, actions: [] };
    return this.showSlide(presentationId, target);
  }

  private resolve(command: EngineCommand): Resolved {
    switch (command.type) {
      case 'goLive':
        return this.showSlide(command.presentationId, command.slideIndex);
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
