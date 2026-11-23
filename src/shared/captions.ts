import { z } from 'zod';
import { SPEECH_LANGUAGES, type SpeechLanguage, type SpeechState } from './speech';

/*
 * Live captions (Session 55, Part 10): speech from the stream's sound input, heard on this computer
 * (src/main/speech/), drawn as one or two lines on the stream and the stage, and on the audience screens only if
 * chosen. The screens get the lines to draw through engine state. Phones and nodes receive the filtered state.
 * During a sound recording, final phrases can also go into the draft beside the audio.
 */

/** How big the captions are drawn. */
export const CAPTION_SIZES = ['small', 'medium', 'large'] as const;
export type CaptionSize = (typeof CAPTION_SIZES)[number];

/** Where on the screen: along the bottom (the default) or the top (when lower thirds use the bottom). */
export const CAPTION_PLACES = ['bottom', 'top'] as const;
export type CaptionPlace = (typeof CAPTION_PLACES)[number];

/**
 * The library's captions settings (migration 066): the language listened for ('auto': the engine's own choice among
 * Gujarati, Hindi, Sanskrit and English, phrase by phrase), whether the audience screens show the captions too
 * (the stream and the stage always do), and their size and place. Whether captions are on belongs to the
 * computer (src/main/speech/captions-switch.ts).
 */
export interface CaptionSettings {
  language: SpeechLanguage | 'auto';
  audience: boolean;
  size: CaptionSize;
  place: CaptionPlace;
}

export const DEFAULT_CAPTION_SETTINGS: Readonly<CaptionSettings> = Object.freeze({
  language: 'auto',
  audience: false,
  size: 'medium',
  place: 'bottom',
});

export const captionSettingsSchema = z.object({
  language: z.enum(['auto', ...SPEECH_LANGUAGES]),
  audience: z.boolean(),
  size: z.enum(CAPTION_SIZES),
  place: z.enum(CAPTION_PLACES),
});

/** Settings as stored or sent, each field checked on its own: anything unknown is that field's default. */
export function parseCaptionSettings(raw: unknown): CaptionSettings {
  const from = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const shape = captionSettingsSchema.shape;
  const language = shape.language.safeParse(from['language']);
  const audience = shape.audience.safeParse(from['audience']);
  const size = shape.size.safeParse(from['size']);
  const place = shape.place.safeParse(from['place']);
  return {
    language: language.success ? language.data : DEFAULT_CAPTION_SETTINGS.language,
    audience: audience.success ? audience.data : DEFAULT_CAPTION_SETTINGS.audience,
    size: size.success ? size.data : DEFAULT_CAPTION_SETTINGS.size,
    place: place.success ? place.data : DEFAULT_CAPTION_SETTINGS.place,
  };
}

/**
 * What the screens draw now (engine state 26): the last one or two lines heard, oldest first. Only the main process
 * sets it; null when nothing is being said (or captions are off). Never kept: the recovery file leaves it out.
 */
export interface CaptionsShown {
  /** Phase D clause bands fit their measured width; absent for the existing roll-up path. */
  fit?: true;
  lines: string[];
  /** The spoken language. Sanskrit captions use Gujarati letters. */
  language: SpeechLanguage;
  /** The audience screens draw them too (the admin's choice); the stream and the stage always do. */
  audience: boolean;
  size: CaptionSize;
  place: CaptionPlace;
}

/**
 * Letters per line at each size, about what broadcast captions allow on a 16:9 picture (32 to 42), so a line stays
 * readable from the back of the hall and on a phone watching the stream.
 */
export const CAPTION_LINE_CHARS: Readonly<Record<CaptionSize, number>> = Object.freeze({
  small: 48,
  medium: 40,
  large: 32,
});

/** The letters' height as a share of the screen's height (a 1080-line screen: 45, 56 and 70 pixels). */
export const CAPTION_TEXT_HEIGHT: Readonly<Record<CaptionSize, number>> = Object.freeze({
  small: 0.042,
  medium: 0.052,
  large: 0.065,
});

/** How many letters a word has as it is drawn (code points: a vowel sign counts, as a fair stand-in for its width). */
function lettersOf(text: string): number {
  let letters = 0;
  for (const _letter of text) letters += 1;
  return letters;
}

/**
 * The words as lines of at most `max` letters, filled from the first word, so a line already shown never changes
 * as more words come (roll-up captions); a word longer than a line goes alone on its own line, never cut. The last
 * `keep` lines.
 */
export function captionLines(words: readonly string[], max: number, keep = 2): string[] {
  const lines: string[] = [];
  let line = '';
  let length = 0;
  for (const word of words) {
    const size = lettersOf(word);
    if (size === 0) continue;
    if (line !== '' && length + 1 + size <= max) {
      line = `${line} ${word}`;
      length += 1 + size;
      continue;
    }
    if (line !== '') lines.push(line);
    line = word;
    length = size;
  }
  if (line !== '') lines.push(line);
  return lines.slice(Math.max(0, lines.length - keep));
}

/** Which kind of screen draws: the hall's audience screens, the stage screens or the stream. */
export type CaptionScreen = 'hall' | 'stage' | 'stream';

/**
 * The captions a screen of this kind draws now, or null: the stream and the stage always, the audience screens only
 * when the admin chose them too.
 */
export function captionsFor(
  captions: CaptionsShown | null | undefined,
  screen: CaptionScreen,
): CaptionsShown | null {
  if (!captions || captions.lines.length === 0) return null;
  return screen === 'hall' && !captions.audience ? null : captions;
}

/**
 * The models an admin can choose (whisper.cpp's, MIT, downloaded once into Drashti's data folder: never in the app or
 * its installers). Standard hears English well and Hindi passably, and keeps up on an ordinary computer; Most accurate
 * hears Hindi far better but needs a fast computer (a Mac with Apple silicon). Neither is good enough for Gujarati yet
 * (Session 55's trial), so captions are marked Trial.
 */
export const CAPTION_MODELS = Object.freeze({
  small: Object.freeze({ name: 'Standard', bytes: 487_601_967 }),
  turbo: Object.freeze({ name: 'Most accurate (needs a fast computer)', bytes: 574_041_195 }),
});
export type CaptionModelId = keyof typeof CAPTION_MODELS;
export const CAPTION_MODEL_IDS = Object.keys(CAPTION_MODELS) as CaptionModelId[];

/** Whether a value sent is one of the models. */
export const isCaptionModel = (value: unknown): value is CaptionModelId =>
  CAPTION_MODEL_IDS.some((id) => id === value);

/** The model a computer starts with: Most accurate on a Mac with Apple silicon, Standard everywhere else. */
export function defaultModel(platform: string, arch: string): CaptionModelId {
  return platform === 'darwin' && arch === 'arm64' ? 'turbo' : 'small';
}

/**
 * A model of its own for one language (alpha.22): Gujarati, Hindi or English, chosen on this computer. It hears that
 * language when the speaker's language is set to it; Sanskrit, and captions "as heard", use the general model above.
 * Drashti knows each such model by its SHA-256 (main/speech/language-models.ts): no other file is used.
 */
export const LANGUAGE_MODEL_LANGUAGES = ['gu', 'hi', 'en'] as const;
export type LanguageModelLanguage = (typeof LANGUAGE_MODEL_LANGUAGES)[number];

export const isLanguageModelLanguage = (value: unknown): value is LanguageModelLanguage =>
  LANGUAGE_MODEL_LANGUAGES.some((language) => language === value);

/** How one language's own model stands on this computer. */
export interface LanguageModelView {
  language: LanguageModelLanguage;
  /** The models this copy of Drashti knows for the language, and whether each is on this computer. */
  known: readonly { id: string; name: string; bytes: number; here: boolean }[];
  /** The one chosen on this computer, or null: the general model hears the language. */
  chosen: string | null;
  /**
   * general: none chosen. ready: here and checked. missing: chosen but not on this computer. changed: its file is
   * not as it was checked, so it is not used. unknown: chosen, but this copy of Drashti does not know it. checking:
   * a file is being checked.
   */
  phase: 'general' | 'ready' | 'missing' | 'changed' | 'unknown' | 'checking';
  /** What to do, or why a file was refused (plain words), or null. */
  message: string | null;
}

/**
 * Live timing (alpha.22, from x80's budget for live captions), on this computer: how often the words of a phrase
 * being heard are worked out again (the step), how long a pause ends a phrase, the longest phrase (the chunk), how
 * loud sound must be to count as speech, and the engine's threads. The defaults are the timing captions always had.
 */
export const CAPTION_STEPS_MS = [1_500, 1_000] as const;
export const CAPTION_PAUSES_MS = [700, 500] as const;
export const CAPTION_LONGEST_MS = [12_000, 8_000, 6_000] as const;
export const CAPTION_SPEECH_LEVELS = ['standard', 'quiet-room', 'noisy-hall'] as const;
export const CAPTION_THREADS = [4, 2, 1] as const;

export interface CaptionTiming {
  stepMs: (typeof CAPTION_STEPS_MS)[number];
  pauseMs: (typeof CAPTION_PAUSES_MS)[number];
  longestMs: (typeof CAPTION_LONGEST_MS)[number];
  speech: (typeof CAPTION_SPEECH_LEVELS)[number];
  threads: (typeof CAPTION_THREADS)[number];
}

export const DEFAULT_CAPTION_TIMING: Readonly<CaptionTiming> = Object.freeze({
  stepMs: 1_500,
  pauseMs: 700,
  longestMs: 12_000,
  speech: 'standard',
  threads: 4,
});

/** Timing as stored or sent, each field checked on its own: anything unknown is that field's default. */
export function parseCaptionTiming(raw: unknown): CaptionTiming {
  const from = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const pick = <T>(choices: readonly T[], value: unknown, fallback: T): T =>
    choices.find((choice) => choice === value) ?? fallback;
  const d = DEFAULT_CAPTION_TIMING;
  return {
    stepMs: pick(CAPTION_STEPS_MS, from['stepMs'], d.stepMs),
    pauseMs: pick(CAPTION_PAUSES_MS, from['pauseMs'], d.pauseMs),
    longestMs: pick(CAPTION_LONGEST_MS, from['longestMs'], d.longestMs),
    speech: pick(CAPTION_SPEECH_LEVELS, from['speech'], d.speech),
    threads: pick(CAPTION_THREADS, from['threads'], d.threads),
  };
}

/** How the captions model stands on this computer: not here, coming (bytes so far), here, or not downloaded (why). */
export interface CaptionsDownload {
  phase: 'missing' | 'downloading' | 'ready' | 'failed';
  done: number;
  total: number;
  message: string | null;
}

/** What the Live captions dialog shows (Pro Mode): never a word heard. */
export interface CaptionsStatus {
  /** The admin's switch on this computer. */
  on: boolean;
  model: CaptionModelId;
  settings: CaptionSettings;
  download: CaptionsDownload;
  /** What the listening is doing now. */
  speech: SpeechState;
  /** Whether this copy of Drashti has the captions engine (scripts/fetch-whisper.mjs bundles it) and can run it. */
  engine: boolean;
  /** Why not, when it cannot: no engine in this copy, or a Mac older than macOS 13.3. */
  engineProblem: string | null;
  /** Captions are a trial: Gujarati is not good enough yet with any free model (Session 55). */
  trial: boolean;
  /** Gujarati's, Hindi's and English's own models on this computer (alpha.22), in that order. */
  languageModels: LanguageModelView[];
  /** Live timing on this computer (alpha.22). */
  timing: CaptionTiming;
}
