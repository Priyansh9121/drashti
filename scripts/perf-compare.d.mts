export interface RawChange {
  rev: number;
  keyAt: number;
  mainAt: number | null;
  committedAt?: number | null;
  paintedAt: number | null;
  nextAt: number | null;
}
export interface Difference {
  diff: number;
  low: number;
  high: number;
}
export function segmentValues(changes: RawChange[]): Record<string, number[]>;
export function percentile(values: number[], p: number): number;
export function seeded(seed: number): () => number;
export function bootstrapDifference(
  base: number[],
  head: number[],
  stat: (values: number[]) => number,
  options?: { iterations?: number; seed?: number },
): Difference;
export function verdict(d: Difference): string;
export function compare(
  base: RawChange[],
  head: RawChange[],
  options?: { iterations?: number; seed?: number },
): string[];
export function changesIn(files: string[]): RawChange[];
