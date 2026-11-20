import type { Db } from './database';
import type { SaveVideoEdit, VideoEditResult, VideoEditSnapshot } from '../../shared/video-edit';

/** Red-first scaffold. The source's media row and bytes are never replaced by a prepared rendition. */
export class VideoEditsRepo {
  constructor(_db: Db) {}
  read(_mediaId: string): VideoEditSnapshot | null {
    return null;
  }
  save(_request: SaveVideoEdit): VideoEditResult {
    return { ok: false, message: 'Not kept yet.' };
  }
  complete(_mediaId: string, _revision: number, _copyId: string): boolean {
    return false;
  }
}
