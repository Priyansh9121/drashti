import type { EngineState } from '../../shared/engine/state';
import type { VideoEditSnapshot } from '../../shared/video-edit';
import { playingNow } from '../../shared/engine/playing';

export type VideoEditPreparation =
  { state: EngineState; message?: never } | { state?: never; message: string };

/** Called only when a show change is prepared, never while a frame is drawn. */
export function prepareVideoEdits(
  previous: EngineState,
  next: EngineState,
  read: (mediaId: string) => VideoEditSnapshot | null,
  restoring = false,
): VideoEditPreparation {
  if (restoring) return { state: next };
  const key = (p: ReturnType<typeof playingNow>[number], state: EngineState) =>
    `${p.ref.layer}/${p.mediaId}/${String(p.clock.startedAt)}/${p.ref.layer === 'slide' ? (state.layers.slide?.slide.id ?? '') : ''}`;
  const before = new Set(playingNow(previous).map((p) => key(p, previous)));
  for (const p of playingNow(next)) {
    if (before.has(key(p, next))) continue;
    let edit: VideoEditSnapshot | null;
    try {
      edit = read(p.mediaId);
    } catch {
      return { message: 'The saved video edits could not be read. Open Edit Video… and save them again.' };
    }
    if (edit && edit.state !== 'ready')
      return {
        message:
          edit.message ??
          'This video’s edited copy is still preparing. Wait until it is ready in Edit Video… before showing it.',
      };
  }
  return { state: next };
}
