import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc';
import { MEDIA_ID_PATTERN } from '../../shared/media';
import { saveVideoEditSchema, type VideoEditResult, type VideoEditSnapshot } from '../../shared/video-edit';
import type { VideoEditsRepo } from '../db/video-edits';
import type { SourceWrite } from '../documents/source-write';
import { handle } from '../ipc/handle';

interface Deps {
  repo: Pick<VideoEditsRepo, 'sourceId' | 'read' | 'save'>;
  fromOperator(event: IpcMainInvokeEvent): boolean;
  available(mediaId: string): boolean;
  changed(edit: VideoEditSnapshot): void;
  write: SourceWrite;
  appendScenes?(mediaId: string, times: number[], save: () => VideoEditResult): VideoEditResult;
  markersChanged?(): void;
}
const refused: VideoEditResult = {
  ok: false,
  message: 'Choose a ready local video in the operator window, then open Edit Video… again.',
};

/** A page can name only a library ID and validated recipe, never a source or destination path. */
export function registerEditVideoIpc(deps: Deps): void {
  handle(IPC.media.videoEdit, (event, id): VideoEditResult => {
    if (!deps.fromOperator(event) || typeof id !== 'string' || !MEDIA_ID_PATTERN.test(id)) return refused;
    try {
      const source = deps.repo.sourceId(id);
      if (!deps.available(source)) return refused;
      const edit = deps.repo.read(source);
      return edit ? { ok: true, edit } : refused;
    } catch {
      return {
        ok: false,
        message: 'The saved video edits could not be read. Restore a library backup or choose another video.',
      };
    }
  });
  handle(IPC.media.setVideoEdit, async (event, input): Promise<VideoEditResult> => {
    const parsed = saveVideoEditSchema.safeParse(input);
    if (!deps.fromOperator(event) || !parsed.success) return refused;
    try {
      const result = await deps.write(
        {
          signal: new AbortController().signal,
          allowed: () => deps.fromOperator(event) && deps.available(deps.repo.sourceId(parsed.data.mediaId)),
        },
        () => {
          const request = parsed.data;
          if (!request.sceneMarkers?.length) return deps.repo.save(request);
          if (!deps.appendScenes)
            return {
              ok: false as const,
              message: 'The scene markers could not be saved. Keep this window open and try Save again.',
            };
          return deps.appendScenes(deps.repo.sourceId(request.mediaId), request.sceneMarkers, () =>
            deps.repo.save(request),
          );
        },
      );
      if (result.ok) {
        deps.changed(result.edit);
        if (parsed.data.sceneMarkers?.length) deps.markersChanged?.();
      }
      return result;
    } catch {
      return {
        ok: false,
        message:
          'The video edits could not be saved. Keep this window open and try Save again when the library is available.',
      };
    }
  });
}
