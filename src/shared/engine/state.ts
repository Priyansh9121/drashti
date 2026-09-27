import type { Rect, RenderSlide, SlideElement } from '../model';

/**
 * Show engine state. The main process owns it; every renderer (and, later,
 * every remote Drashti Node) holds a copy that it keeps in sync from
 * snapshots and patches. It must stay plain, JSON-serializable data.
 *
 * Bump ENGINE_STATE_VERSION whenever the shape changes incompatibly.
 */
export const ENGINE_STATE_VERSION = 1;

export type LayerName = 'audio' | 'background' | 'slide' | 'props' | 'messages' | 'masks';

/** Bottom to top, the order outputs composite visible layers in. Audio has no picture. */
export const LAYER_NAMES = [
  'audio',
  'background',
  'slide',
  'props',
  'messages',
  'masks',
] as const satisfies readonly LayerName[];

/** Where the operator is: the live presentation and slide, even while the slide layer is cleared. */
export interface LiveCursor {
  presentationId: string | null;
  slideIndex: number | null;
  slideCount: number;
}

export interface SlideLayer {
  presentationId: string;
  slideIndex: number;
  slide: RenderSlide;
}

export interface AudioLayer {
  id: string;
  title: string;
  mediaId: string | null;
}

export interface BackgroundLayer {
  kind: 'color';
  color: string;
}

export interface PropItem {
  id: string;
  name: string;
  elements: SlideElement[];
}

export interface MessageItem {
  id: string;
  text: string;
}

/** A mask leaves `visible` showing and blacks out the rest of the canvas. Units: canvas pixels. */
export interface MaskLayer {
  id: string;
  name: string;
  visible: Rect;
}

export interface Layers {
  audio: AudioLayer | null;
  background: BackgroundLayer | null;
  slide: SlideLayer | null;
  props: PropItem[];
  messages: MessageItem[];
  masks: MaskLayer | null;
}

export interface EngineState {
  version: typeof ENGINE_STATE_VERSION;
  live: LiveCursor;
  layers: Layers;
  /** Output-wide black-out. Independent of the layers, so turning it off restores the picture. */
  blackout: boolean;
}

export function emptyLayers(): Layers {
  return { audio: null, background: null, slide: null, props: [], messages: [], masks: null };
}

export function initialEngineState(): EngineState {
  return {
    version: ENGINE_STATE_VERSION,
    live: { presentationId: null, slideIndex: null, slideCount: 0 },
    layers: emptyLayers(),
    blackout: false,
  };
}

/** True when the layer shows nothing. */
export function isLayerEmpty(layers: Layers, layer: LayerName): boolean {
  const value = layers[layer];
  return Array.isArray(value) ? value.length === 0 : value === null;
}
