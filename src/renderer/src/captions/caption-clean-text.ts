import type { SpeechLanguage } from '../../../shared/speech';
import { plural } from '../../../shared/text';

/* The words-left-out sentences (alpha.24, QA24-CAPCLEAN-1): counts only, never a word. */

/** The Live Captions dialog's line: how many words captions have left out since they were last turned on. */
export function captionCleanCountText(leftOut: number): string {
  if (leftOut === 0) return 'No words left out since captions were turned on.';
  return `${plural(leftOut, 'word')} left out since captions were turned on.`;
}

/** The line under a language's list: how many words of the admin's own it has. */
export function captionCleanListText(name: string, count: number): string {
  if (count === 0) return `No ${name} words of your own yet.`;
  return `${plural(count, `${name} word`)} of your own.`;
}

/** How many words Drashti's own list has (never which), and that every caption is checked against all of them. */
export function captionCleanOwnText(own: Record<SpeechLanguage, number>): string {
  const total = own.gu + own.hi + own.sa + own.en;
  return `Drashti’s own list has ${plural(total, 'word')} in Gujarati, Hindi and English, and every caption is checked against all of them, whatever its language.`;
}

/** A word of the admin's while the words are hidden: by its place in the list. */
export function hiddenWordName(index: number): string {
  return `Hidden word ${String(index + 1)}`;
}
