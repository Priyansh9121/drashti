import type { CaptionTranslationUnavailable } from '../../../shared/caption-translation';
import type { CaptionsStatus } from '../../../shared/captions';

/* "Captions in" (alpha.24, QA24-CAPLANG-2): the words. Red stub: nothing said yet. */

export const TRANSLATION_TRIAL_WARNING = '';

export function unavailableText(_reason: CaptionTranslationUnavailable | null): string {
  return '';
}

export function captionTargetWhyNot(_view: CaptionsStatus): string | null {
  return null;
}

export function skippedText(_skipped: number): string {
  return '';
}

export function translationStatusLine(_view: CaptionsStatus | null): string | null {
  return null;
}
