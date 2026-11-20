import type { MediaRepo } from '../db/media';
import type { VideoEditsRepo } from '../db/video-edits';

/** Physical copies keep ordinary clocks; durable statistics and resume points belong to their library source. */
export function editedPlayHistory(
  media: Pick<MediaRepo, 'countPlay' | 'keepResume' | 'forgetResume' | 'resumeOf'>,
  _edits: Pick<VideoEditsRepo, 'sourceId' | 'renditionOf'>,
) {
  return media;
}
