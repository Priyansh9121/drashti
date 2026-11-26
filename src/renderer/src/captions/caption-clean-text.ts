import type { SpeechLanguage } from '../../../shared/speech';

/* The words-left-out dialogs' sentences (alpha.24, QA24-CAPCLEAN-1). Red first: not written yet. */

export function captionCleanCountText(leftOut: number): string {
  return String(leftOut);
}

export function captionCleanListText(name: string, count: number): string {
  return `${name} ${String(count)}`;
}

export function captionCleanOwnText(own: Record<SpeechLanguage, number>): string {
  return String(own.gu);
}

export function hiddenWordName(index: number): string {
  return String(index);
}
