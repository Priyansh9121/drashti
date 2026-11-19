import type { RenderSlide } from '../../../shared/model';
import type { LiveZoom, PictureLook } from '../../../shared/picture-look';

/*
 * What a slide may be backed with while a deck's own move draws it on a layer of its own without a graphics chip
 * (X11): an opaque colour under it, in its own place only, so the compositor knows the layer opaque and draws nothing
 * under it (on CI's two-core Windows, without one, it drew the screen's whole picture under the moving slides every
 * frame). Only a slide known to draw no see-through pixel anywhere in its place is backed, so that a see-through slide
 * never shows the colour: its own background an opaque colour (most slides a PowerPoint deck brings), or its own
 * full-slide picture, still and as it is, from a file that can draw no see-through pixel (main/media/see-through.ts,
 * the state's opaquePictures).
 */

/** What a Scene's state says of its pictures (render/picture-looks.tsx ScreenPictures). */
export interface ScreenPicturesState {
  pictures: Record<string, PictureLook>;
  liveZoom: LiveZoom | null;
  opaque?: readonly string[];
}

/** The colour a slide is backed with, and the picture that makes it opaque when that is why. */
export interface SlideBacking {
  colour: string;
  /** Its own full-slide picture's media id: the page backs it only once that picture is drawn. */
  picture?: string;
}

/** The backing a slide may have while it moves on a layer of its own, or null: not known opaque, drawn as before. */
export function slideBacking(_slide: RenderSlide, _screen: ScreenPicturesState | null): SlideBacking | null {
  return null;
}
