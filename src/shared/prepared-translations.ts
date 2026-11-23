/** Saved review attaches to exact source words, never just a slide ID. */
export type TranslationLanguage = 'gu' | 'hi' | 'en';
export interface PreparedTranslation {
  sourceFingerprint: string;
  sourceLanguage: TranslationLanguage;
  targetLanguage: TranslationLanguage;
  text: string;
  state: 'unchecked' | 'checked' | 'needs-recheck';
  reader: string | null;
}

// A lossless fingerprint avoids collisions and works identically in every renderer.
export const sourceFingerprint = (source: string): string => JSON.stringify(source);

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
  };
}

export function translationForSource(value: PreparedTranslation, source: string): PreparedTranslation {
  return value.sourceFingerprint === sourceFingerprint(source)
    ? value
    : { ...value, state: 'needs-recheck', reader: null };
}

export function checkTranslation(
  value: PreparedTranslation,
  source: string,
  reader: string,
): PreparedTranslation {
  if (!reader.trim() || !value.text.trim() || value.sourceFingerprint !== sourceFingerprint(source)) {
    throw new Error('Check the current source and translation with a named reader.');
  }
  return { ...value, state: 'checked', reader: reader.trim() };
}

export function checkedText(value: PreparedTranslation, source: string): string | null {
  return value.state === 'checked' &&
    value.reader?.trim() &&
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
