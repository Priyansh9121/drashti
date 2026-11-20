import type { MediaInfo } from './plan';
export interface ClipPlan {
  source: string;
  startMs: number;
  endMs: number;
  shape: 'source' | 'vertical';
  info: MediaInfo;
  alpha?: boolean;
  audioTrack?: number | null;
}
export function clipExportArgs(_input: ClipPlan, _dest: string): string[] {
  throw new Error('Clip exporting is not implemented.');
}
