import type { CaptionWord } from '../../shared/caption-words';
import type { Heard } from '../../shared/speech';

/* The spelling fixer after recognition (alpha.22): red first, not written yet. */

export function editDistance(_a: readonly string[], _b: readonly string[], _max: number): number {
  return 0;
}

export function allowedEdits(_letters: number): number {
  return 0;
}

export function spellingFixer(_words: readonly CaptionWord[]): (h: Heard) => Heard {
  return (h) => h;
}
