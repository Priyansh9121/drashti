import { describe, expect, it } from 'vitest';
import { lyricsText, parseLyrics } from './lyrics';

describe('lyrics as plain text', () => {
  it('reads groups, slides split by blank lines, and repeats', () => {
    const parsed = parseLyrics(
      'Before any header\n\n[Verse 1]\nOne\nTwo\n\nThree\n\n[Chorus]\nRefrain\n[verse 1]\n\n[Nothing]\n',
    );
    expect(parsed.groups).toEqual([
      { name: '', slides: [['Before any header']] },
      { name: 'Verse 1', slides: [['One', 'Two'], ['Three']] },
      { name: 'Chorus', slides: [['Refrain']] },
    ]);
    expect(parsed.order).toEqual([0, 1, 2, 1]);
    expect(parsed.repeats).toBe(true);
    expect(parsed.emptyGroups).toEqual(['Nothing']);
  });

  it('writes what it reads, so words round-trip unchanged', () => {
    const groups = [
      { name: '', slides: [['Opening line']] },
      { name: 'Verse', slides: [['નમૂના પંક્તિ', 'Namūnā pankti'], ['Second']] },
      { name: '', slides: [['A nameless group later on']] },
    ];
    const text = lyricsText(groups);
    expect(text).toBe(
      'Opening line\n\n[Verse]\nનમૂના પંક્તિ\nNamūnā pankti\n\nSecond\n\n[ ]\nA nameless group later on\n',
    );
    expect(parseLyrics(text).groups).toEqual(groups);
  });

  it('stops at the slide limit and says how many were left out', () => {
    const parsed = parseLyrics('a\n\nb\n\nc', 2);
    expect(parsed.groups[0]?.slides).toEqual([['a'], ['b']]);
    expect(parsed.droppedSlides).toBe(1);
  });
});
