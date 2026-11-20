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
}
const refused: VideoEditResult = {
  ok: false,
  message: 'Choose a ready local video in the operator window, then open Edit Video… again.',
};

/** Red-first operator boundary scaffold. */
export function registerEditVideoIpc(_deps: Deps): void {}
