import type { MediaRepo } from '../db/media';
import type { VideoEditsRepo } from '../db/video-edits';

/** Physical copies keep ordinary clocks; durable statistics and resume points belong to their library source. */
export function editedPlayHistory(
  media: Pick<MediaRepo, 'countPlay' | 'keepResume' | 'forgetResume' | 'resumeOf'>,
  edits: Pick<VideoEditsRepo, 'sourceId' | 'renditionOf'>,
) {
  return {
    countPlay: (id: string, at: string) => media.countPlay(edits.sourceId(id), at),
    keepResume: (id: string, atMs: number, at: string) => {
      const copy = edits.renditionOf(id);
      const sourceMs = copy ? (copy.recipe.trim.startMs ?? 0) + atMs * copy.recipe.speed : atMs;
      media.keepResume(edits.sourceId(id), Math.round(sourceMs), at);
    },
    forgetResume: (id: string) => media.forgetResume(edits.sourceId(id)),
    resumeOf: (id: string) => {
      const point = media.resumeOf(edits.sourceId(id));
      const copy = edits.renditionOf(id);
      if (!point || !copy) return point;
      const start = copy.recipe.trim.startMs ?? 0;
      const end = copy.recipe.trim.endMs;
      if (point.atMs < start || (end !== null && point.atMs >= end)) return null;
      return { ...point, atMs: Math.round((point.atMs - start) / copy.recipe.speed) };
    },
  };
}
