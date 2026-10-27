import { join } from 'node:path';
import { copyOfId, MEDIA_ID_PATTERN } from '../../shared/media';
import { realPlace } from '../media/contained';

/*
 * A sound played on a phone or tablet (Session 54, D3): a playlist shared with phones is there "to view and play",
 * so a Remote may fetch a sound's own file, in pieces as it plays, while a shared playlist has that sound, and
 * never otherwise. Pictures and videos come by D1's own rules (preview-source.ts, which leaves sounds out: a sound
 * has no picture); the library's other sounds stay on Drashti's computer.
 */

/** What a shared sound's file is found by. */
export interface SharedSoundLookups {
  mediaDir: string;
  /** A media item's kind and file (relative to the media folder). */
  kindAndFile: (
    mediaId: string,
  ) => { kind: 'image' | 'video' | 'audio'; path: string; missing: boolean } | null;
  /** Whether a playlist shared with phones has this media item now. */
  shared: (mediaId: string) => boolean;
}

/** A sound's own file, by its real path inside the media folder, while a shared playlist has it; null otherwise. */
export function sharedSoundFile(mediaId: string, deps: SharedSoundLookups): string | null {
  if (!MEDIA_ID_PATTERN.test(mediaId) || copyOfId(mediaId)) return null;
  const row = deps.kindAndFile(mediaId);
  if (row?.kind !== 'audio' || row.missing || row.path === '' || !deps.shared(mediaId)) return null;
  // By its real path: a link in the media folder that leads out of it is refused (Sessions 31–36, SEC-10).
  const place = realPlace(deps.mediaDir, join(deps.mediaDir, row.path));
  return place?.inside ? place.path : null;
}
