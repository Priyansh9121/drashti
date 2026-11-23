import { describe, expect, it } from 'vitest';
import type { CaptionWord } from '../../shared/caption-words';
import { createCaptionHints, HINT_PROMPT_BYTES, HINT_WORDS, hintsOf } from './caption-hints';

/*
 * What the captions engine is given to listen for (alpha.22): the first of the admin's caption words for the
 * language it is asked for, as words (an engine biased by a word list) and as one short prompt (whisper.cpp's
 * initial prompt). Capped so it never slows recognition; nothing when the list is empty or the language is "as
 * heard". Invented placeholder words only.
 */

const GU = 'ઝેન્ટ્રોવા';
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('the hints for the language the engine is asked for', () => {
  it('are that language’s caption words in the list’s order, as words and as one prompt', () => {
    const list: CaptionWord[] = [
      { language: 'en', word: 'Zentrova' },
      { language: 'gu', word: GU },
      { language: 'en', word: 'Person Q7' },
    ];
    expect(hintsOf(list, 'en')).toEqual({
      words: ['Zentrova', 'Person Q7'],
      prompt: 'Zentrova, Person Q7',
    });
    expect(hintsOf(list, 'gu')).toEqual({ words: [GU], prompt: GU });
  });

  it('are none when the list has none for it, or when the language is left to the engine (as heard)', () => {
    const list: CaptionWord[] = [{ language: 'gu', word: GU }];
    expect(hintsOf(list, 'hi')).toEqual({ words: [], prompt: '' });
    expect(hintsOf(list, 'auto')).toEqual({ words: [], prompt: '' });
    expect(hintsOf([], 'gu')).toEqual({ words: [], prompt: '' });
  });

  it('give Sanskrit in Devanagari, as the engine writes it (the screens show Gujarati letters)', () => {
    expect(hintsOf([{ language: 'sa', word: 'વેલ્મોરિન' }], 'sa').prompt).toBe('वेल्मोरिन');
  });

  it('keep the prompt within 200 bytes (so at most 200 of whisper’s tokens) and the words within 50', () => {
    expect(HINT_PROMPT_BYTES).toBe(200);
    expect(HINT_WORDS).toBe(50);
    const long: CaptionWord[] = Array.from({ length: 120 }, (_, i) => ({
      language: 'gu',
      word: `${GU}${String(i)}`,
    }));
    const hints = hintsOf(long, 'gu');
    expect(hints.words).toHaveLength(HINT_WORDS);
    expect(bytes(hints.prompt)).toBeLessThanOrEqual(HINT_PROMPT_BYTES);
    // Whole words from the start of the list, up to the first that does not fit.
    const inPrompt = hints.prompt.split(', ');
    expect(inPrompt).toEqual(hints.words.slice(0, inPrompt.length));
    expect(bytes(`${hints.prompt}, ${hints.words[inPrompt.length] ?? ''}`)).toBeGreaterThan(HINT_PROMPT_BYTES);
  });

  it('are read from the list as it is now, and worked out again only when it changes', () => {
    let list: CaptionWord[] = [{ language: 'en', word: 'Zentrova' }];
    let reads = 0;
    const hints = createCaptionHints(() => {
      reads += 1;
      return list;
    });
    const first = hints.for('en');
    expect(first.prompt).toBe('Zentrova');
    expect(hints.for('en')).toBe(first);
    list = [{ language: 'en', word: 'Velmorin' }];
    expect(hints.for('en').prompt).toBe('Velmorin');
    expect(reads).toBe(3);
    expect(hints.hinted()).toEqual({ gu: 0, hi: 0, sa: 0, en: 1 });
  });
});
