import type { SpeechLanguage } from './speech';

/*
 * Captions in another language than the speaker's (alpha.24, QA24-CAPLANG-2; the owner's answers 2a-2f, all A):
 * live captions translated phrase by phrase on this computer by the translation pack's engine (IndicTrans2, the one
 * Prepare translations uses), through the captions coordinator's translation slot. One choice for the whole show,
 * Pro Mode only ("Captions in", under the speaker's language, and File › Caption Language). The audience screens and
 * the stream show the translation only, a whole phrase at a time, long ones as two-line pages; the stage keeps the
 * speaker's own words; phones, the API and output nodes still get no live captions. A phrase whose translation is
 * late or fails is skipped and counted, never shown late, and captions never fall back to the speaker's language by
 * themselves. Trial, off until chosen.
 */

/** "Captions in": the speaker's own language (today's captions), or one of the three the pack translates into. */
export const CAPTION_TARGETS = ['same', 'gu', 'hi', 'en'] as const;
export type CaptionTarget = (typeof CAPTION_TARGETS)[number];
export const DEFAULT_CAPTION_TARGET: CaptionTarget = 'same';
export const isCaptionTarget = (value: unknown): value is CaptionTarget =>
  (CAPTION_TARGETS as readonly unknown[]).includes(value);

/** The names the dialog and File › Caption Language show, in this order. */
export const CAPTION_TARGET_NAMES: Readonly<Record<CaptionTarget, string>> = Object.freeze({
  same: 'Same as the speaker',
  gu: 'Gujarati (trial)',
  hi: 'Hindi (trial)',
  en: 'English (trial)',
});

/** The languages a speaker may be translated from (2d: all six pairs between these three). */
export const TRANSLATED_SPEECH: readonly SpeechLanguage[] = ['gu', 'hi', 'en'];

/** Why "Captions in" cannot translate on this computer now (the dialog says it in plain words). */
export type CaptionTranslationUnavailable =
  /** This copy of Drashti has no translation program (drashti-translate). */
  | 'no-engine'
  /** No imported translation pack holds a model for this pair (Help › Caption and Translation Models…). */
  | 'no-pack'
  /** The pack holds a model for this pair that this Drashti does not run. */
  | 'unknown-model'
  /** The speaker's language is "as heard": translation needs one chosen language (Gujarati is often taken for Hindi). */
  | 'speaker-as-heard'
  /** Sanskrit speech is not translated (2d). */
  | 'speaker-sanskrit'
  /** 2f: live captions do not keep up on this computer (they stopped as too slow), or translations kept coming late. */
  | 'too-slow';

/** How translated captions stand on this computer, for the Live Captions dialog (inside CaptionsStatus). */
export interface CaptionTranslationStatus {
  /** The language captions are translated into now, or null when they show the speaker's own words. */
  target: SpeechLanguage | null;
  /** Whether "Captions in" can translate here now for the chosen speaker's language (2f). */
  offered: boolean;
  /** Why not, when it cannot; null when it can (or "Same as the speaker" is chosen and nothing is asked). */
  unavailable: CaptionTranslationUnavailable | null;
  /** Phrases skipped since captions last started: their translation was late, failed, or could not be shown. */
  skipped: number;
  /** The engine's last fault in plain words (no word heard in it), or null. Kept until captions start again. */
  fault: string | null;
}

export const NO_CAPTION_TRANSLATION: Readonly<CaptionTranslationStatus> = Object.freeze({
  target: null,
  offered: false,
  unavailable: null,
  skipped: 0,
  fault: null,
});

/**
 * The language captions are translated into for these choices, or null for the speaker's own words: "Same as the
 * speaker", the speaker's own language chosen as the target, "as heard" and Sanskrit all give null.
 */
export function translationTarget(
  speaker: SpeechLanguage | 'auto',
  target: CaptionTarget | undefined,
): SpeechLanguage | null {
  if (target === undefined || target === 'same' || speaker === 'auto') return null;
  if (!TRANSLATED_SPEECH.includes(speaker) || speaker === target) return null;
  return target;
}

/** While translating, a phrase is cut at this length (not the 12 s default), so each translation comes sooner. */
export const TRANSLATED_LONGEST_MS = 8_000;

/** After this many translations in a row came too late, translated captions stop on this computer (2f), and say so. */
export const TRANSLATION_STOP_AFTER_LATE = 3;

/** A long translation's pages: each two lines, shown in turn for this long per word, never shorter than the floor. */
export const CAPTION_PAGE_MS_PER_WORD = 400;
export const CAPTION_PAGE_MIN_MS = 1_500;

/**
 * The seam for spoken times and numbers (a24-captime's shared module, normalizeSpokenTimes(text, lang)): applied to
 * the speaker's words just before they are translated ("sava aath" -> 8:15), never to what the stage shows.
 */
export type SpokenTimes = (text: string, language: 'gu' | 'hi' | 'en') => string;

/** The speaker's own words for the stage screens while the audience screens and the stream show a translation. */
export interface CaptionStageBand {
  lines: string[];
  language: SpeechLanguage;
  fit?: true;
}
