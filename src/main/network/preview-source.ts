import { join } from 'node:path';
import { copyOfId, MEDIA_ID_PATTERN } from '../../shared/media';
import { realPlace } from '../media/contained';
import type { PreviewSource } from './previews';

/** What a phone's preview of a media item is made from. */
export interface PreviewLookups {
  mediaDir: string;
  /** A media item's kind and file (relative to the media folder). */
  kindAndFile: (
    mediaId: string,
  ) => { kind: 'image' | 'video' | 'audio'; path: string; missing: boolean } | null;
  /** A picture's sharpened copy, relative to the media folder, once it is ready (Session 26f). */
  sharpened: (mediaId: string, step: number) => string | null;
}

/** The file a phone's preview of `mediaId` is made from: a picture or a video inside the media folder. */
export function previewSource(mediaId: string, deps: PreviewLookups): PreviewSource | null {
  if (!MEDIA_ID_PATTERN.test(mediaId)) return null;
  // A picture's sharpened copy (Session 26f): its preview is made from the copy, once it is ready.
  const copy = copyOfId(mediaId);
  if (copy) {
    const relative = deps.sharpened(copy.mediaId, copy.step);
    const place = relative ? realPlace(deps.mediaDir, join(deps.mediaDir, relative)) : null;
    return place?.inside ? { path: place.path, kind: 'image' } : null;
  }
  const row = deps.kindAndFile(mediaId);
  if (!row || row.missing || row.kind === 'audio' || row.path === '') return null;
  // By its real path: a link in the media folder that leads out of it is refused (Sessions 31–36, SEC-10).
  const place = realPlace(deps.mediaDir, join(deps.mediaDir, row.path));
  return place?.inside ? { path: place.path, kind: row.kind } : null;
}
