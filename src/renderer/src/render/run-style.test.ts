import { describe, expect, it } from 'vitest';
import type { TextElement } from '../../../shared/model';
import { DEFAULT_THEME } from '../../../shared/themes';
import { practiceSlides } from '../../../shared/practice';
import { sampleKirtanSlide } from '../../../shared/setup';
import { NEW_TEXT_LINE_HEIGHT } from '../../../shared/readable';
import { newTextBox } from '../editor/ops';
import { runStyle } from './SlideView';

/*
 * Gujarati, Hindi and Sanskrit drawn upright with no letter-spacing (Sessions 31–36, I18N-2): what a file
 * stored is kept, and transliteration keeps its italic. New text gets 1.35 between its lines.
 */

const box: TextElement = {
  id: 'b',
  kind: 'text',
  frame: { x: 0, y: 0, width: 800, height: 200 },
  text: '',
  lang: null,
  style: {
    fontFamily: null,
    fontSize: 72,
    fontWeight: 500,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.25,
    shadow: true,
  },
};

describe('a run as it is drawn', () => {
  it('Gujarati, Hindi and Sanskrit stand upright with no letter-spacing, whatever was stored', () => {
    for (const lang of ['gu', 'hi', 'sa', 'sa-gu'] as const) {
      const style = runStyle({ lang, italic: true, letterSpacing: 4 }, box);
      expect(style.fontStyle, lang).toBeUndefined();
      expect(style.letterSpacing, lang).toBeUndefined();
    }
    // Its letters decide: Gujarati letters marked as nothing, or as English, stand upright.
    expect(runStyle({ text: 'નમૂના', italic: true }, box).fontStyle).toBeUndefined();
    expect(runStyle({ text: 'नमूना', lang: 'en', italic: true, letterSpacing: 4 }, box)).toMatchObject({
      fontStyle: undefined,
      letterSpacing: undefined,
    });
    // Words in a legacy Gujarati font (Latin codes) too.
    expect(runStyle({ text: 'nmUnA', legacy: true, italic: true }, box).fontStyle).toBeUndefined();
    // Without letters (the editor's runs), its box's language.
    expect(runStyle({ italic: true }, { ...box, lang: 'gu' }).fontStyle).toBeUndefined();
  });

  it('a transliteration line in a Gujarati box keeps its italic', () => {
    const gujaratiBox = { ...box, lang: 'gu' as const };
    expect(runStyle({ text: 'Namūnānī paṅkti', italic: true, letterSpacing: 2 }, gujaratiBox)).toMatchObject({
      fontStyle: 'italic',
      letterSpacing: 2,
    });
  });

  it('transliteration and English keep their italic and spacing', () => {
    expect(runStyle({ lang: 'translit', italic: true, letterSpacing: 2 }, box)).toMatchObject({
      fontStyle: 'italic',
      letterSpacing: 2,
    });
    expect(runStyle({ lang: 'en', italic: true }, box).fontStyle).toBe('italic');
  });
});

describe('new text', () => {
  it('gets 1.35 between its lines: new boxes, a new library’s default and built-in themes, setup and practice (lyrics: src/main/import/formats/text.test.ts)', () => {
    expect(NEW_TEXT_LINE_HEIGHT).toBe(1.35);
    const look = {
      frame: { x: 0, y: 0, width: 100, height: 100 },
      style: box.style,
      langs: {},
      background: null,
    };
    expect(newTextBox(look).style.lineHeight).toBe(1.35);
    expect(DEFAULT_THEME.box.lineHeight).toBe(1.35);
    const lineHeights = (s: { elements: readonly { kind: string; style?: { lineHeight: number } }[] }) =>
      s.elements.flatMap((e) => (e.kind === 'text' && e.style ? [e.style.lineHeight] : []));
    expect(lineHeights(sampleKirtanSlide())).toEqual([1.35]);
    for (const s of practiceSlides()) expect(lineHeights(s).every((h) => h === 1.35)).toBe(true);
  });
});
