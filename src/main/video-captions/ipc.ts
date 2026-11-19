import type { IpcMainInvokeEvent } from 'electron';
import { isAbsolute } from 'node:path';
import { IPC } from '../../shared/ipc';
import { MEDIA_ID_PATTERN } from '../../shared/media';
import type { VideoCaptionResult } from '../../shared/video-captions';
import type { VideoCaptionsRepo } from '../db/video-captions';
import type { SourceWrite } from '../documents/source-write';
import { handle } from '../ipc/handle';
import type { CaptionFileReader } from './reader';

interface Deps {
  fromOperator(event: IpcMainInvokeEvent): boolean;
  repo: Pick<VideoCaptionsRepo, 'view' | 'select' | 'put'>;
  pick(event: IpcMainInvokeEvent): Promise<string | null>;
  reader: Pick<CaptionFileReader, 'read'>;
  changed(mediaId: string): void;
  write: SourceWrite;
}
const validId = (id: unknown): id is string => typeof id === 'string' && MEDIA_ID_PATTERN.test(id);
const refused: VideoCaptionResult = {
  ok: false,
  message: 'Choose a video in the operator window to change its captions.',
};

/** Never takes a path or caption text from a page: only a native dialog may name a file to read. */
export function registerVideoCaptionIpc(deps: Deps): void {
  handle(IPC.videoCaptions.view, (e, id) =>
    deps.fromOperator(e) && validId(id) ? deps.repo.view(id) : { tracks: [], selected: null },
  );
  handle(IPC.videoCaptions.select, async (e, id, track): Promise<VideoCaptionResult> => {
    if (!deps.fromOperator(e) || !validId(id) || (track !== null && !validId(track))) return refused;
    try {
      const ok = await deps.write(
        { signal: new AbortController().signal, allowed: () => deps.fromOperator(e) },
        () => deps.repo.select(id, track),
      );
      if (!ok)
        return {
          ok: false,
          message: 'That caption track is not in this video. Choose another track or add a caption file.',
        };
      deps.changed(id);
      return { ok: true, view: deps.repo.view(id) };
    } catch {
      return {
        ok: false,
        message: 'The caption choice could not be kept. The video can still play. Try choosing it again.',
      };
    }
  });
  handle(IPC.videoCaptions.add, async (e, id): Promise<VideoCaptionResult> => {
    if (!deps.fromOperator(e) || !validId(id)) return refused;
    try {
      const file = await deps.pick(e);
      if (!deps.fromOperator(e)) return refused;
      if (file === null) return { ok: true, view: deps.repo.view(id) };
      if (!isAbsolute(file) || file.includes('\0') || !/\.(srt|vtt)$/iu.test(file))
        return { ok: false, message: 'Choose an SRT or WebVTT caption file.' };
      const read = await deps.reader.read(file);
      if (!deps.fromOperator(e)) return refused;
      const track = read.track;
      if (!track)
        return { ok: false, message: read.problem ?? 'No readable captions were found in that file.' };
      const ok = await deps.write(
        { signal: new AbortController().signal, allowed: () => deps.fromOperator(e) },
        () => deps.repo.put(id, [track]),
      );
      if (!ok)
        return {
          ok: false,
          message: 'The caption file could not be kept. Choose a video with fewer than 12 caption tracks.',
        };
      deps.changed(id);
      return { ok: true, view: deps.repo.view(id), ...(read.problem ? { notice: read.problem } : {}) };
    } catch {
      return {
        ok: false,
        message: 'The caption file could not be added. The video can still play. Try adding the file again.',
      };
    }
  });
}
