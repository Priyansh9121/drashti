import type { MediaFit } from '../../../shared/engine/state';

/** How each fit draws an image or video in its box. */
export const OBJECT_FIT: Record<MediaFit, 'contain' | 'cover' | 'fill'> = {
  fit: 'contain',
  fill: 'cover',
  stretch: 'fill',
};
