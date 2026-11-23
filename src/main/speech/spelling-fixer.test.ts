import { describe, expect, it } from 'vitest';
import type { CaptionWord } from '../../shared/caption-words';
import type { Heard, SpeechLanguage } from '../../shared/speech';
import { allowedEdits, editDistance, spellingFixer } from './spelling-fixer';
import { heardProblem } from './speech-hub';

/*
 * The spelling fixer after recognition (alpha.22): a word heard close to one of the admin's caption words is spelt
 * as written there, only in the phrase's own language and only as whole words. Invented placeholder words only
 * ("Zentrova", "Velmorin" and the same made-up sounds in Gujarati and Devanagari letters).
 */

const GU = 'ઝેન્ટ્રોવા';
const HI = 'वेल्मोरिन';

function phrase(text: string, language: SpeechLanguage = 'en', final = true): Heard {
  const words = text.split(' ');
  const startAt = 100_000;
  return {
    id: 's1',
    final,
    language,
    languageConfidence: null,
    words: words.map((w, i) => ({
      text: w,
      startAt: startAt + i * 400,
      endAt: startAt + i * 400 + 300,
      confidence: 0.5 + i / 100,
    })),
    text,
    startAt,
    endAt: startAt + (words.length - 1) * 400 + 300,
    heardAt: startAt + 5_000,
  };
}

const LIST: CaptionWord[] = [
  { language: 'en', word: 'Zentrova' },
  { language: 'en', word: 'Person Q7' },
  { language: 'en', word: 'Zeta' },
  { language: 'gu', word: GU },
  { language: 'hi', word: HI },
  { language: 'sa', word: 'વેલ્મોરિન' },
];
const fix = spellingFixer(LIST);
const textOf = (text: string, language: SpeechLanguage = 'en'): string => fix(phrase(text, language)).text;

describe('how far apart two spellings are', () => {
  it('counts letters (code points) added, taken away or changed, and stops counting past the most allowed', () => {
    const cp = (s: string) => [...s];
    expect(editDistance(cp('Zentrova'), cp('Zentrova'), 2)).toBe(0);
    expect(editDistance(cp('Zentrova'), cp('Zentroba'), 2)).toBe(1);
    expect(editDistance(cp('Zentrova'), cp('Zentrva'), 2)).toBe(1);
    expect(editDistance(cp('Zentrova'), cp('Zantrobi'), 2)).toBe(3);
    // A vowel sign or a virama is one letter of its own.
    expect(editDistance(cp(GU), cp('ઝેન્ટરોવા'), 2)).toBe(1);
    expect(editDistance(cp('abcdefgh'), cp('stuvwxyz'), 1)).toBe(2);
  });

  it('allows none for four letters or fewer, one up to eight, two up to thirteen, then three', () => {
    expect([1, 4, 5, 8, 9, 13, 14, 40].map(allowedEdits)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

describe('the spelling fixer', () => {
  it('spells a word heard close to a caption word as written, keeping its times, confidence and punctuation', () => {
    const heard = phrase('alpha Zentroba, beta');
    const fixed = fix(heard);
    expect(fixed.text).toBe('alpha Zentrova, beta');
    expect(fixed.words.map((w) => w.text)).toEqual(['alpha', 'Zentrova,', 'beta']);
    expect(fixed.words[1]).toEqual({ ...heard.words[1], text: 'Zentrova,' });
    expect(fixed).toMatchObject({ id: 's1', final: true, startAt: heard.startAt, endAt: heard.endAt });
    // Still a phrase the hub passes on.
    expect(heardProblem(fixed, { phase: 'listening', language: 'en' }, new Set())).toBeNull();
    expect(textOf('Zentrva beta')).toBe('Zentrova beta');
    // Partials too, so the screens show the right spelling from the first.
    expect(fix(phrase('alpha Zentroba', 'en', false)).text).toBe('alpha Zentrova');
  });

  it('fixes Gujarati, Hindi and Sanskrit by their letters: a vowel sign, a virama, a consonant', () => {
    expect(textOf('આલ્ફા ઝેન્ટરોવા', 'gu')).toBe(`આલ્ફા ${GU}`);
    expect(textOf('ઝેણ્ટ્રોવા', 'gu')).toBe(GU);
    expect(textOf('वेल्मोरीन।', 'hi')).toBe(`${HI}।`);
    // Sanskrit is heard in Devanagari and shown in Gujarati letters: the word keeps the script it was heard in.
    expect(textOf('वेल्मोरीन', 'sa')).toBe('वेल्मोरिन');
    expect(textOf('વેલ્મોરીન', 'sa')).toBe('વેલ્મોરિન');
  });

  it('fixes a name of two or three words as a whole, word for word', () => {
    const fixed = fix(phrase('alpha Persan Q7 beta'));
    expect(fixed.text).toBe('alpha Person Q7 beta');
    expect(fixed.words).toHaveLength(4);
    // Punctuation between its words means they are not the name.
    expect(textOf('Persan, Q7')).toBe('Persan, Q7');
  });

  it('never fixes a word in another language’s list', () => {
    expect(textOf('Zentroba', 'hi')).toBe('Zentroba');
    expect(textOf('ઝેન્ટરોવા', 'hi')).toBe('ઝેન્ટરોવા');
    expect(textOf('વેલ્મોરીન', 'hi')).toBe('વેલ્મોરીન');
    expect(textOf('વેલ્મોરીન', 'gu')).toBe('વેલ્મોરીન');
  });

  it('false replacements: never part of a word, a short word, an ending, two caption words alike, or another word', () => {
    // Part of a longer word, or the word with more letters than one.
    expect(textOf('Prezentrova Zentrovaland')).toBe('Prezentrova Zentrovaland');
    // The word with an ending: kept as heard (Gujarati joins endings to the word).
    expect(textOf('Zentrovas Zentrova’s')).toBe('Zentrovas Zentrova’s');
    expect(textOf(`${GU}ને ${GU}માં`, 'gu')).toBe(`${GU}ને ${GU}માં`);
    // A different ending in place of its last vowel sign is an ending, not a misspelling.
    expect(textOf('ઝેન્ટ્રોવી ઝેન્ટ્રોવ', 'gu')).toBe('ઝેન્ટ્રોવી ઝેન્ટ્રોવ');
    // Four letters or fewer: only the same word.
    expect(textOf('Beta Zeda Zeta')).toBe('Beta Zeda Zeta');
    // Too far from the caption word.
    expect(textOf('Zantrobi Centrino')).toBe('Zantrobi Centrino');
    // A capitalised English caption word (a name) never changes a word heard without a capital.
    expect(textOf('the zentroba zeta')).toBe('the zentroba zeta');
  });

  it('keeps a word as heard when two caption words are as close, and never turns one caption word into another', () => {
    const twins = spellingFixer([
      { language: 'en', word: 'Velmorin' },
      { language: 'en', word: 'Velmoran' },
    ]);
    expect(twins(phrase('Velmoren')).text).toBe('Velmoren');
    expect(twins(phrase('Velmoran Velmorin')).text).toBe('Velmoran Velmorin');
    expect(twins(phrase('Velmorim')).text).toBe('Velmorin');
  });

  it('is off with no caption words for the language: the phrase is passed on as it came', () => {
    const heard = phrase('Zentroba beta', 'hi');
    expect(fix(heard)).toBe(heard);
    const none = spellingFixer([]);
    const en = phrase('Zentroba');
    expect(none(en)).toBe(en);
    // Nothing to fix: the same phrase too.
    const right = phrase('Zentrova beta');
    expect(fix(right)).toBe(right);
  });
});
