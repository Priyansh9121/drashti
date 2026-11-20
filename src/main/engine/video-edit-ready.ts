import type { EngineState } from '../../shared/engine/state';
import type { VideoEditSnapshot } from '../../shared/video-edit';

export type VideoEditPreparation =
  { state: EngineState; message?: never } | { state?: never; message: string };

/** Called only when a show change is prepared, never while a frame is drawn. */
export function prepareVideoEdits(
  _previous: EngineState,
  next: EngineState,
  _read: (mediaId: string) => VideoEditSnapshot | null,
  _restoring = false,
): VideoEditPreparation {
  return { state: next };
}
