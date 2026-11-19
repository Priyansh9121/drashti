import { nativeDeckMotion } from '../../../shared/deck';
import { deckElementTargets } from '../../../shared/deck-motion';
import type { RenderSlide } from '../../../shared/model';
import { hasEdit, type LiveZoom, type PictureLook } from '../../../shared/picture-look';

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

/** An opaque colour as a slide's background is written: #rrggbb, or #rrggbbff. */
const OPAQUE = /^(#[0-9a-f]{6})(?:ff)?$/iu;

/** The backing a slide may have while it moves on a layer of its own, or null: not known opaque, drawn as before. */
export function slideBacking(slide: RenderSlide, screen: ScreenPicturesState | null): SlideBacking | null {
  const colour = slide.background === null ? null : OPAQUE.exec(slide.background)?.[1];
  if (colour) return { colour };
  // Else its own picture under everything else on it, covering all of its place, still and as it is.
  const picture = slide.elements[0];
  if (!screen || picture?.kind !== 'image') return null;
  const { x, y, width, height } = picture.frame;
  if (
    x !== 0 ||
    y !== 0 ||
    width !== slide.width ||
    height !== slide.height ||
    picture.fit === 'fit' ||
    picture.hidden ||
    picture.crop ||
    picture.pictureClip ||
    picture.rotation ||
    picture.motion ||
    (picture.opacity ?? 1) !== 1
  )
    return null;
  // A deck's own effect on it (it flies in, say) may leave the slide without it part of the time.
  const targets = deckElementTargets(picture);
  if (nativeDeckMotion(slide.deck)?.effects.some((effect) => targets.includes(effect.shapeId))) return null;
  // Its look changes only its colours (brightness, contrast, colour, sharpness: never its pixels' alpha), never where
  // it is or how much of its place it covers; no live zoom on it.
  const look = screen.pictures[picture.mediaId];
  if (look && (hasEdit(look) || look.zoom !== 1 || look.x !== 0 || look.y !== 0)) return null;
  if (screen.liveZoom?.mediaId === picture.mediaId) return null;
  return screen.opaque?.includes(picture.mediaId) ? { colour: '#000000', picture: picture.mediaId } : null;
}
