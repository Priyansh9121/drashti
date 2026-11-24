import type { MediaInfo } from './plan';

/** Red first (alpha.22, Combine videos…): not built yet. */
export interface CombineInput {
  file: string;
  info: MediaInfo;
  words: string;
}
export interface CombinePlan {
  width: number;
  height: number;
  rate: string;
  lengthMs: number;
  args(dest: string): string[];
}
export function combinePlan(_inputs: readonly CombineInput[]): CombinePlan {
  throw new Error('Not built yet.');
}
export function frameFacts(_words: string): { rate: string | null; sar: number; turned: boolean } {
  throw new Error('Not built yet.');
}
export function combinedName(_names: readonly string[]): string {
  throw new Error('Not built yet.');
}
