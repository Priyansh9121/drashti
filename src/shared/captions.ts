import { z } from 'zod';
import { SPEECH_LANGUAGES, type SpeechLanguage } from './speech';

/*
 * Live captions (Session 55, Part 10): speech from the stream's sound input, heard on this computer
 * (src/main/speech/), drawn as one or two lines on the stream and the stage, and on the audience screens only if
 * chosen. The screens get only the lines to draw now, through the engine's state (engine state 26); the words are
 * never kept, logged or sent to a phone or a node (src/shared/engine/captions-filter.ts).
 */

/** How big the captions are drawn. */
export const CAPTION_SIZES = ['small', 'medium', 'large'] as const;
export type CaptionSize = (typeof CAPTION_SIZES)[number];

/** Where on the screen: along the bottom (the default) or the top (when lower thirds use the bottom). */
export const CAPTION_PLACES = ['bottom', 'top'] as const;
export type CaptionPlace = (typeof CAPTION_PLACES)[number];

/**
 * The library's captions settings (migration 066): the language listened for ('auto': the engine's own choice among
 * Gujarati, Hindi and English, phrase by phrase), whether the audience screens show the captions too (the stream and
 * the stage always do), and their size and place. Whether captions are on at all belongs to the computer, not the
 * library (src/main/speech/captions-switch.ts): the model and the work are this computer's.
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
  lines: string[];
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
