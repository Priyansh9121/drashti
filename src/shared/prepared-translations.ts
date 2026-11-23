/** Saved review attaches to exact source words, never just a slide ID. */
export type TranslationLanguage = 'gu' | 'hi' | 'en';
export interface PreparedTranslation {
  sourceFingerprint: string;
  sourceLanguage: TranslationLanguage;
  targetLanguage: TranslationLanguage;
  text: string;
  state: 'unchecked' | 'checked' | 'needs-recheck';
  reader: string | null;
  /** Lossless identity of the exact source/result/language pair the reader approved. */
  reviewFingerprint: string | null;
}

// Lossless encoding of the app’s canonical NFC source avoids collisions across renderers.
export const sourceFingerprint = (source: string): string => JSON.stringify(source.normalize('NFC'));

export const reviewFingerprint = (
  value: Pick<PreparedTranslation, 'sourceFingerprint' | 'sourceLanguage' | 'targetLanguage' | 'text'>,
): string =>
  JSON.stringify([value.sourceFingerprint, value.sourceLanguage, value.targetLanguage, value.text]);

export function draftTranslation(
  source: string,
  sourceLanguage: TranslationLanguage,
  targetLanguage: TranslationLanguage,
  text: string,
): PreparedTranslation {
  return {
    sourceFingerprint: sourceFingerprint(source),
    sourceLanguage,
    targetLanguage,
    text,
    state: 'unchecked',
    reader: null,
    reviewFingerprint: null,
  };
}

export function translationForSource(value: PreparedTranslation, source: string): PreparedTranslation {
  if (value.sourceFingerprint === sourceFingerprint(source)) return value;
  return value.state === 'needs-recheck' && value.reader === null && value.reviewFingerprint === null
    ? value
    : { ...value, state: 'needs-recheck', reader: null, reviewFingerprint: null };
}

export function checkTranslation(
  value: PreparedTranslation,
  source: string,
  reader: string,
): PreparedTranslation {
  if (!reader.trim() || !value.text.trim() || value.sourceFingerprint !== sourceFingerprint(source)) {
    throw new Error('Check the current source and translation with a named reader.');
  }
  return { ...value, state: 'checked', reader: reader.trim(), reviewFingerprint: reviewFingerprint(value) };
}

export function checkedText(value: PreparedTranslation, source: string): string | null {
  return value.state === 'checked' &&
    value.reader?.trim() &&
    value.text.trim() &&
    value.reviewFingerprint === reviewFingerprint(value) &&
    value.sourceFingerprint === sourceFingerprint(source)
    ? value.text
    : null;
}

export interface Translator {
  translate(source: string, from: TranslationLanguage, to: TranslationLanguage): Promise<string>;
}

export const noTranslator = { status: 'No engine installed' } as const;

/** Test double only; never connect placeholder generation to the operator's library. */
export class StandInTranslator implements Translator {
  translate(source: string, from: TranslationLanguage, to: TranslationLanguage): Promise<string> {
    return Promise.resolve(`[Test placeholder ${from}/${to}: ${sourceFingerprint(source)}]`);
  }
}

/** Changing translated words always starts a new review of the current source. */
export function editTranslation(
  value: PreparedTranslation,
  source: string,
  text: string,
): PreparedTranslation {
  if (value.text === text && value.sourceFingerprint === sourceFingerprint(source)) return value;
  return draftTranslation(source, value.sourceLanguage, value.targetLanguage, text);
}
