import type { RenderSlide } from '../../shared/model';
import type {
  AudioLayer,
  BackgroundLayer,
  LayerName,
  MaskLayer,
  MessageItem,
  PlaylistCursor,
  PropItem,
  UpNext,
} from '../../shared/engine/state';

/**
 * Resolved, internal actions. Commands from the UI are turned into these
 * after the engine has looked up whatever they refer to, so the reducer can
 * stay a pure function.
 */
export type EngineAction =
  | {
      type: 'slide/show';
      presentationId: string;
      slideIndex: number;
      slideCount: number;
      arrangementId: string | null;
      /** The playlist item it is played from, if any. */
      playlist: PlaylistCursor | null;
      slide: RenderSlide;
      notes: string;
      /** The time, for the slide layer's shownAt. */
      at: number;
    }
  /** The live position moves (the order changed) while the same slide stays on screen. */
  | { type: 'live/move'; slideIndex: number; slideCount: number; arrangementId: string | null }
  /** The cursor moves to a playlist item that is not a presentation (a picture, video or sound). */
  | { type: 'live/item'; playlist: PlaylistCursor }
  | { type: 'next/set'; next: UpNext | null }
  | { type: 'stage/message'; text: string | null }
  | { type: 'layer/clear'; layer: LayerName }
  | { type: 'layers/clearAll' }
  | { type: 'blackout/set'; on: boolean }
  | { type: 'background/set'; background: BackgroundLayer }
  | { type: 'audio/set'; audio: AudioLayer }
  | { type: 'prop/show'; prop: PropItem }
  | { type: 'prop/hide'; propId: string }
  | { type: 'message/show'; message: MessageItem }
  | { type: 'message/hide'; messageId: string }
  | { type: 'mask/set'; mask: MaskLayer };
