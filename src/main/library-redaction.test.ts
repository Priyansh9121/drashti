import { describe, expect, it } from 'vitest';
import { redactNames } from './library-redaction';

/*
 * Every name in the library is blanked out of Save Diagnostics' file, Report a Problem's and the notices in the log, but
 * only where it is the name, a whole word or words (QA24-DIAG-1: a library name "new" blanked the "new" inside
 * "newest" in the crash files' heading and inside other words of a Quit line). Words are made of letters, marks (the
 * vowel signs and viramas of Gujarati and Devanagari) and digits, in any script; spaces, punctuation and path
 * separators end them. Placeholder names and words only.
 */

const B = '[library name]';

describe('a library name is blanked only where it is the name', () => {
  it('a name that is a common word leaves the words it is part of', () => {
    expect(redactNames('== Crash files (kept on this computer, the newest 5) ==', ['new'])).toBe(
      '== Crash files (kept on this computer, the newest 5) ==',
    );
    expect(redactNames('Quit: renewed the window, news later; a new start', ['New'])).toBe(
      `Quit: renewed the window, news later; a ${B} start`,
    );
    expect(redactNames('the latest contest, testing the test', ['test'])).toBe(
      `the latest contest, testing the ${B}`,
    );
    expect(redactNames('mainly the domain; the main window', ['Main'])).toBe(
      `mainly the domain; the ${B} window`,
    );
    expect(redactNames('NEW, New and new', ['new'])).toBe(`${B}, ${B} and ${B}`);
  });

  it('a name next to punctuation, quotes, brackets or a line’s ends is blanked', () => {
    expect(redactNames('new', ['new'])).toBe(B);
    expect(redactNames('"new", (new) new. new! new’s new-ish [new]\nnew', ['new'])).toBe(
      `"${B}", (${B}) ${B}. ${B}! ${B}’s ${B}-ish [${B}]\n${B}`,
    );
    expect(redactNames('Opened “Placeholder Deck”: slide 3', ['Placeholder Deck'])).toBe(
      `Opened “${B}”: slide 3`,
    );
  });

  it('a name with spaces and digits is blanked inside a path, not inside a longer number or word', () => {
    expect(redactNames('Opened /Users/placeholder/Sabha 2026/slides.pro', ['Sabha 2026'])).toBe(
      `Opened /Users/placeholder/${B}/slides.pro`,
    );
    expect(redactNames('C:\\Placeholder\\Sabha 2026\\a.mp4 and Sabha 2026.mp4', ['Sabha 2026'])).toBe(
      `C:\\Placeholder\\${B}\\a.mp4 and ${B}.mp4`,
    );
    // Digits after its digits make another number, and a capital before its capital one word ("ASabha"): left. A letter
    // after its digit starts another word (the review's F1, stricter than before: "Sabha 2026a" is blanked).
    expect(redactNames('Sabha 20261 and Sabha 2026a and ASabha 2026', ['Sabha 2026'])).toBe(
      `Sabha 20261 and ${B}a and ASabha 2026`,
    );
    // Underscores join a file name's words but are not letters: the name between them is blanked.
    expect(redactNames('placeholder_new_deck.mp4', ['new'])).toBe(`placeholder_${B}_deck.mp4`);
  });

  it('a name joined to other letters, digits or escapes is blanked where its word starts or ends there (F1, F2)', () => {
    // A change between letters and digits, and a small letter before a capital, end a word: file and folder names.
    expect(
      redactNames('~/Movies/EveningSabha.mp4, SabhaHighlights, Sabha2026.mp4, 2026Sabha and Sabha 20261', [
        'Sabha',
      ]),
    ).toBe(`~/Movies/Evening${B}.mp4, ${B}Highlights, ${B}2026.mp4, 2026${B} and ${B} 20261`);
    expect(redactNames('sabhaHighlights, eveningSabha', ['sabha'])).toBe(`${B}Highlights, evening${B}`);
    // A separator written as an escape just before it: a URL's %20 or %2F, JSON's \n, \t or \r.
    // (A capital after %2F, or a small letter after %2f or \\n, would otherwise carry its word on.)
    expect(redactNames('file:///x/Evening%20Sabha.mp4 x%2FSabha x%2fsabha x%2Asabha', ['Sabha'])).toBe(
      `file:///x/Evening%20${B}.mp4 x%2F${B} x%2f${B} x%2A${B}`,
    );
    expect(redactNames('{"detail":"Verse 1\\nSabha\\nsabha\\tsabha\\rsabha"}', ['Sabha'])).toBe(
      `{"detail":"Verse 1\\n${B}\\n${B}\\t${B}\\r${B}"}`,
    );
    // The owner's case stays: letters of one case and one script are one word.
    expect(redactNames('the newest, renewed, NEWEST', ['new'])).toBe('the newest, renewed, NEWEST');
    expect(redactNames('ASabha and Sabhas', ['Sabha'])).toBe('ASabha and Sabhas');
  });

  it('a change of script with no space between ends a word', () => {
    expect(redactNames('Sabhaસભા', ['Sabha'])).toBe(`${B}સભા`);
    expect(redactNames('Sabhaસભા', ['સભા'])).toBe(`Sabha${B}`);
    expect(redactNames('नमस्तेSabha', ['Sabha'])).toBe(`नमस्ते${B}`);
  });

  it('in Gujarati, Devanagari, Tamil, Korean and the like a name is blanked where a word starts, whatever ending follows (D1 A)', () => {
    // Their endings are written joined to the word ("સભા" + "માં"), so only the word's start is looked at.
    expect(redactNames('સભામાં, સભાનો; સભા૨૦૨૬, ૨૦૨૬સભા; મહાસભા', ['સભા'])).toBe(
      `${B}માં, ${B}નો; ${B}૨૦૨૬, ૨૦૨૬${B}; મહાસભા`,
    );
    expect(redactNames('सभाओं में, सभा। महासभा', ['सभा'])).toBe(`${B}ओं में, ${B}। महासभा`);
    expect(redactNames('சபையில் வந்தனர்', ['சபை'])).toBe(`${B}யில் வந்தனர்`);
    expect(redactNames('안녕하세요, 안녕', ['안녕'])).toBe(`${B}하세요, ${B}`);
    // Vowel signs and viramas belong to their word: a name is never blanked inside one.
    expect(redactNames('નવી અને નવ.', ['વી'])).toBe('નવી અને નવ.');
    expect(redactNames('नया नय', ['या'])).toBe('नया नय');
    // The cost, accepted by lead 2: another word that starts with the name is blanked there ("નવી" in "નવીન").
    expect(redactNames('નવીન રીતે, નવી સભા', ['નવી'])).toBe(`${B}ન રીતે, ${B} સભા`);
    // A name joined to the next letter by a zero-width joiner is blanked at its word's start too.
    expect(redactNames('नय\u200Cा and नय\u200D', ['नय'])).toBe(`${B}\u200Cा and ${B}\u200D`);
  });

  it('in scripts written without spaces a name is blanked wherever it is', () => {
    expect(redactNames('プレースホルダーです', ['プレースホルダー'])).toBe(`${B}です`);
    expect(redactNames('占位文本在这里', ['占位文本'])).toBe(`${B}在这里`);
  });

  it('a longer name is blanked wherever it is the name, before any shorter one inside it', () => {
    expect(
      redactNames('Placeholder Sabha 2026 and Placeholder Sabha', [
        'Placeholder Sabha',
        'Placeholder Sabha 2026',
      ]),
    ).toBe(`${B} and ${B}`);
    // The longer one is not the name here (a digit follows), so the shorter one inside it is.
    expect(redactNames('Placeholder Sabha 20267', ['Placeholder Sabha', 'Placeholder Sabha 2026'])).toBe(
      `${B} 20267`,
    );
    // A name starting or ending in punctuation is blanked where it stands.
    expect(redactNames('x(Draft)y and #1 Placeholders', ['(Draft)', '#1 Placeholder'])).toBe(
      `x${B}y and #1 Placeholders`,
    );
  });

  it('never blanks the words of a blank already there, nor anything for an empty name', () => {
    // A notice in the log was blanked before diagnostics read it; a library name "library" or "name" leaves it.
    expect(redactNames(`Notice: ${B} could not be opened, library name`, ['library', 'name'])).toBe(
      `Notice: ${B} could not be opened, ${B} ${B}`,
    );
    expect(redactNames('Placeholder text', [''])).toBe('Placeholder text');
    expect(redactNames('Placeholder text', [])).toBe('Placeholder text');
  });

  it('holds for any number of names (they are matched 400 at a time)', () => {
    const names = Array.from({ length: 1000 }, (_, i) => `Placeholder Deck ${String(i)}`);
    names.push('new', 'library');
    expect(redactNames('Placeholder Deck 999 and Placeholder Deck 1000, the newest new', names)).toBe(
      `${B} and Placeholder Deck 1000, the newest ${B}`,
    );
    expect(redactNames(`${B} at the library`, names)).toBe(`${B} at the ${B}`);
  });
});
