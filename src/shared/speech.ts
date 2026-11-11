/*
 * What the speech hub hears (Session 55, Part 10; the lead's interface of 4 Nov 2026). Main process only:
 * a window, phone or node never receives speech. Captions reach the screens through the engine state, as
 * everything else drawn does. The words are never kept or logged (src/main/speech/speech-hub.ts).
 */

/** The languages Drashti listens for: Gujarati, Hindi, Sanskrit and English. */
export const SPEECH_LANGUAGES = ['gu', 'hi', 'sa', 'en'] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];

/** One word as it was heard. */
export interface HeardWord {
  /** The word, Unicode NFC, no surrounding spaces; never empty. */
  text: string;
  /** When its sound began and ended: ms since the epoch (Date.now()'s clock). */
  startAt: number;
  endAt: number;
  /** The engine's confidence, 0 to 1, or null when it gives none. */
  confidence: number | null;
}

/** One stretch of speech (a phrase between pauses), as far as it has been heard. */
export interface Heard {
  /** The same while its words are revised; a final one's id is never sent again. "s1", "s2"… from each start of listening. */
  id: string;
  /** False: its words may still change (a later Heard with the same id replaces it whole). True: settled. */
  final: boolean;
  /** The language of its words, as the engine heard it (or the one the admin chose). */
  language: SpeechLanguage;
  /** How sure the engine is of that language, 0 to 1, or null. */
  languageConfidence: number | null;
  /** The words in order; their times never run backwards. May be empty in a partial. */
  words: readonly HeardWord[];
  /** The words as a caption shows them: one space between, the engine's punctuation. */
  text: string;
  /** When its first word began and its last word ended (epoch ms), and when the engine gave this (epoch ms). */
  startAt: number;
  endAt: number;
  heardAt: number;
}

/** What the listening is doing now. */
export type SpeechState =
  /** The admin's switch is off, or nobody listens. */
  | { phase: 'off' }
  /** The engine and its model are being loaded (the model downloaded once first, if it is not there yet). */
  | { phase: 'starting' }
  | { phase: 'listening'; language: SpeechLanguage | 'auto' }
  /** Stopped by itself: the computer is short (the show comes first), there is no sound input, or no model. */
  | { phase: 'held'; reason: 'busy' | 'no-sound-input' | 'no-model' }
  | { phase: 'failed'; message: string };
