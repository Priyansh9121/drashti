import type { RenderSlide } from '../../shared/model';
import type {
  AudioLayer,
  BackgroundLayer,
  LayerName,
  MaskLayer,
  MessageItem,
  PropItem,
} from '../../shared/engine/state';

/**
 * Resolved, internal actions. Commands from the UI are turned into these
 * after the engine has looked up whatever they refer to, so the reducer can
 * stay a pure function.
 */
export type EngineAction =
  | { type: 'slide/show'; presentationId: string; slideIndex: number; slideCount: number; slide: RenderSlide }
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
