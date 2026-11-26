import type { BackgroundLayer, EngineState, PipPlace, SlideLayer } from '../../../shared/engine/state';
import type { LiveGroupLook } from '../../../shared/looks';
import type { Size } from '../../../shared/scaling';
import type { PipRect } from '../render/pip';

/*
 * Picture in Picture's preview (QA24-PIPPREVIEW-1): red first, nothing yet.
 */

export type PreviewSource =
  | { kind: 'slides' }
  | { kind: 'media'; mediaId: string; media: 'image' | 'video'; name: string }
  | { kind: 'input'; name: string }
  | { kind: 'window'; name: string }
  | { kind: 'none' };

export interface PreviewFrame {
  rect: PipRect;
  radius: number;
  line: number;
}

export function previewFrame(_place: PipPlace, _canvas: Size): PreviewFrame {
  return { rect: { x: 0, y: 0, width: 0, height: 0 }, radius: -1, line: -1 };
}

export interface PreviewBehind {
  background: BackgroundLayer | null;
  slide: SlideLayer | null;
  boxSlide: SlideLayer | null;
  nothing: 'wallpaper' | 'black' | null;
  covered: 'blackout' | 'wallpaper' | null;
  swapped: boolean;
  state: EngineState | null;
}

export function previewBehind(
  _state: EngineState | null,
  _look: Pick<LiveGroupLook, 'layers'>,
  _holdsSlides: boolean,
): PreviewBehind {
  return {
    background: null,
    slide: null,
    boxSlide: null,
    nothing: null,
    covered: null,
    swapped: false,
    state: null,
  };
}

export type PreviewLead = 'preview' | 'next' | 'now';

export function previewWords(
  _lead: PreviewLead,
  _place: PipPlace,
  _source: PreviewSource,
  _behind: PreviewBehind,
): string {
  return '';
}
