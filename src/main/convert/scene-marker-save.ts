import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { markerTime } from '../../shared/markers';
import type { Db } from '../db/database';
import type { MediaRepo } from '../db/media';
export interface SceneMarkerFailure {
  ok: false;
  message: string;
}
type MarkerStore = Pick<MediaRepo, 'about' | 'markersOf' | 'setMarkers'>;
const timesSchema = z.array(z.number().int().min(0).max(86_400_000)).max(50);
class SceneRefused extends Error {
  constructor(readonly refusal: SceneMarkerFailure) {
    super(refusal.message);
  }
}
/** Only append selected source times, in the same transaction as the recipe; never replace existing points. */
export function withSceneMarkers<T extends { ok: true } | SceneMarkerFailure>(
  db: Db,
  media: MarkerStore,
  mediaId: string,
  times: unknown,
  save: () => T,
): T | SceneMarkerFailure {
  const parsed = timesSchema.safeParse(times ?? []);
  if (!parsed.success)
    return {
      ok: false,
      message: 'Those scene suggestions could not be kept. Open the video again and choose the scenes again.',
    };
  try {
    return db.transaction(() => {
      const row = media.about(mediaId);
      if (row?.kind !== 'video' || row.deleted || row.missing)
        throw new SceneRefused({
          ok: false,
          message: 'The original video is unavailable. Restore its file, then open Edit Video… again.',
        });
      const duration = row.durationMs;
      if (duration !== null && parsed.data.some((at) => at >= duration))
        throw new SceneRefused({
          ok: false,
          message: 'A scene is outside this video. Open its editor and choose the scenes again.',
        });
      const current = media.markersOf(mediaId);
      if (!current)
        throw new SceneRefused({
          ok: false,
          message: 'The video markers are unavailable. Open the video again and try Save again.',
        });
      const additions = [...new Set(parsed.data)].filter(
        (atMs) => !current.markers.some((marker) => marker.atMs === atMs),
      );
      if (current.markers.length + additions.length > 50)
        throw new SceneRefused({
          ok: false,
          message: 'All 50 marker places are used. Remove a marker before keeping more scenes.',
        });
      const result = save();
      if (!result.ok) throw new SceneRefused(result);
      if (
        additions.length > 0 &&
        !media.setMarkers(mediaId, {
          ...current,
          markers: [
            ...current.markers,
            ...additions.map((atMs) => ({ id: randomUUID(), name: `Scene ${markerTime(atMs)}`, atMs })),
          ].sort((a, b) => a.atMs - b.atMs),
        })
      )
        throw new SceneRefused({
          ok: false,
          message: 'The scene markers could not be saved. Open the video again and try Save again.',
        });
      return result;
    })();
  } catch (error) {
    return error instanceof SceneRefused
      ? error.refusal
      : {
          ok: false,
          message:
            'The video edits and scene markers could not be saved. Check the file and free disk space, then try Save again.',
        };
  }
}
