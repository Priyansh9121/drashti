import { mediaToPreload, type PreloadMedia } from '../../../shared/engine/preload';
import type { EngineState, UpNext } from '../../../shared/engine/state';
import { DEFAULT_LIVE_GROUP_LOOK, type LiveGroupLook } from '../../../shared/looks';
import type { Lang } from '../../../shared/model';
import { hasPicture, lowerThird, programPicture } from '../../../shared/program';
import type { StreamLayout } from '../../../shared/stream';

/** Only the current picture's addresses and identity, never a retained engine state. */
export interface CurrentPictureSelection {
  key: string;
  media: readonly PreloadMedia[];
}

/** The page's first picture gets one bounded turn before Next starts loading. */
export interface InitialPicturePriority {
  current: CurrentPictureSelection;
  pending: readonly string[];
  until: number;
}

/** Bounds preload ordering only; it adds no time to the slide's existing display wait. */
export const INITIAL_PICTURE_PRIORITY_MS = 3000;

/** The same slide, background and lower-third decisions as Scene/DrawnSlide; videos keep their one live decoder. */
export function initialPicturesFor(
  state: EngineState,
  look: LiveGroupLook,
  enabled = true,
): CurrentPictureSelection | null {
  if (!enabled || state.blackout || state.wallpaper) return null;
  const behind = state.layers.background;
  const background = look.layers.includes('background') && behind?.kind === 'media' ? behind : null;
  let layer = look.layers.includes('slide') ? state.layers.slide : null;
  if (
    layer &&
    look.slides === 'lowerThird' &&
    (lowerThird(layer.slide, look.languages).length > 0 || !hasPicture(layer.slide))
  )
    layer = null;
  const current: UpNext | null = layer
    ? {
        kind: 'slide',
        presentationId: layer.presentationId,
        slideIndex: layer.slideIndex,
        slide: layer.slide,
        background,
        step: layer.step,
        itemId: null,
        notes: layer.notes,
      }
    : background
      ? {
          kind: 'media',
          itemId: background.sourceItemId ?? '',
          mediaId: background.mediaId,
          media: background.media,
          label: '',
        }
      : null;
  const media = mediaToPreload(current).filter((m) => m.media === 'image');
  if (media.length === 0) return null;
  const key = JSON.stringify([
    layer
      ? [
          layer.presentationId,
          layer.slideIndex,
          layer.slide.id,
          layer.shownAt,
          layer.step ?? 0,
          layer.stepAt ?? 0,
        ]
      : null,
    background ? [background.mediaId, background.startedAt] : null,
    media.map((m) => m.mediaId),
  ]);
  return { key, media };
}

/** Camera lower thirds have no slide picture; its full-frame picture follows the same Scene as Slides. */
export function programInitialPictures(
  state: EngineState,
  layout: StreamLayout,
  languages: readonly Lang[] | null,
): CurrentPictureSelection | null {
  const picture = programPicture(state, layout, languages);
  if (picture.kind === 'camera' && picture.full === null) return null;
  return initialPicturesFor(state, { ...DEFAULT_LIVE_GROUP_LOOK, languages });
}

export function startInitialPicturePriority(
  current: CurrentPictureSelection | null,
  now: number,
): InitialPicturePriority | null {
  if (!current || current.media.length === 0) return null;
  return {
    current,
    pending: current.media.map((m) => m.mediaId),
    until: now + INITIAL_PICTURE_PRIORITY_MS,
  };
}

/** A turn cannot move to another show or restart its bound as individual images finish. */
export function keepInitialPicturePriority(
  priority: InitialPicturePriority | null,
  currentKey: string | null,
  now: number,
): InitialPicturePriority | null {
  return priority?.current.key === currentKey && now < priority.until ? priority : null;
}

/** A replacement copy can start while the page still keeps its initial consumers. */
export function prepareInitialPicture(
  priority: InitialPicturePriority | null,
  mediaId: string,
): InitialPicturePriority | null {
  if (!priority) return null;
  if (priority.pending.includes(mediaId) || !priority.current.media.some((m) => m.mediaId === mediaId))
    return priority;
  return { ...priority, pending: [...priority.pending, mediaId] };
}

export function settleInitialPicture(
  priority: InitialPicturePriority | null,
  mediaId: string,
  outcome: 'ready' | 'failed',
): InitialPicturePriority | null {
  if (!priority?.pending.includes(mediaId)) return priority;
  if (outcome === 'failed') return null;
  return { ...priority, pending: priority.pending.filter((id) => id !== mediaId) };
}

/** Keep the decoded consumers through the scene's handover, so a large Next cannot evict the first picture early. */
export function initialPictureReadyToHandOver(
  priority: InitialPicturePriority | null,
  sceneReady: boolean,
): boolean {
  return priority !== null && priority.pending.length === 0 && sceneReady;
}
