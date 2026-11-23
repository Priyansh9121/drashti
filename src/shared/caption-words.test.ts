import { describe, expect, it } from 'vitest';
import {
  addCaptionWords,
  CAPTION_WORDS_PER_LANGUAGE,
  captionWordKey,
  captionWordsCsv,
  checkCaptionWord,
  parseCaptionWords,
  readCaptionWordsCsv,
  type CaptionWord,
} from './caption-words';

/*
 * Caption words (alpha.22): the admin's list of names and terms, spelt as the captions should show them, per
 * language. Invented placeholder words only ("Zentrova", "Velmorin", and the same made-up sounds in Gujarati and
 * Devanagari letters): never a real name, kirtan or scripture.
 */

const GU = 'ઝેન્ટ્રોવા';
const HI = 'वेल्मोरिन';

describe('a caption word as the admin types it', () => {
  it('keeps letters as typed (NFC), one space between parts, and nothing around them', () => {
    expect(checkCaptionWord('  Person   Q7 ')).toEqual({ ok: true, word: 'Person Q7' });
    expect(checkCaptionWord(GU)).toEqual({ ok: true, word: GU });
    // Decomposed letters are kept composed.
    expect(checkCaptionWord('Café Zeta')).toEqual({ ok: true, word: 'Café Zeta' });
    // Gujarati's and Hindi's joiners stay as typed.
    expect(checkCaptionWord('क्‍ष')).toEqual({ ok: true, word: 'क्‍ष' });
  });

  it('refuses what the captions or the list’s file cannot hold, saying why', () => {
    expect(checkCaptionWord('   ')).toEqual({ ok: false, message: 'Type a word or a name.' });
    expect(checkCaptionWord('Zentrova, Velmorin').ok).toBe(false);
    expect(checkCaptionWord('Title "Zeta"').ok).toBe(false);
    expect(checkCaptionWord('Alpha Beta Gamma Delta')).toEqual({
      ok: false,
      message: 'At most three words in one entry.',
    });
    expect(checkCaptionWord('Z'.repeat(41))).toEqual({ ok: false, message: 'At most 40 letters.' });
    expect(checkCaptionWord('-Zentrova').ok).toBe(false);
    expect(checkCaptionWord('Zentrova.').ok).toBe(false);
    // A Gujarati word may end with its vowel sign.
    expect(checkCaptionWord('ઝેન્ટ્રોવા').ok).toBe(true);
    expect(checkCaptionWord('Title Zeta-42').ok).toBe(true);
  });
});

describe('the same word, as Drashti compares them', () => {
  it('ignores case, the joiners and the script of Sanskrit (Gujarati or Devanagari letters)', () => {
    expect(captionWordKey('ZENTROVA', 'en')).toBe(captionWordKey('zentrova', 'en'));
    expect(captionWordKey('क्‍ष', 'hi')).toBe(captionWordKey('क्ष', 'hi'));
    expect(captionWordKey('वेल्मोरिन', 'sa')).toBe(captionWordKey('વેલ્મોરિન', 'sa'));
    // Hindi and Gujarati are their own languages: their letters stay their own.
    expect(captionWordKey('वेल्मोरिन', 'hi')).not.toBe(captionWordKey('વેલ્મોરિન', 'hi'));
  });
});

describe('the list as kept and sent', () => {
  it('keeps each language’s words in order, each checked, without repeats, at most 200 a language', () => {
    const many = Array.from({ length: CAPTION_WORDS_PER_LANGUAGE + 5 }, (_, i) => ({
      language: 'en',
      word: `Zentrova${String(i)}`,
    }));
    const words = parseCaptionWords([
      { language: 'gu', word: GU },
      { language: 'gu', word: ` ${GU} ` },
      { language: 'hi', word: HI },
      { language: 'fr', word: 'Zentrova' },
      { language: 'en', word: '' },
      'Zentrova',
      ...many,
    ]);
    expect(words.filter((w) => w.language === 'gu')).toEqual([{ language: 'gu', word: GU }]);
    expect(words.filter((w) => w.language === 'hi')).toEqual([{ language: 'hi', word: HI }]);
    const en = words.filter((w) => w.language === 'en');
    expect(en).toHaveLength(CAPTION_WORDS_PER_LANGUAGE);
    expect(en[0]?.word).toBe('Zentrova0');
    expect(parseCaptionWords(null)).toEqual([]);
    expect(parseCaptionWords({ words: [] })).toEqual([]);
  });

  it('adds words to the end of their language’s list, counting what was there already or would not fit', () => {
    const list: CaptionWord[] = [{ language: 'en', word: 'Zentrova' }];
    const full = Array.from({ length: CAPTION_WORDS_PER_LANGUAGE }, (_, i) => ({
      language: 'hi' as const,
      word: `${HI}${String(i)}`,
    }));
    const result = addCaptionWords(
      [...list, ...full],
      [
        { language: 'en', word: 'zentrova' },
        { language: 'en', word: 'Velmorin' },
        { language: 'gu', word: GU },
        { language: 'hi', word: HI },
      ],
    );
    expect(result).toMatchObject({ added: 2, already: 1, full: 1 });
    expect(result.words.filter((w) => w.language === 'en').map((w) => w.word)).toEqual([
      'Zentrova',
      'Velmorin',
    ]);
  });
});

describe('the list’s file (CSV)', () => {
  it('is UTF-8 with a mark Excel reads, a heading, and each language named', () => {
    const csv = captionWordsCsv([
      { language: 'gu', word: GU },
      { language: 'en', word: 'Person Q7' },
    ]);
    expect(csv).toBe(`﻿Language,Word\r\nGujarati,${GU}\r\nEnglish,Person Q7\r\n`);
  });

  it('reads back what it wrote', () => {
    const words: CaptionWord[] = [
      { language: 'gu', word: GU },
      { language: 'hi', word: HI },
      { language: 'sa', word: 'વેલ્મોરિન' },
      { language: 'en', word: 'Title Zeta-42' },
    ];
    expect(readCaptionWordsCsv(captionWordsCsv(words))).toEqual({ words, problems: [] });
  });

  it('takes codes or names, quotes a spreadsheet added, blank lines and notes; names each line it could not read', () => {
    const read = readCaptionWordsCsv(
      [
        'language , word',
        '',
        '# placeholder words',
        'gu,' + GU,
        '"Hindi","' + HI + '"',
        'ENGLISH, Zentrova ',
        'French,Zentrova',
        'English',
        'English,Zentrova,Velmorin',
        'English,Alpha Beta Gamma Delta',
      ].join('\n'),
    );
    expect(read.words).toEqual([
      { language: 'gu', word: GU },
      { language: 'hi', word: HI },
      { language: 'en', word: 'Zentrova' },
    ]);
    expect(read.problems).toEqual([
      { line: 7, message: 'The language is not Gujarati, Hindi, Sanskrit or English.' },
      { line: 8, message: 'A language, a comma, then the word.' },
      { line: 9, message: 'A language, a comma, then the word.' },
      { line: 10, message: 'At most three words in one entry.' },
    ]);
  });
});
