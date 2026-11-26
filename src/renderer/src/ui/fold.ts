/*
 * A section's fold (alpha.24, uimotion): the stand-in before its rules (red first). Today only Lively opens with
 * motion, and nothing folds with any.
 */

export type FoldMove = 'calm' | 'lively';

export interface FoldFacts {
  opened: boolean;
  motion: string | undefined;
  off: boolean;
  chip: string | undefined;
  sinceShow: number;
}

export function foldMove(f: FoldFacts): FoldMove | null {
  return f.motion === 'lively' && !f.off && f.sinceShow > 800 ? 'lively' : null;
}

export function glides(before: readonly number[], after: readonly number[]): number[] {
  return after.map((_, i) => before[i] ?? 0);
}

export function clipInside(
  _box: { top: number; right: number; bottom: number; left: number },
  _window: { width: number; height: number },
): string {
  return '';
}
