import { describe, expect, it } from 'vitest';
import type { SlideElement, TextElement, TextStyle } from './model';
import { slideElementSchema } from './model-schema';
import { langOfLine, scriptOf, withDetectedLangs } from './text-runs';
import {
  boxLines,
  langsOf,
  type LineContext,
  setLangLines,
  slideLines,
  trackOrder,
  withLines,
} from './tracks';

/* Placeholder words only: never real kirtan text. */

const style: TextStyle = {
  fontFamily: null,
  fontSize: 80,
  fontWeight: 500,
  color: '#ffffff',
  align: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.25,
  shadow: true,
};

const box = (
  id: string,
  y: number,
  runs: TextElement['runs'],
  lang: TextElement['lang'] = 'gu',
): TextElement => ({
  id,
  kind: 'text',
  frame: { x: 100, y, width: 1720, height: 300 },
  text: (runs ?? []).map((r) => r.text).join(''),
  lang,
  style,
  runs,
});

const plain = (id: string, y: number, text: string, lang: TextElement['lang']): TextElement => ({
  id,
  kind: 'text',
  frame: { x: 100, y, width: 1720, height: 200 },
  text,
  lang,
  style,
});

/** A kirtan box: a Gujarati line, its transliteration, and the meaning. */
const kirtanBox = () =>
  box('k', 200, [
    { text: 'નમૂનો પહેલો\n', lang: 'gu', size: 90, weight: 600 },
    { text: 'Namuno pahelo\n', lang: 'translit', size: 60, italic: true },
    { text: 'Sample first', lang: 'en', size: 50 },
  ]);

const ctx = (over: Partial<LineContext> = {}): LineContext => ({
  order: ['gu', 'translit', 'en'],
  look: { size: 44, color: '#ffcc00' },
  newBox: () => plain('new', 400, '', null),
  ...over,
});

const valid = (els: SlideElement[]) => {
  for (const e of els) expect(slideElementSchema.safeParse(e).success, JSON.stringify(e)).toBe(true);
};

describe('scripts and line languages', () => {
  it('tells the scripts apart', () => {
    expect(scriptOf('ઘર')).toBe('gu');
    expect(scriptOf('घर')).toBe('hi');
    expect(scriptOf('ghar')).toBe('latin');
    expect(scriptOf('12 — !')).toBeNull();
  });

  it('lets the script decide Gujarati and Hindi, and the mark decide Latin', () => {
    expect(langOfLine('en', 'ઘર')).toBe('gu');
    expect(langOfLine('gu', 'ghar')).toBe('en');
    expect(langOfLine('translit', 'ghar')).toBe('translit');
    expect(langOfLine(undefined, 'ghar')).toBe('en');
    expect(langOfLine(undefined, 'ghara āve')).toBe('translit');
    expect(langOfLine('gu', '॥')).toBe('hi');
    expect(langOfLine('gu', '— 12 —')).toBeNull();
  });

  it('cuts a run that goes on into another script at the line break', () => {
    const runs = withDetectedLangs([{ text: 'નમૂનો\nNamūno\nSample', size: 70 }]);
    expect(runs).toEqual([
      { text: 'નમૂનો\n', size: 70, lang: 'gu' },
      { text: 'Namūno\n', size: 70, lang: 'translit' },
      { text: 'Sample', size: 70, lang: 'en' },
    ]);
    // A run in one script stays whole, blank lines and all.
    expect(withDetectedLangs([{ text: 'નમૂનો\n\nબીજો' }])).toEqual([{ text: 'નમૂનો\n\nબીજો', lang: 'gu' }]);
  });
});

describe('a box line by line', () => {
  it('reads each line with its language', () => {
    const lines = boxLines(kirtanBox());
    expect(lines.map((l) => [l.lang, l.runs.map((r) => r.text).join('')])).toEqual([
      ['gu', 'નમૂનો પહેલો'],
      ['translit', 'Namuno pahelo'],
      ['en', 'Sample first'],
    ]);
  });

  it('reads a box without runs by its language', () => {
    expect(boxLines(plain('p', 0, 'Namuno\nSecond', 'translit')).map((l) => l.lang)).toEqual([
      'translit',
      'translit',
    ]);
  });

  it('puts the same lines back exactly', () => {
    const el = kirtanBox();
    expect(withLines(el, boxLines(el))).toEqual(el);
    const p = plain('p', 0, 'Namuno\n\nSecond', 'translit');
    expect(withLines(p, boxLines(p))).toEqual(p);
  });

  it('keeps legacy-font text out of every track', () => {
    const el = box('l', 0, [
      { text: 'nmUnO\n', font: 'Gopika', legacy: true, lang: null },
      { text: 'Sample', lang: 'en' },
    ]);
    const read = slideLines([el]);
    expect(read.lines).toEqual({ en: ['Sample'] });
    expect(read.legacy).toBe(true);
  });
});

describe('a slide by language', () => {
  it('reads every box in reading order', () => {
    const els = [plain('en', 700, 'Meaning line', 'en'), plain('gu', 200, 'ગુજરાતી પંક્તિ', 'gu')];
    expect(slideLines(els)).toEqual({
      lines: { gu: ['ગુજરાતી પંક્તિ'], en: ['Meaning line'] },
      order: ['gu', 'en'],
      legacy: false,
    });
    expect(langsOf(els)).toEqual(['en', 'gu']);
  });

  it('puts the languages of many slides in one order', () => {
    expect(
      trackOrder([
        ['gu', 'en'],
        ['gu', 'translit', 'en'],
        ['hi', 'gu'],
      ]),
    ).toEqual(['hi', 'gu', 'translit', 'en']);
  });
});

describe('changing one language on a slide', () => {
  it('changes only the lines that changed, keeping their look', () => {
    const el = kirtanBox();
    const [out] = setLangLines([el], 'translit', ['Namuno badlelo'], ctx()) as [TextElement];
    expect(out.runs).toEqual([
      { text: 'નમૂનો પહેલો\n', lang: 'gu', size: 90, weight: 600 },
      { text: 'Namuno badlelo\n', lang: 'translit', size: 60, italic: true },
      { text: 'Sample first', lang: 'en', size: 50 },
    ]);
    expect(out.text).toBe('નમૂનો પહેલો\nNamuno badlelo\nSample first');
    valid([out]);
  });

  it('returns the same elements when nothing changed', () => {
    const els = [kirtanBox()];
    const out = setLangLines(els, 'gu', ['નમૂનો પહેલો'], ctx());
    expect(out[0]).toBe(els[0]);
  });

  it('adds lines after the last one in that language', () => {
    const [out] = setLangLines([kirtanBox()], 'gu', ['નમૂનો પહેલો', 'બીજી પંક્તિ'], ctx()) as [TextElement];
    expect(out.text).toBe('નમૂનો પહેલો\nબીજી પંક્તિ\nNamuno pahelo\nSample first');
    expect(out.runs?.[0]).toEqual({ text: 'નમૂનો પહેલો\nબીજી પંક્તિ\n', lang: 'gu', size: 90, weight: 600 });
  });

  it('takes a language off the slide, closing up the rest', () => {
    const [out] = setLangLines([kirtanBox()], 'translit', [], ctx()) as [TextElement];
    expect(out.text).toBe('નમૂનો પહેલો\nSample first');
    expect(slideLines([out]).lines.translit).toBeUndefined();
    const spaced = box('s', 0, [
      { text: 'નમૂનો\n\n', lang: 'gu' },
      { text: 'Namuno\n\n', lang: 'translit' },
      { text: 'Sample', lang: 'en' },
    ]);
    const [closed] = setLangLines([spaced], 'translit', [], ctx()) as [TextElement];
    expect(closed.text).toBe('નમૂનો\n\nSample');
    const [end] = setLangLines([spaced], 'en', [], ctx()) as [TextElement];
    expect(end.text).toBe('નમૂનો\n\nNamuno');
  });

  it('puts a language new to the slide after the languages before it, in the given look', () => {
    const el = box('k', 200, [
      { text: 'નમૂનો\n', lang: 'gu', size: 90 },
      { text: 'Sample', lang: 'en', size: 50 },
    ]);
    const [out] = setLangLines([el], 'translit', ['Namuno'], ctx()) as [TextElement];
    expect(out.runs).toEqual([
      { text: 'નમૂનો\n', lang: 'gu', size: 90 },
      { text: 'Namuno\n', size: 44, color: '#ffcc00', lang: 'translit' },
      { text: 'Sample', lang: 'en', size: 50 },
    ]);
    valid([out]);
  });

  it('fills a box emptied of that language again, where it was', () => {
    const els: SlideElement[] = [plain('gu', 200, 'નમૂનો', 'gu'), plain('en', 700, 'Sample', 'en')];
    const emptied = setLangLines(els, 'en', [], ctx());
    expect(emptied).toHaveLength(2);
    expect(emptied[1]).toMatchObject({ id: 'en', text: '', lang: 'en' });
    const back = setLangLines(emptied, 'en', ['Sample again'], ctx());
    expect(back[0]).toBe(emptied[0]);
    expect(back[1]).toMatchObject({ id: 'en', lang: 'en' });
    expect(slideLines(back).lines.en).toEqual(['Sample again']);
  });

  it('gives a slide without words a new box', () => {
    const picture: SlideElement = {
      id: 'pic',
      kind: 'image',
      frame: { x: 0, y: 0, width: 100, height: 100 },
      mediaId: 'm1',
      fit: 'fit',
    };
    const out = setLangLines([picture], 'gu', ['નમૂનો'], ctx());
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(picture);
    expect(slideLines(out).lines).toEqual({ gu: ['નમૂનો'] });
    valid(out);
  });

  it('never changes text typed in a legacy font', () => {
    const el = box('l', 0, [
      { text: 'nmUnO\n', font: 'Gopika', legacy: true, lang: null },
      { text: 'Sample', lang: 'en' },
    ]);
    const [out] = setLangLines([el], 'en', ['Changed'], ctx()) as [TextElement];
    expect(out.runs?.[0]).toEqual({ text: 'nmUnO\n', font: 'Gopika', legacy: true, lang: null });
    expect(slideLines([out]).lines.en).toEqual(['Changed']);
  });
});
