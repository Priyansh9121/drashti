import { describe, expect, it } from 'vitest';
import { CAPTION_CLEAN_PARTS, cleanCaption, cleanWords } from './clean';
import { cleanKey, cleanPhraseKey } from './key';

/*
 * Bad words left out of captions (alpha.24, QA24-CAPCLEAN-1): each word compared by its normalised key, whole words
 * only, against every language's list. Invented placeholder words from this test's own list only, never a real bad
 * word: "zqvorn", "flimbat", "vexmor quill", the made-up sounds "ढ़ुम्पक" (Devanagari) and "ઠંગોપ" (Gujarati), and
 * "dhumpak", a Latin spelling of the first.
 */

const LIST = ['zqvorn', 'flimbat', 'vexmor quill', 'ढ़ुम्पक', 'dhumpak', 'ઠંગોપ'];
const KEYS = new Set(LIST.map(cleanPhraseKey));
const bad = (key: string): boolean => KEYS.has(key);
const clean = (text: string) => cleanCaption(text, bad);

describe('a word’s key', () => {
  it('is the same composed or decomposed, and without a nukta', () => {
    // ढ़ written as one code point, and as ढ with its nukta; both are ढ when compared.
    expect(cleanKey('\u095d')).toBe(cleanKey('\u0922\u093c'));
    expect(cleanKey('\u095d')).toBe(cleanKey('\u0922'));
    expect(cleanKey('ढ़ुम्पक')).toBe(cleanKey('ढुम्पक'));
  });

  it('is the same in Gujarati and Devanagari letters', () => {
    expect(cleanKey('ઢુમ્પક')).toBe(cleanKey('ढुम्पक'));
    expect(cleanKey('ઠંગોપ')).toBe(cleanKey('ठंगोप'));
  });

  it('takes a chandrabindu as an anusvara, and a nasal of the next letter’s class with a virama as one too', () => {
    expect(cleanKey('ठँगोप')).toBe(cleanKey('ठंगोप'));
    expect(cleanKey('ઠઁગોપ')).toBe(cleanKey('ठंगोप'));
    expect(cleanKey('ठङ्गोप')).toBe(cleanKey('ठंगोप'));
    expect(cleanKey('ढुम्पक')).toBe(cleanKey('ढुंपक'));
    // म before त is not of its class: written either way, they are two words.
    expect(cleanKey('ढुम्तक')).not.toBe(cleanKey('ढुंतक'));
  });

  it('leaves out joiners and other hidden signs', () => {
    expect(cleanKey('ढ़ुम्\u200dपक')).toBe(cleanKey('ढ़ुम्पक'));
    expect(cleanKey('ढ़ुम्\u200cपक')).toBe(cleanKey('ढ़ुम्पक'));
    expect(cleanKey('zq\u00advorn')).toBe('zqvorn');
    expect(cleanKey('\u200bzqvorn\ufeff')).toBe('zqvorn');
  });

  it('is lower case without accents for Latin letters, with one kind of apostrophe', () => {
    expect(cleanKey('ZQVORN')).toBe('zqvorn');
    expect(cleanKey('Zqvörn')).toBe('zqvorn');
    expect(cleanKey('Zqvo\u0301rn')).toBe('zqvorn');
    expect(cleanKey('zqvorn’s')).toBe("zqvorn's");
  });

  it('keeps every vowel sign: another ending is another word', () => {
    expect(cleanKey('ढुम्पका')).not.toBe(cleanKey('ढुम्पक'));
    expect(cleanKey('ठंगप')).not.toBe(cleanKey('ठंगोप'));
    expect(cleanKey('ઠંગોપની')).not.toBe(cleanKey('ઠંગોપ'));
  });

  it('of a phrase is its words’ keys with one space between, the marks around each left out', () => {
    expect(cleanPhraseKey('  VEXMOR   Quill ')).toBe('vexmor quill');
    expect(cleanPhraseKey('“Vexmor quill.”')).toBe('vexmor quill');
  });
});

describe('a caption with bad words left out', () => {
  it('leaves a listed word out whole: no asterisks, no dots, one space between the others', () => {
    expect(clean('alpha zqvorn beta')).toEqual({ text: 'alpha beta', left: 1 });
    expect(clean('Alpha ZQVORN, beta')).toEqual({ text: 'Alpha beta', left: 1 });
    expect(clean('alpha “zqvorn” beta')).toEqual({ text: 'alpha beta', left: 1 });
    expect(clean('zqvorn flimbat zqvorn')).toEqual({ text: '', left: 3 });
  });

  it('keeps a sentence’s closing mark on the word before it', () => {
    expect(clean('alpha beta zqvorn.')).toEqual({ text: 'alpha beta.', left: 1 });
    expect(clean('beta zqvorn? gamma')).toEqual({ text: 'beta? gamma', left: 1 });
    expect(clean('नमूना ढ़ुम्पक।')).toEqual({ text: 'नमूना।', left: 1 });
    expect(clean('नमूना ढ़ुम्पक॥')).toEqual({ text: 'नमूना॥', left: 1 });
    // Not twice, and never at the start.
    expect(clean('beta. zqvorn.')).toEqual({ text: 'beta.', left: 1 });
    expect(clean('Zqvorn! alpha')).toEqual({ text: 'alpha', left: 1 });
  });

  it('never cuts a clean word that holds a bad one, in any script', () => {
    for (const text of ['zqvornish prezqvorn flimbats', 'ढ़ुम्पकता अढ़ुम्पक', 'ઠંગોપની અઠંગોપ', 'dhumpaks'])
      expect(clean(text)).toEqual({ text, left: 0 });
  });

  it('leaves out a compound or a possessive whose part is a listed word', () => {
    expect(clean('alpha zqvorn-like beta')).toEqual({ text: 'alpha beta', left: 1 });
    expect(clean('zqvorn’s beta')).toEqual({ text: 'beta', left: 1 });
    expect(clean('gamma flimbat/zqvorn')).toEqual({ text: 'gamma', left: 1 });
  });

  it('leaves out, whole, a word joined to a listed one by a mark with no space after it (review F1)', () => {
    expect(clean('alpha zqvorn,beta gamma')).toEqual({ text: 'alpha gamma', left: 1 });
    expect(clean('alpha beta.zqvorn')).toEqual({ text: 'alpha', left: 1 });
    expect(clean('alpha zqvorn?!beta')).toEqual({ text: 'alpha', left: 1 });
    expect(clean('alpha zqvorn;beta:gamma')).toEqual({ text: 'alpha', left: 1 });
    expect(clean('नमूना ढ़ुम्पक।नमूना')).toEqual({ text: 'नमूना', left: 1 });
    expect(clean('नमूना नमूना॥ढ़ुम्पक')).toEqual({ text: 'नमूना', left: 1 });
    // Clean words joined so are kept as they are.
    expect(clean('alpha,beta e.g. 3.5 नमूना।नमूना')).toEqual({
      text: 'alpha,beta e.g. 3.5 नमूना।नमूना',
      left: 0,
    });
  });

  it('knows a Latin spelling as a word of its own', () => {
    expect(clean('alpha dhumpak beta')).toEqual({ text: 'alpha beta', left: 1 });
    expect(clean('Dhumpak!')).toEqual({ text: '', left: 1 });
  });

  it('checks every word against every language’s list, in either Indian script', () => {
    // Gujarati letters for a word listed in Devanagari (Sanskrit shows in Gujarati letters too), and the other way.
    expect(clean('નમૂનો ઢુમ્પક')).toEqual({ text: 'નમૂનો', left: 1 });
    expect(clean('नमूना ठंगोप')).toEqual({ text: 'नमूना', left: 1 });
    // A spelling variant: no nukta, an anusvara for the nasal, a chandrabindu.
    expect(clean('ढुंपक नमूना')).toEqual({ text: 'नमूना', left: 1 });
    expect(clean('नमूना ठँगोप')).toEqual({ text: 'नमूना', left: 1 });
    expect(clean('नमूना ढ़ुम्\u200dपक')).toEqual({ text: 'नमूना', left: 1 });
  });

  it('leaves out an entry of two words only as those words together', () => {
    expect(clean('alpha vexmor quill beta')).toEqual({ text: 'alpha beta', left: 1 });
    expect(clean('alpha VEXMOR  Quill.')).toEqual({ text: 'alpha.', left: 1 });
    for (const text of ['vexmor beta quill', 'vexmor, quill', 'vexmor', 'quill'])
      expect(clean(text)).toEqual({ text, left: 0 });
    expect(CAPTION_CLEAN_PARTS).toBe(3);
  });

  it('gives the caption back as it came when nothing is left out', () => {
    const text = 'alpha  beta, gamma.';
    const cleaned = clean(text);
    expect(cleaned.left).toBe(0);
    expect(cleaned.text).toBe(text);
    expect(clean('')).toEqual({ text: '', left: 0 });
  });
});

describe('a phrase’s words with bad words left out', () => {
  it('says which words stay, each by its place, with a closing mark moved on', () => {
    expect(cleanWords(['alpha', 'zqvorn.', 'beta'], bad)).toEqual({
      kept: [
        { from: 0, text: 'alpha.' },
        { from: 2, text: 'beta' },
      ],
      left: 1,
    });
    expect(cleanWords(['vexmor', 'quill', 'gamma'], bad)).toEqual({
      kept: [{ from: 2, text: 'gamma' }],
      left: 1,
    });
    expect(cleanWords(['alpha', 'beta'], bad)).toEqual({
      kept: [
        { from: 0, text: 'alpha' },
        { from: 1, text: 'beta' },
      ],
      left: 0,
    });
  });

  it('passes over marks that stand alone', () => {
    expect(cleanWords(['alpha', '।', 'zqvorn', '—'], bad)).toEqual({
      kept: [
        { from: 0, text: 'alpha' },
        { from: 1, text: '।' },
        { from: 3, text: '—' },
      ],
      left: 1,
    });
  });
});
