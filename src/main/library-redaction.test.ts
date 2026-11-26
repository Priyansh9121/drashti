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
    expect(redactNames('Sabha 20261 and Sabha 2026a and ASabha 2026', ['Sabha 2026'])).toBe(
      'Sabha 20261 and Sabha 2026a and ASabha 2026',
    );
    // Underscores join a file name's words but are not letters: the name between them is blanked.
    expect(redactNames('placeholder_new_deck.mp4', ['new'])).toBe(`placeholder_${B}_deck.mp4`);
  });

  it('a Gujarati or Devanagari name leaves the words it is part of, vowel signs included', () => {
    // "નવી" inside "નવીન"; "નવ" before the vowel sign of "નવી"; "નયા"-like Devanagari likewise.
    expect(redactNames('નવીન રીતે, નવી સભા', ['નવી'])).toBe(`નવીન રીતે, ${B} સભા`);
    expect(redactNames('નવી અને નવ.', ['નવ'])).toBe(`નવી અને ${B}.`);
    expect(redactNames('नयापन, नया (नया)', ['नया'])).toBe(`नयापन, ${B} (${B})`);
    expect(redactNames('नया नय', ['नय'])).toBe(`नया ${B}`);
    // A name joined to the next letter by a zero-width non-joiner is inside that word.
    expect(redactNames('नय\u200Cा and नय', ['नय'])).toBe(`नय\u200Cा and ${B}`);
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
