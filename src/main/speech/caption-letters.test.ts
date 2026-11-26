import { describe, expect, it } from 'vitest';
import type { HeardWord } from '../../shared/speech';
import { keepToLetters } from './caption-letters';

/*
 * A chosen language's captions keep to its letters (QA24-CAPLANG-1). Placeholder words only; the Gujarati ones are
 * the committed test speech's sentences (tests/fixtures/captions/gu) and whisper's recorded replies to them.
 */

const words = (...texts: string[]): HeardWord[] =>
  texts.map((text, i) => ({
    text,
    startAt: 1_000 + i * 100,
    endAt: 1_050 + i * 100,
    confidence: 0.5 + i / 10,
  }));
const texts = (heard: readonly HeardWord[] | null): string[] | null => heard?.map((w) => w.text) ?? null;

describe('keepToLetters', () => {
  it('Gujarati: Devanagari letters come in Gujarati letters, letter for letter, each word keeping its times and confidence', () => {
    const heard = words('પाणीनी', 'बोटल');
    const kept = keepToLetters(heard, 'gu');
    expect(texts(kept)).toEqual(['પાણીની', 'બોટલ']);
    expect(kept?.map(({ startAt, endAt, confidence }) => [startAt, endAt, confidence])).toEqual(
      heard.map(({ startAt, endAt, confidence }) => [startAt, endAt, confidence]),
    );
  });

  it('Gujarati: a word with Latin letters is left out, the Gujarati words and the number stay', () => {
    expect(texts(keepToLetters(words('કાઉન્ટર', 'No.', '7', 'ખુલ્લું'), 'gu'))).toEqual([
      'કાઉન્ટર',
      '7',
      'ખુલ્લું',
    ]);
  });

  it('Gujarati: a piece written in Latin letters is not shown at all, nor the number left from it', () => {
    expect(keepToLetters(words('Lily', 'Toppli', 'ma', 'Charles'), 'gu')).toBeNull();
    expect(keepToLetters(words('Counter', 'No.', '738'), 'gu')).toBeNull();
  });

  it('a piece with nothing to change is passed on as it came (the same words), a number alone too', () => {
    const gujarati = words('લીલી', 'ટોપલીમાં', '૪');
    expect(keepToLetters(gujarati, 'gu')).toBe(gujarati);
    const number = words('738');
    expect(keepToLetters(number, 'gu')).toBe(number);
    const none: HeardWord[] = [];
    expect(keepToLetters(none, 'gu')).toBe(none);
  });

  it('Hindi and Sanskrit: Gujarati letters come in Devanagari (the screens show Sanskrit in Gujarati letters)', () => {
    expect(texts(keepToLetters(words('પાણી', 'की', 'बोतल।'), 'hi'))).toEqual(['पाणी', 'की', 'बोतल।']);
    expect(texts(keepToLetters(words('ધર્મ', 'क्षेत्रे'), 'sa'))).toEqual(['धर्म', 'क्षेत्रे']);
  });

  it('Hindi: words in Latin or Arabic letters are left out; a piece of them alone is not shown', () => {
    expect(texts(keepToLetters(words('पानी', 'bottle', 'کتاب', 'है'), 'hi'))).toEqual(['पानी', 'है']);
    expect(keepToLetters(words('water', 'bottle'), 'hi')).toBeNull();
  });

  it('English: words in Gujarati or Devanagari letters are left out; accents, digits and a clock stay', () => {
    expect(texts(keepToLetters(words('Café', 'પાણી', 'at', '4:45', 'पानी'), 'en'))).toEqual([
      'Café',
      'at',
      '4:45',
    ]);
    expect(keepToLetters(words('પાણી', 'पानी'), 'en')).toBeNull();
  });

  it('joiners, dandas and Devanagari letters with a nukta (as NFC writes them) are part of the language', () => {
    const joined = '\u0915\u094d\u200d\u0937';
    const nukta = '\u091c\u093c\u0930\u093e';
    expect(texts(keepToLetters(words(joined, nukta, '\u0965'), 'hi'))).toEqual([joined, nukta, '\u0965']);
    expect(texts(keepToLetters(words(nukta), 'gu'))).toEqual(['\u0a9c\u0abc\u0ab0\u0abe']);
  });
});
