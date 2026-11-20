import type { VideoEditRecipe } from '../../shared/video-edit';
import type { MediaInfo } from './plan';

export interface EditPlanInput {
  file: string;
  recipe: VideoEditRecipe;
  info: MediaInfo;
  identity: string;
  range?: { startMs: number; endMs: number };
  frame?: 'source' | '16:9' | '4:3' | '1:1' | '9:16';
  fit?: 'contain' | 'cover';
}
export interface EditPlan {
  sourceStartMs: number;
  sourceEndMs: number;
  durationMs: number;
  target: 'mp4' | 'webm';
  args(output: string): string[];
}

/** Red-first scaffold: the final builder is also the clip-export slice's single render path. */
export function editPlan(_input: EditPlanInput): EditPlan {
  return { sourceStartMs: 0, sourceEndMs: 0, durationMs: 0, target: 'mp4', args: () => [] };
}
