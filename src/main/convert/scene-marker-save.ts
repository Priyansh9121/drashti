import type { Db } from '../db/database';
import type { MediaRepo } from '../db/media';
export interface SceneMarkerFailure {
  ok: false;
  message: string;
}
type MarkerStore = Pick<MediaRepo, 'about' | 'markersOf' | 'setMarkers'>;
export function withSceneMarkers<T extends { ok: true } | SceneMarkerFailure>(
  _db: Db,
  _media: MarkerStore,
  _mediaId: string,
  _times: unknown,
  save: () => T,
): T | SceneMarkerFailure {
  return save();
}
