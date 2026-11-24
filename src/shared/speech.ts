/*
 * What the speech hub hears (Session 55, Part 10; the lead's interface of 4 Nov 2026). Main process only:
 * a window, phone or node never receives speech. Captions reach the screens through the engine state, as
 * everything else drawn does. Final phrases can go into the local draft beside an operator's sound recording.
 */

/** The stream's raw sound tap supplies mono PCM at this sample rate. */
export const SPEECH_RATE = 16_000;

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

/**
 * Why captions rest when the computer cannot keep up (cap-threads): what the whisper engine measured, numbers only.
 * It holds when one answer is more than 8 s behind the speaker, or three answers in a row take over 1.5 steps.
 */
/**
 * The whisper engine rests when its answers fall more than 8 s behind the speaker, or when this many answers in a row
 * each took longer than SlowHold.limitMs (cap-threads).
 */
export const SLOW_ANSWERS_IN_A_ROW = 3;

export interface SlowHold {
  /** How long the last answer took (ms), and how far behind the speaker its phrase's end then was (ms). */
  answerMs: number;
  behindMs: number;
  /** An answer slower than this counts as slow (ms): 1.5 times New words every (cap-review-threads n4). */
  limitMs: number;
  /** The engine's threads, and this computer's logical processors. */
  threads: number;
  processors: number;
  /** Rests in a row with no phrase heard whole between them: 1 at the first. */
  rests: number;
  /**
   * Whether a phrase has been heard whole since this start of listening (cap-review-threads MUST-1): a computer that
   * has kept up once is only busy for a while, and is never stopped for it.
   */
  keptUp: boolean;
  /**
   * The engine's one decision (the owner, Q-CT-1: "Say so and stop"): this rest is the CAPTIONS_STOP_AFTER_RESTS-th in a
   * row with nothing heard whole since this start, so it stops trying and captions turn off.
   */
  stops: boolean;
}

/** What the listening is doing now. */
export type SpeechState =
  /** The admin's switch is off, or nobody listens. */
  | { phase: 'off' }
  /** The engine and its model are being loaded (the model downloaded once first, if it is not there yet). */
  | { phase: 'starting' }
  | { phase: 'listening'; language: SpeechLanguage | 'auto' }
  /** Stopped by itself: the computer is short (the show comes first), there is no sound input, or no model. */
  /** `slow`: what the whisper engine measured when it rested for slowness (cap-threads); left out otherwise. */
  | { phase: 'held'; reason: 'busy' | 'no-sound-input' | 'no-model'; slow?: SlowHold }
  | { phase: 'failed'; message: string };
