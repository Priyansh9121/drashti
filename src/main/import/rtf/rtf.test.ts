import { describe, expect, it } from 'vitest';
import { fontFace, readRtf } from './rtf';

/*
 * Every sample here was written for these tests, in the shapes the two
 * presentation formats use (Cocoa-style RTF, and the style Windows .NET
 * writers produce). The text is placeholder text.
 */

/** \uN escapes for a string (what RTF writers do for non-ASCII). */
const u = (text: string) =>
  Array.from(text)
    .flatMap((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code <= 0xffff) return [code];
      const v = code - 0x10000;
      return [0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)];
    })
    .map((c) => `\\u${c > 32767 ? c - 65536 : c} `)
    .join('');

/** \uN? escapes: each UTF-16 unit followed by a one-character fallback (for \uc1). */
const uq = (text: string) =>
  u(text)
    .trim()
    .split(' ')
    .map((e) => `${e}?`)
    .join('');

const COCOA = [
  '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2639',
  '\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica-Bold;\\f1\\fnil\\fcharset0 NotoSansGujarati;}',
  '{\\colortbl;\\red255\\green255\\blue255;\\red255\\green204\\blue0;}',
  '{\\*\\expandedcolortbl;;\\csgenericrgb\\c100000\\c100000\\c100000;\\csgenericrgb\\c100000\\c80000\\c0;}',
  '\\pard\\tx560\\tx1120\\pardirnatural\\qc\\partightenfactor0',
  '',
  `\\f0\\fs160 \\cf2 \\expnd0\\expndtw0\\kerning0 Placeholder caf\\'e9 line\\`,
  `\\f1\\b0\\fs120 \\cf1 \\uc0${u('નમૂનો')}}`,
].join('\n');

describe('readRtf', () => {
  it('reads Cocoa-style RTF: font and colour tables, sizes, escapes, paragraphs', () => {
    const r = readRtf(Buffer.from(COCOA, 'latin1'));
    expect(r.text).toBe('Placeholder café line\nનમૂનો');
    expect(r.runs).toEqual([
      { text: 'Placeholder café line\n', font: 'Helvetica', size: 80, weight: 700, color: '#ffcc00' },
      { text: 'નમૂનો', font: 'NotoSansGujarati', size: 60, weight: 400, color: '#ffffff' },
    ]);
    expect(r.align).toBe('center');
    expect(r.fonts).toEqual(['Helvetica-Bold', 'NotoSansGujarati']);
    expect(r.unsupported).toEqual([]);
  });

  it('reads the Windows .NET style: grouped font entries, a colour table without an automatic entry, \\ltrch groups', () => {
    const rtf =
      '{\\rtf1\\ansi\\ansicpg1252\\uc1\\htmautsp\\deff2{\\fonttbl{\\f0\\fcharset0 Times New Roman;}{\\f2\\fcharset0 Segoe UI;}}' +
      '{\\colortbl\\red0\\green0\\blue0;\\red255\\green255\\blue255;}\\loch\\hich\\dbch\\pard\\plain\\ltrpar\\itap0' +
      '{\\lang1033\\fs96\\f2\\cf1 \\cf1\\qr{\\f2 {\\ltrch First placeholder}\\li0\\ri0\\sa0\\sb0\\fi0\\qr\\par}' +
      `{\\f2 {\\ltrch Second ${uq('नमूना')}}\\li0\\ri0\\sa0\\sb0\\fi0\\qr\\par}}}`;
    const r = readRtf(rtf);
    expect(r.text).toBe('First placeholder\nSecond नमूना');
    expect(r.runs).toEqual([
      { text: 'First placeholder\nSecond नमूना', font: 'Segoe UI', size: 48, weight: 400, color: '#ffffff' },
    ]);
    expect(r.align).toBe('right');
  });

  it('uses the colour table entry 0 when it is a real colour', () => {
    const r = readRtf('{\\rtf1{\\colortbl\\red0\\green0\\blue0;}Black text}');
    expect(r.runs[0]?.color).toBe('#000000');
  });

  it("decodes \\'hh escapes in the font's code page, including double-byte ones", () => {
    expect(readRtf("{\\rtf1\\ansi\\ansicpg1251 \\'cf\\'f0\\'e8}").text).toBe('При');
    const fonts =
      '{\\fonttbl{\\f0\\fcharset0 Arial;}{\\f1\\fcharset204 Arial;}{\\f2\\fcharset128 MS Gothic;}}';
    expect(
      readRtf(`{\\rtf1\\ansi\\ansicpg1252${fonts}\\f1 \\'cf\\'f0\\'e8 \\f0 \\'e9 \\f2 \\'82\\'a0}`).text,
    ).toBe('При é あ');
  });

  it('reads raw 8-bit bytes in the text in the current code page', () => {
    expect(readRtf(Uint8Array.from([...Buffer.from('{\\rtf1\\ansi caf'), 0xe9, 0x7d])).text).toBe('café');
  });

  it('handles \\uN with negative values, surrogate pairs and \\ucN fallbacks', () => {
    expect(readRtf(`{\\rtf1\\uc1${uq('😀')} done}`).text).toBe('😀 done');
    expect(readRtf("{\\rtf1\\uc1\\u2693\\'3f and \\uc2\\u2694 ?? end}").text).toBe('અ and આ end');
    expect(readRtf('{\\rtf1\\uc0\\u2693\\u2694}').text).toBe('અઆ');
  });

  it('follows bold, italic, \\plain and groups, and keeps runs apart only when they differ', () => {
    const r = readRtf('{\\rtf1 plain {\\b bold {\\i both}} \\i italic\\i0  \\b\\plain reset}');
    expect(r.runs.map((x) => [x.text, x.weight, x.italic ?? false])).toEqual([
      ['plain ', 400, false],
      ['bold ', 700, false],
      ['both', 700, true],
      [' ', 400, false],
      ['italic', 400, true],
      [' reset', 400, false],
    ]);
  });

  it('turns \\par and \\line into line breaks, and knows tabs and typographic symbols', () => {
    const r = readRtf(
      '{\\rtf1 a\\line b\\par c\\tab d\\emdash e\\~f\\-g\\_h\\ldblquote i\\rdblquote \\bullet\\par\\par}',
    );
    expect(r.text).toBe('a\nb\nc\td—e fg‑h“i”•');
  });

  it('skips destinations that are not slide text, and hidden text', () => {
    const r = readRtf(
      '{\\rtf1{\\info{\\title Not shown}}{\\*\\generator Writer;}{\\stylesheet{\\s0 Normal;}}{\\*\\unknownthing x}' +
        '{\\listtext\\tab \\uc0\\u8226 \\tab}Shown {\\v hidden}text{\\field{\\*\\fldinst HYPERLINK "x"}{\\fldrslt link}}}',
    );
    expect(r.text).toBe('\t•\tShown textlink');
  });

  it('picks the alignment of most of the text, and says when it is justified', () => {
    const r = readRtf('{\\rtf1\\pard\\qc a\\par\\pard\\qr longer text here\\par\\pard\\qj x\\par}');
    expect(r.align).toBe('right');
    expect(r.unsupported).toEqual(['justified alignment']);
    expect(readRtf('{\\rtf1}').align).toBeNull();
  });

  it('lists formatting it cannot show, but not formatting that is switched off', () => {
    const r = readRtf(
      '{\\rtf1{\\colortbl;\\red1\\green2\\blue3;}\\ul under\\ul0  \\strike0\\charscalex100 plain ' +
        '\\outl\\strokewidth-40 outlined \\cb1 marked \\super up\\nosupersub}',
    );
    expect(r.unsupported).toEqual(['superscript or subscript', 'text background colour', 'underline']);
  });

  it('reads outlines: Cocoa stroke widths are twentieths of a percent of the size', () => {
    const r = readRtf(
      '{\\rtf1{\\colortbl;\\red255\\green255\\blue255;\\red255\\green0\\blue0;}' +
        '\\fs100\\cf1 \\outl0\\strokewidth-40 \\strokec2 red edge ' +
        '\\outl0\\strokewidth0 plain \\outl\\strokec0 own colour \\outl0\\strokewidth80 hollow}',
    );
    expect(r.runs.map((x) => [x.text, x.outline])).toEqual([
      // 2% of 50 points.
      ['red edge ', { color: '#ff0000', width: 1 }],
      ['plain ', undefined],
      // \\outl alone: about 3%, in the text's own colour.
      ['own colour ', { color: '#ffffff', width: 1.5 }],
      ['hollow', { color: '#ffffff', width: 2 }],
    ]);
    expect(r.unsupported).toEqual(['hollow letters']);
  });

  it('reads shadows: twips, Cocoa’s offset upwards, opacity out of 255', () => {
    const r = readRtf(
      '{\\rtf1{\\colortbl;\\red0\\green0\\blue255;}\\fs80 ' +
        '\\shad\\shadx40\\shady-60\\shadr100\\shado128 \\shadc1 blue \\shad0 none}',
    );
    expect(r.runs.map((x) => [x.text, x.shadow])).toEqual([
      ['blue ', { color: '#0000ff80', blur: 5, x: 2, y: 3 }],
      ['none', undefined],
    ]);
    expect(r.unsupported).toEqual([]);
    // No colour: Cocoa's own, black at a third.
    expect(readRtf('{\\rtf1\\shad\\shadx0\\shady-20\\shadr40 cocoa}').runs[0]?.shadow).toEqual({
      color: '#00000055',
      blur: 2,
      x: 0,
      y: 1,
    });
  });

  it('reads letter spacing (twips, or quarter points)', () => {
    const r = readRtf('{\\rtf1\\expnd20\\expndtw100 wide \\expnd-4 tight \\expnd0\\expndtw0 normal}');
    expect(r.runs.map((x) => [x.text, x.letterSpacing])).toEqual([
      ['wide ', 5],
      ['tight ', -1],
      ['normal', undefined],
    ]);
  });

  it('reads fractional sizes and line spacing', () => {
    const r = readRtf('{\\rtf1\\pard\\sl360\\slmult1\\fs120\\fsmilli60500 big\\par}');
    expect(r.runs[0]?.size).toBe(60.5);
    expect(r.lineHeight).toBe(1.5);
  });

  it('never throws on broken RTF', () => {
    for (const bad of [
      '',
      '{',
      '}}}',
      '{\\rtf1 {\\b unclosed',
      "{\\rtf1 \\'zz bad hex}",
      '{\\rtf1 \\bin5 12',
      'plain text',
    ]) {
      expect(() => readRtf(bad)).not.toThrow();
    }
    expect(readRtf('plain text').text).toBe('plain text');
  });
});

describe('fontFace', () => {
  it('splits PostScript names into family, weight and italic', () => {
    expect(fontFace('Helvetica-Bold')).toEqual({ family: 'Helvetica', weight: 700 });
    expect(fontFace('HelveticaNeue-LightItalic')).toEqual({
      family: 'Helvetica Neue',
      weight: 300,
      italic: true,
    });
    expect(fontFace('Arial-BoldMT')).toEqual({ family: 'Arial', weight: 700 });
    expect(fontFace('TimesNewRomanPS-BoldItalicMT')).toEqual({
      family: 'Times New Roman',
      weight: 700,
      italic: true,
    });
    expect(fontFace('AvenirNext-DemiBold')).toEqual({ family: 'Avenir Next', weight: 600 });
    expect(fontFace('Futura-Italic')).toEqual({ family: 'Futura', weight: 400, italic: true });
  });

  it('leaves other names alone, including legacy fonts with hyphens', () => {
    for (const name of [
      'Helvetica',
      'Terafont-Varun',
      'Shree-Guj-0768',
      'KrutiDev010',
      'Segoe UI',
      'Noto Sans-Bold',
    ]) {
      expect(fontFace(name)).toEqual({ family: name });
    }
  });
});
