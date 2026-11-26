import { describe, expect, it } from 'vitest';
import { redactNames } from './library-redaction';

/*
 * Every name in the library is blanked out of Save Diagnostics' file, Report a Problem's and the notices in the log.
 * A name of five letters or more is blanked wherever it is, inside other words too, as before alpha.24 (the owner's
 * QA24-DIAG-2: "Hide long names inside words"). A shorter name is blanked only where it is a whole word (QA24-DIAG-1: a
 * library name "new" blanked the "new" inside "newest" in the crash files' heading and inside other words of a Quit
 * line). Words are made of letters, marks (the vowel signs and viramas of Gujarati and Devanagari) and digits, in any
 * script; spaces, punctuation and path separators end them. Placeholder names and words only.
 */

const B = '[library name]';

describe('a name of five letters or more is blanked wherever it is (QA24-DIAG-2 A)', () => {
  it('inside other words, in any case', () => {
    expect(redactNames('Sabhas, eveningsabha, SABHAnotes, ASabha, ABCSabha', ['Sabha'])).toBe(
      `${B}s, evening${B}, ${B}notes, A${B}, ABC${B}`,
    );
    expect(redactNames('Sabha 20261 and Sabha 2026a and ASabha 2026', ['Sabha 2026'])).toBe(
      `${B}1 and ${B}a and A${B}`,
    );
    expect(redactNames('x(Draft)y and #1 Placeholders', ['(Draft)', '#1 Placeholder'])).toBe(
      `x${B}y and ${B}s`,
    );
  });

  it('in Gujarati and Devanagari too, letters counted as a reader counts them (vowel signs and viramas are not letters)', () => {
    // "પ્રાર્થના" and "प्रार्थना" have five letters (પ ર ર થ ન): blanked inside a compound that ends in them.
    expect(redactNames('સાંજપ્રાર્થના, પ્રાર્થનાઓ', ['પ્રાર્થના'])).toBe(`સાંજ${B}, ${B}ઓ`);
    expect(redactNames('संध्याप्रार्थना', ['प्रार्थना'])).toBe(`संध्या${B}`);
    // "નમસ્તે" and "नमस्ते" have four (ન મ સ ત; six characters in all): whole words only.
    expect(redactNames('સૌનમસ્તે, નમસ્તે', ['નમસ્તે'])).toBe(`સૌનમસ્તે, ${B}`);
    expect(redactNames('सबनमस्ते, नमस्ते', ['नमस्ते'])).toBe(`सबनमस्ते, ${B}`);
    // "સભા" has two letters: never inside "મહાસભા" (a compound ending in it).
    expect(redactNames('મહાસભા, સભા', ['સભા'])).toBe(`મહાસભા, ${B}`);
  });
});

describe('a name of fewer than five letters is blanked only where it is the name', () => {
  it('a name that is a common word leaves the words it is part of', () => {
    expect(redactNames('== Crash files (kept on this computer, the newest 5) ==', ['new'])).toBe(
      '== Crash files (kept on this computer, the newest 5) ==',
    );
    expect(redactNames('Quit: renewed the window, news later; a new start', ['New'])).toBe(
      `Quit: renewed the window, news later; a ${B} start`,
    );
    expect(redactNames('the newest, renewed, NEWEST', ['new'])).toBe('the newest, renewed, NEWEST');
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

  it('a name with spaces and digits is blanked inside a path, not inside a longer word', () => {
    expect(redactNames('Opened /Users/placeholder/Hy 2026/slides.pro', ['Hy 2026'])).toBe(
      `Opened /Users/placeholder/${B}/slides.pro`,
    );
    expect(redactNames('C:\\Placeholder\\Hy 2026\\a.mp4 and Hy 2026.mp4', ['Hy 2026'])).toBe(
      `C:\\Placeholder\\${B}\\a.mp4 and ${B}.mp4`,
    );
    // A name ending in a digit ends its word before more digits (lead 2: "Hy 2026" is never left readable inside
    // "Hy 20261"), and a letter after its digit starts another word (the review's F1).
    expect(redactNames('Hy 20261 and Hy 2026a and Hy 2026', ['Hy 2026'])).toBe(`${B}1 and ${B}a and ${B}`);
    // Underscores join a file name's words but are not letters: the name between them is blanked.
    expect(redactNames('placeholder_new_deck.mp4', ['new'])).toBe(`placeholder_${B}_deck.mp4`);
  });

  it('a name joined to other letters, digits or escapes is blanked where its word starts or ends there (F1, F2)', () => {
    // A change between letters and digits, and a small letter before a capital, end a word: file and folder names.
    expect(
      redactNames('~/Movies/EveningSaba.mp4, SabaHighlights, Saba2026.mp4, 2026Saba and Saba 20261', [
        'Saba',
      ]),
    ).toBe(`~/Movies/Evening${B}.mp4, ${B}Highlights, ${B}2026.mp4, 2026${B} and ${B} 20261`);
    expect(redactNames('sabaHighlights, eveningSaba', ['saba'])).toBe(`${B}Highlights, evening${B}`);
    // A separator written as an escape just before it: a URL's %20 or %2F, JSON's \n, \t or \r.
    // (A small letter after %2F, %2f, %2A or \n would otherwise carry its word on.)
    expect(redactNames('file:///x/Evening%20Saba.mp4 x%2Fsaba x%2fsaba x%2Asaba', ['Saba'])).toBe(
      `file:///x/Evening%20${B}.mp4 x%2F${B} x%2f${B} x%2A${B}`,
    );
    expect(redactNames('{"detail":"Verse 1\\nSaba\\nsaba\\tsaba\\rsaba"}', ['Saba'])).toBe(
      `{"detail":"Verse 1\\n${B}\\n${B}\\t${B}\\r${B}"}`,
    );
    // Letters of one case and one script are one word.
    expect(redactNames('Anew and news, Sabas', ['new', 'Saba'])).toBe('Anew and news, Sabas');
  });

  it('a run of capitals before a capitalised name starts its word (R1: "ABCSaba" is "ABC" and "Saba")', () => {
    expect(redactNames('ABCNew, ANew, ANEW, Anew, NEWEST', ['new'])).toBe(
      `ABC${B}, A${B}, ANEW, Anew, NEWEST`,
    );
    expect(redactNames('ABCSaba, ASaba, ASABA, Asaba', ['Saba'])).toBe(`ABC${B}, A${B}, ASABA, Asaba`);
  });

  it('a change of script with no space between ends a word', () => {
    expect(redactNames('Sabaસભા', ['Saba'])).toBe(`${B}સભા`);
    expect(redactNames('Sabaસભા', ['સભા'])).toBe(`Saba${B}`);
    expect(redactNames('नमस्तेSaba', ['Saba'])).toBe(`नमस्ते${B}`);
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
    expect(redactNames('Placeholder Sabha 20267', ['Placeholder Sabha', 'Placeholder Sabha 2026'])).toBe(
      `${B}7`,
    );
    // The longer one is not the name here (a letter of its word follows), so the shorter one inside it is.
    expect(redactNames('An Oxen', ['An', 'An Ox'])).toBe(`${B} Oxen`);
    // A digit before its first digit is left as it is: only a name's end is cut short by digits.
    expect(redactNames('12026 Ox', ['2026 Ox'])).toBe('12026 Ox');
    // A name starting or ending in punctuation is blanked where it stands.
    expect(redactNames('x(Pl)y and #1 Ox and #1 Oxen', ['(Pl)', '#1 Ox'])).toBe(
      `x${B}y and ${B} and #1 Oxen`,
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
      `${B} and ${B}0, the newest ${B}`,
    );
    expect(redactNames(`${B} at the library`, names)).toBe(`${B} at the ${B}`);
    const short = Array.from({ length: 1000 }, (_, i) => `Ox ${String(i)}`);
    short.push('new');
    expect(redactNames('Ox 999 and Ox 1000 and Ox 99a, the newest new', short)).toBe(
      `${B} and ${B}0 and ${B}a, the newest ${B}`,
    );
  });
});
