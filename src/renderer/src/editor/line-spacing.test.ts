import { describe, expect, it } from 'vitest';
import type { Lang, TextElement, TextRun } from '../../../shared/model';
import { crowdedIndicSpacing, shownLineSpacing } from './line-spacing';

/** A box of 40 px words with its own line spacing, and a deck's runs (with their paragraphs) if given. */
function box(lang: Lang | null, lineHeight: number, runs?: TextRun[]): TextElement {
  return {
    id: 'placeholder-spacing',
    kind: 'text',
    frame: { x: 0, y: 0, width: 1600, height: 400 },
    text: runs ? runs.map((r) => r.text).join('') : 'Placeholder words',
    lang,
    ...(runs ? { runs } : {}),
    style: {
      fontFamily: null,
      fontSize: 40,
      fontWeight: 400,
      color: '#ffffff',
      align: 'left',
      verticalAlign: 'top',
      lineHeight,
      shadow: false,
    },
  };
}

const GUJARATI = 'નમૂનાની પંક્તિ\nબીજી નમૂના પંક્તિ';
const HINDI = 'नमूना पंक्ति';

describe('a box’s line spacing, as Words shows it and the inspector warns of it (Session 58, PF-14)', () => {
  it('a box’s own spacing, as before', () => {
    expect(shownLineSpacing(box('gu', 1.2))).toBe(1.2);
    expect(crowdedIndicSpacing(box('gu', 1.2))).toBe(1.2);
    expect(crowdedIndicSpacing(box('gu', 1.35))).toBeNull();
    expect(crowdedIndicSpacing(box('en', 1.2))).toBeNull();
    // A box with no words yet: its own spacing.
    expect(crowdedIndicSpacing({ ...box('gu', 1.1), text: '' })).toBe(1.1);
  });

  it('a deck’s fixed spacing, as drawn: a multiple of its words’ size, whatever the box’s own', () => {
    // 48 px between lines of 40 px words: 1.2, under a box of 1.35.
    const fixed = box('gu', 1.35, [
      { text: GUJARATI, lang: 'gu', paragraph: { align: 'left', lineHeightPx: 48 } },
    ]);
    expect(shownLineSpacing(fixed)).toBe(1.2);
    expect(crowdedIndicSpacing(fixed)).toBe(1.2);
    // 60 px for 40 px words: 1.5, under a box of 1.
    const roomy = box('gu', 1, [
      { text: GUJARATI, lang: 'gu', paragraph: { align: 'left', lineHeightPx: 60 } },
    ]);
    expect(shownLineSpacing(roomy)).toBe(1.5);
    expect(crowdedIndicSpacing(roomy)).toBeNull();
  });

  it('a deck paragraph’s own multiple, and a fixed spacing against its words’ own size', () => {
    const own = box('hi', 1.35, [
      { text: HINDI, lang: 'hi', size: 50, paragraph: { align: 'center', lineHeight: 1.1 } },
    ]);
    expect(shownLineSpacing(own)).toBe(1.1);
    expect(crowdedIndicSpacing(own)).toBe(1.1);
    // A fixed 55 px for 50 px words: 1.1.
    const sized = box('hi', 1.35, [
      { text: HINDI, lang: 'hi', size: 50, paragraph: { align: 'center', lineHeightPx: 55 } },
    ]);
    expect(shownLineSpacing(sized)).toBe(1.1);
    expect(crowdedIndicSpacing(sized)).toBe(1.1);
  });

  it('a deck box as PowerPoint’s own shrink drew it: its line spacing reduction taken off (Session 58, PF-4b)', () => {
    const shrunk = {
      ...box('gu', 1.32, [{ text: GUJARATI, lang: 'gu' }]),
    };
    shrunk.style = { ...shrunk.style, sourceFit: { fontScale: 0.9, lineSpacingReduction: 0.1 } };
    // 1.32 less 0.12 (10% of a single line): 1.2, under 1.3.
    expect(shownLineSpacing(shrunk)).toBe(1.2);
    expect(crowdedIndicSpacing(shrunk)).toBe(1.2);
  });

  it('a box of several languages: Words shows its first line’s, and only its Gujarati and Hindi lines are warned of', () => {
    const english = { text: 'Placeholder English line\n', lang: 'en' as const };
    const roomyGujarati = box('en', 1.35, [
      { ...english, paragraph: { align: 'left', lineHeightPx: 40 } },
      { text: 'નમૂનાની પંક્તિ', lang: 'gu', paragraph: { align: 'left', lineHeightPx: 56 } },
    ]);
    expect(shownLineSpacing(roomyGujarati)).toBe(1);
    expect(crowdedIndicSpacing(roomyGujarati)).toBeNull();
    const tightGujarati = box('en', 1.35, [
      { ...english, paragraph: { align: 'left', lineHeightPx: 56 } },
      { text: 'નમૂનાની પંક્તિ', lang: 'gu', paragraph: { align: 'left', lineHeightPx: 46 } },
    ]);
    expect(shownLineSpacing(tightGujarati)).toBe(1.4);
    expect(crowdedIndicSpacing(tightGujarati)).toBe(1.15);
  });
});
