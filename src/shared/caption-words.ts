import { toGujaratiScript } from './scripts';
import { SPEECH_LANGUAGES, type SpeechLanguage } from './speech';

/*
 * Caption words (alpha.22): names and terms a speaker says that a general speech model gets wrong, each spelt as
 * the captions should show it, per language. The admin keeps them (File › Live Captions… › Caption Words…, Pro
 * Mode); they are kept with the library's settings (migration 091, so in its backups), never in a recording, and
 * imported and exported as a small CSV file. The captions engine is given the first ones as hints
 * (main/speech/caption-hints.ts), and a word heard close to one is spelt as written (main/speech/spelling-fixer.ts).
 * Nothing changes while the list is empty.
 */

export interface CaptionWord {
  language: SpeechLanguage;
  /** As the captions show it: NFC, one space between its parts, a letter or a digit at each end. */
  word: string;
}

/** At most this many words a language: the fixer looks at each against every word heard. */
export const CAPTION_WORDS_PER_LANGUAGE = 200;
/** At most this many letters (code points) in one entry, and this many words. */
export const CAPTION_WORD_LETTERS = 40;
export const CAPTION_WORD_PARTS = 3;
/** The list's file is small: at most this many bytes are read. */
export const CAPTION_WORDS_FILE_BYTES = 256 * 1024;

/**
 * Whether a language's caption words go to the captions engine as hints, until the admin changes it: off for
 * Gujarati (cap-drive-learn, 24 Nov: a prompt did not help Gujarati on real speech), on for the others. The spelling
 * fixer works for every language either way.
 */
export const CAPTION_HINTS_ON: Readonly<Record<SpeechLanguage, boolean>> = Object.freeze({
  gu: false,
  hi: true,
  sa: true,
  en: true,
});

export const CAPTION_WORD_LANGUAGE_NAMES: Readonly<Record<SpeechLanguage, string>> = Object.freeze({
  gu: 'Gujarati',
  hi: 'Hindi',
  sa: 'Sanskrit',
  en: 'English',
});

export type CheckedCaptionWord = { ok: true; word: string } | { ok: false; message: string };

/** Gujarati's and Hindi's joiners (ZWNJ, ZWJ): kept as typed, left out when comparing. */
const JOINERS = /[\u200c\u200d]/gu;
/** Hidden signs other than the joiners, and control characters. */
const HIDDEN = /[\p{Cc}\p{Cf}]/u;
/** A word's ends: a letter or a digit at its start, and a letter, a sign (a vowel sign, a virama) or a digit at its end. */
const STARTS = /^[\p{L}\p{N}]/u;
const ENDS = /[\p{L}\p{M}\p{N}]$/u;

const lettersIn = (text: string): number => Array.from(text).length;

/** A word as the admin typed it, as it is kept; or why it cannot be. */
export function checkCaptionWord(text: string): CheckedCaptionWord {
  const word = text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (word === '') return { ok: false, message: 'Type a word or a name.' };
  if (HIDDEN.test(word.replace(JOINERS, '')))
    return { ok: false, message: 'Hidden characters are not kept.' };
  if (/[,"]/u.test(word)) return { ok: false, message: 'A comma or a double quote is not kept in a word.' };
  if (word.split(' ').length > CAPTION_WORD_PARTS)
    return { ok: false, message: 'At most three words in one entry.' };
  if (lettersIn(word) > CAPTION_WORD_LETTERS) return { ok: false, message: 'At most 40 letters.' };
  if (!STARTS.test(word) || !ENDS.test(word))
    return { ok: false, message: 'A word begins and ends with a letter or a digit.' };
  return { ok: true, word };
}

/**
 * How Drashti compares a word with a caption word: NFC, without the joiners, lower case (for English); Sanskrit
 * in Gujarati letters, whichever script it came in (the engine writes it in Devanagari, the screens in Gujarati).
 */
export function captionWordKey(text: string, language: SpeechLanguage): string {
  const key = text.normalize('NFC').replace(JOINERS, '').toLowerCase();
  return language === 'sa' ? toGujaratiScript(key) : key;
}

const isLanguage = (value: unknown): value is SpeechLanguage =>
  (SPEECH_LANGUAGES as readonly unknown[]).includes(value);

/**
 * Words added to a list: each to the end of its language's words, unless it is there already (the same word as
 * compared) or its language has 200. The counts say what happened to the words given.
 */
export function addCaptionWords(
  list: readonly CaptionWord[],
  added: readonly CaptionWord[],
): { words: CaptionWord[]; added: number; already: number; full: number } {
  const words = [...list];
  const keys = new Set(words.map((w) => `${w.language}:${captionWordKey(w.word, w.language)}`));
  const counts = new Map<SpeechLanguage, number>();
  for (const w of words) counts.set(w.language, (counts.get(w.language) ?? 0) + 1);
  let addedCount = 0;
  let already = 0;
  let full = 0;
  for (const w of added) {
    const key = `${w.language}:${captionWordKey(w.word, w.language)}`;
    if (keys.has(key)) already += 1;
    else if ((counts.get(w.language) ?? 0) >= CAPTION_WORDS_PER_LANGUAGE) full += 1;
    else {
      keys.add(key);
      counts.set(w.language, (counts.get(w.language) ?? 0) + 1);
      words.push({ language: w.language, word: w.word });
      addedCount += 1;
    }
  }
  return { words, added: addedCount, already, full };
}

/** A list as stored or sent: each entry checked, repeats and anything past 200 a language left out. */
export function parseCaptionWords(raw: unknown): CaptionWord[] {
  if (!Array.isArray(raw)) return [];
  const checked: CaptionWord[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const fields = item as Record<string, unknown>;
    const language = fields['language'];
    const word = fields['word'];
    if (!isLanguage(language) || typeof word !== 'string') continue;
    const c = checkCaptionWord(word);
    if (c.ok) checked.push({ language, word: c.word });
  }
  return addCaptionWords([], checked).words;
}

/** The list as its file: UTF-8 with the byte-order mark (so a spreadsheet reads the letters right), a heading line. */
export function captionWordsCsv(words: readonly CaptionWord[]): string {
  const rows = words.map((w) => `${CAPTION_WORD_LANGUAGE_NAMES[w.language]},${w.word}\r\n`);
  return `\uFEFFLanguage,Word\r\n${rows.join('')}`;
}

const languageOf = (field: string): SpeechLanguage | null => {
  const name = field.trim().toLowerCase();
  for (const language of SPEECH_LANGUAGES)
    if (name === language || name === CAPTION_WORD_LANGUAGE_NAMES[language].toLowerCase()) return language;
  return null;
};

/** A field as a spreadsheet may have saved it: "in quotes". */
const unquoted = (field: string): string => {
  const f = field.trim();
  return f.length >= 2 && f.startsWith('"') && f.endsWith('"') ? f.slice(1, -1) : f;
};

/**
 * A list's file read, in either of two shapes. One word a line, "language,word" (Gujarati, Hindi, Sanskrit or
 * English, or gu, hi, sa, en), with or without the heading "Language,Word". Or a column for each language, named
 * in the first line ("Gujarati,Hindi,English", or one name alone over a plain list): each row one term in its
 * spellings, an empty cell passed over. Blank lines and lines starting with # are passed over; each line that cannot
 * be read is named, with why.
 */
export function readCaptionWordsCsv(text: string): {
  words: CaptionWord[];
  problems: { line: number; message: string }[];
} {
  const words: CaptionWord[] = [];
  const problems: { line: number; message: string }[] = [];
  const lines = text.replace(/^\uFEFF/u, '').split(/\r\n|\n|\r/u);
  /** The first line's languages, when it names a column for each. */
  let columns: SpeechLanguage[] | null = null;
  let first = true;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const fields = line.split(',').map(unquoted);
    const problem = (message: string) => problems.push({ line: i + 1, message });
    const add = (language: SpeechLanguage, word: string) => {
      const c = checkCaptionWord(word);
      if (c.ok) words.push({ language, word: c.word });
      else problem(c.message);
    };
    if (first) {
      first = false;
      if (fields.length === 2 && /^language$/iu.test(fields[0] ?? '') && /^word$/iu.test(fields[1] ?? ''))
        return;
      const named = fields.map(languageOf);
      if (named.every((l) => l !== null)) {
        columns = named;
        return;
      }
    }
    if (columns) {
      const own = columns;
      if (fields.length > own.length) {
        problem('More words than the first line has languages.');
        return;
      }
      fields.forEach((field, j) => {
        const language = own[j];
        if (language && field !== '') add(language, field);
      });
      return;
    }
    if (fields.length !== 2) {
      problem('A language, a comma, then the word.');
      return;
    }
    const language = languageOf(fields[0] ?? '');
    if (language === null) {
      problem('The language is not Gujarati, Hindi, Sanskrit or English.');
      return;
    }
    add(language, fields[1] ?? '');
  });
  return { words, problems };
}

/** What the Caption Words dialog shows: the list, and how many of each language's words go to the engine as hints. */
export interface CaptionWordsView {
  words: CaptionWord[];
  hinted: Record<SpeechLanguage, number>;
  /** Each language's switch: its words go to the engine as hints. */
  hintsOn: Record<SpeechLanguage, boolean>;
}

/** A change's answer: the list as it is now, and a sentence for the admin (what an import added, or why not). */
export interface CaptionWordsResult {
  ok: boolean;
  view: CaptionWordsView;
  message: string | null;
}
