import { describe, expect, it } from 'vitest';
import { mediaMatching } from './network-mirror';

/* Media found on a phone by the words of their names (Session 54, D5). Placeholder names. */

const MEDIA = [
  { id: 'a', name: 'Placeholder backdrop.png' },
  { id: 'b', name: 'Placeholder evening clip.webm' },
  // "નમૂના ચિત્ર" written in decomposed form, as some phones and file systems keep it.
  { id: 'c', name: 'નમૂના ચિત્ર.jpg'.normalize('NFD') },
];

describe('media found by the words of their names', () => {
  it('keeps every one for no words, and those holding every word, in any order and letter case', () => {
    expect(mediaMatching(MEDIA, '').map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(mediaMatching(MEDIA, '   ').map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(mediaMatching(MEDIA, 'CLIP evening').map((m) => m.id)).toEqual(['b']);
    expect(mediaMatching(MEDIA, 'placeholder').map((m) => m.id)).toEqual(['a', 'b']);
    expect(mediaMatching(MEDIA, 'placeholder morning')).toEqual([]);
  });

  it('finds a name whatever its Unicode form', () => {
    expect(mediaMatching(MEDIA, 'ચિત્ર'.normalize('NFC')).map((m) => m.id)).toEqual(['c']);
  });
});
