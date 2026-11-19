import type { PreloadMedia } from '../../../shared/engine/preload';
import type { EngineState } from '../../../shared/engine/state';
import type { LiveGroupLook } from '../../../shared/looks';
import type { Lang } from '../../../shared/model';
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

export function initialPicturesFor(
  _state: EngineState,
  _look: LiveGroupLook,
  _enabled = true,
): CurrentPictureSelection | null {
  return null;
}

export function programInitialPictures(
  _state: EngineState,
  _layout: StreamLayout,
  _languages: readonly Lang[] | null,
): CurrentPictureSelection | null {
  return null;
}

export function startInitialPicturePriority(
  _current: CurrentPictureSelection | null,
  _now: number,
): InitialPicturePriority | null {
  return null;
}

export function keepInitialPicturePriority(
  priority: InitialPicturePriority | null,
  _currentKey: string | null,
  _now: number,
): InitialPicturePriority | null {
  return priority;
}

export function settleInitialPicture(
  priority: InitialPicturePriority | null,
  _mediaId: string,
  _outcome: 'ready' | 'failed',
): InitialPicturePriority | null {
  return priority;
}

export function initialPictureReadyToHandOver(
  _priority: InitialPicturePriority | null,
  _sceneReady: boolean,
): boolean {
  return false;
}
