import type { VideoEditRecipe, VideoEditSnapshot } from '../../shared/video-edit';
import type { ClipExportRequest } from '../../shared/video-copies';
import type { DetailsRow } from '../media/media-details';
import type { MediaInfo } from './plan';
import type { ExportSourceResult } from './clip-export-service';

/** Structural subset of x61's committed editPlan API. Main supplies that actual planner after S2 lands. */
export type EditedClipPlanner = (input: {
  file: string;
  recipe: VideoEditRecipe;
  info: MediaInfo;
  identity: string;
  range: { startMs: number; endMs: number };
  frame?: '9:16';
  fit?: 'cover';
}) => { durationMs: number; target: 'mp4' | 'webm'; args(output: string): string[] };

interface Deps {
  mediaDir: string;
  /** Reverse proxy identity first, then the immutable edit rendition, to the full-quality original. */
  sourceId(id: string): string;
  row(id: string): DetailsRow | null;
  read(id: string): VideoEditSnapshot | null;
  plan: EditedClipPlanner;
}

/** Captures the saved recipe and original bytes once. A later Save cannot change an accepted export. */
export function editedClipSource(request: ClipExportRequest, deps: Deps): ExportSourceResult {
  void request;
  void deps;
  return { ok: false, message: 'The edited clip is not ready. Save its edits and try again.' };
}
