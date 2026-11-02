import { describe, expect, it } from 'vitest';
import type { TextElement } from '../../../shared/model';
import { DEFAULT_THEME } from '../../../shared/themes';
import { practiceSlides } from '../../../shared/practice';
import { sampleKirtanSlide } from '../../../shared/setup';
import { NEW_TEXT_LINE_HEIGHT } from '../../../shared/readable';
import { newTextBox } from '../editor/ops';
import { listMarkerStyle, runStyle, TEXT_SHADOW, textBoxStyle } from './SlideView';

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

describe('the Words group’s looks, as every screen draws them (Session 55, Part 17a)', () => {
  it('underlines and strikes through a run, both at once too', () => {
    expect(runStyle({ underline: true }, box).textDecorationLine).toBe('underline');
    expect(runStyle({ strike: true }, box).textDecorationLine).toBe('line-through');
    expect(runStyle({ underline: true, strike: true }, box).textDecorationLine).toBe(
      'underline line-through',
    );
    // Gujarati and Hindi too: a line under or through them never changes how their letters join.
    expect(runStyle({ lang: 'gu', underline: true }, box).textDecorationLine).toBe('underline');
    expect(runStyle({}, box).textDecorationLine).toBeUndefined();
  });

  it('a box’s glow goes with its shadow, the glow first; without one, the box draws as it always did', () => {
    expect(textBoxStyle(box).textShadow).toBe(TEXT_SHADOW);
    const glowing = { ...box, style: { ...box.style, glow: { color: '#00ffcc', size: 20 } } };
    expect(textBoxStyle(glowing).textShadow).toBe(`0 0 20px #00ffcc, ${TEXT_SHADOW}`);
    const noShadow = { ...glowing, style: { ...glowing.style, shadow: false } };
    expect(textBoxStyle(noShadow).textShadow).toBe('0 0 20px #00ffcc');
    expect(textBoxStyle({ ...box, style: { ...box.style, shadow: false } }).textShadow).toBeUndefined();
  });

  it('a run’s own shadow keeps its box’s glow, and its own glow keeps its box’s shadow', () => {
    const glowing = { ...box, style: { ...box.style, glow: { color: '#00ffcc', size: 20 } } };
    const own = { color: '#000000', blur: 4, x: 2, y: 2 };
    expect(runStyle({ shadow: own }, glowing).textShadow).toBe('0 0 20px #00ffcc, 2px 2px 4px #000000');
    expect(runStyle({ glow: { color: '#ff0000', size: 8 } }, box).textShadow).toBe(
      `0 0 8px #ff0000, ${TEXT_SHADOW}`,
    );
    // A run with no glow of its own in a glowing box: none.
    expect(runStyle({ glow: null }, glowing).textShadow).toBe(TEXT_SHADOW);
    // Nothing of its own: the box's, by inheritance.
    expect(runStyle({}, glowing).textShadow).toBeUndefined();
    // As before for a box without a glow.
    expect(runStyle({ shadow: own }, box).textShadow).toBe('2px 2px 4px #000000');
    expect(runStyle({ shadow: false }, box).textShadow).toBe('none');
  });

  it('a list’s marks: a bullet is a shape, a number its words, in the line’s colour', () => {
    expect(listMarkerStyle('disc', { color: '#ffcc00' })).toMatchObject({
      borderRadius: '50%',
      background: '#ffcc00',
    });
    expect(listMarkerStyle('circle', {})).toMatchObject({ borderRadius: '50%', background: 'transparent' });
    expect(listMarkerStyle('square', {})).toMatchObject({ background: 'currentColor' });
    expect(listMarkerStyle('1', { color: '#ffcc00' })).toMatchObject({
      color: '#ffcc00',
      textAlign: 'right',
    });
  });
});
