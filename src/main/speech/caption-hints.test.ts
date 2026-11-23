import { describe, expect, it } from 'vitest';
import { CAPTION_HINTS_ON, type CaptionWord } from '../../shared/caption-words';
import { createCaptionHints, HINT_PROMPT_TOKENS, HINT_WORDS, hintsOf, promptTokens } from './caption-hints';

/*
 * What the captions engine is given to listen for (alpha.22): the first of the admin's caption words for the
 * language it is asked for, as words (an engine biased by a word list) and as one short prompt (whisper.cpp's
 * initial prompt). Capped by whisper's tokens so it never slows recognition and whisper.cpp never cuts it; nothing
 * when the list is empty or the language is "as heard". Invented placeholder words only.
 */

const GU = 'ઝેન્ટ્રોવા';
const HI = 'वेल्मोरिन';
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('the hints for the language the engine is asked for', () => {
  it('are that language’s caption words in the list’s order, and one prompt with the most important last', () => {
    const list: CaptionWord[] = [
      { language: 'en', word: 'Zentrova' },
      { language: 'gu', word: GU },
      { language: 'en', word: 'Person Q7' },
    ];
    // whisper.cpp keeps a prompt's last tokens: the first caption word goes last, where it is never cut.
    expect(hintsOf(list, 'en')).toEqual({
      words: ['Zentrova', 'Person Q7'],
      prompt: 'Person Q7, Zentrova',
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

  it('count whisper’s tokens at least as cap-drive-learn measured them: Gujarati a byte each, Hindi and English fewer', () => {
    // A Gujarati letter is three bytes and about three tokens; a Devanagari one fewer; English about two letters a
    // token; a comma one; the space before a word goes with it.
    expect(promptTokens(GU)).toBe(30);
    expect(promptTokens(HI)).toBe(14);
    expect(promptTokens('Zentrova')).toBe(4);
    expect(promptTokens('Zentrova, Person Q7')).toBe(9);
    // Measured on whisper's own tokenizer (N/reports/cap-drive-learn.md, 23 Nov): 200 bytes of Gujarati words were
    // 173 tokens, of Hindi 84, of English 88. The count here is never below those rates.
    const words = (word: string, n: number) => Array.from({ length: n }, (_, i) => `${word}${String(i)}`);
    for (const [prompt, measured] of [
      [words(GU, 6).join(', '), 173 / 200],
      [words(HI, 7).join(', '), 84 / 200],
      [words('Zentrova', 20).join(', '), 88 / 200],
    ] as const)
      expect(promptTokens(prompt) / bytes(prompt)).toBeGreaterThanOrEqual(measured);
  });

  it('keep the prompt within 220 tokens (whisper.cpp keeps at most 224) and the words within 50', () => {
    expect(HINT_PROMPT_TOKENS).toBe(220);
    expect(HINT_WORDS).toBe(50);
    for (const [word, language] of [
      [GU, 'gu'],
      [HI, 'hi'],
      ['Zentrova', 'en'],
    ] as const) {
      const long: CaptionWord[] = Array.from({ length: 120 }, (_, i) => ({
        language,
        word: `${word}${String(i)}`,
      }));
      const hints = hintsOf(long, language);
      expect(hints.words).toHaveLength(HINT_WORDS);
      expect(promptTokens(hints.prompt)).toBeLessThanOrEqual(HINT_PROMPT_TOKENS);
      // Whole words from the start of the list, up to the first that does not fit, the first one last.
      const inPrompt = hints.prompt.split(', ').reverse();
      expect(inPrompt).toEqual(hints.words.slice(0, inPrompt.length));
      expect(promptTokens(`${hints.words[inPrompt.length] ?? ''}, ${hints.prompt}`)).toBeGreaterThan(
        HINT_PROMPT_TOKENS,
      );
    }
    // Hindi and English carry far more words than 200 bytes would have (7 Gujarati words fit either way).
    expect(
      hintsOf(
        Array.from({ length: 60 }, (_, i) => ({ language: 'en', word: `Zentrova${String(i)}` })),
        'en',
      ).prompt.split(', ').length,
    ).toBeGreaterThan(30);
  });

  it('are off for Gujarati until the admin turns them on (a prompt did not help Gujarati on real speech), on for the others', () => {
    expect(CAPTION_HINTS_ON).toEqual({ gu: false, hi: true, sa: true, en: true });
    const list: CaptionWord[] = [
      { language: 'gu', word: GU },
      { language: 'hi', word: HI },
    ];
    let on = { ...CAPTION_HINTS_ON };
    const hints = createCaptionHints(
      () => list,
      () => on,
    );
    expect(hints.for('gu')).toEqual({ words: [], prompt: '' });
    expect(hints.for('hi').prompt).toBe(HI);
    expect(hints.hinted()).toEqual({ gu: 0, hi: 1, sa: 0, en: 0 });
    on = { ...on, gu: true, hi: false };
    expect(hints.for('gu').prompt).toBe(GU);
    expect(hints.for('hi')).toEqual({ words: [], prompt: '' });
    // Without a switch given, the defaults.
    expect(createCaptionHints(() => list).for('gu').prompt).toBe('');
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
