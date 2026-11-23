import { describe, expect, it } from 'vitest';
import type { TextElement } from './model';
import { pdfParagraphs } from './pdf-paragraphs';

const line = (id: string, text: string, x = 20, y = 20, width = 180): TextElement => ({
  id,
  kind: 'text',
  text,
  lang: null,
  frame: { x, y, width, height: 14.4 },
  style: {
    fontFamily: 'Noto Sans',
    fontSize: 12,
    fontWeight: 400,
    color: '#000000',
    align: 'left',
    verticalAlign: 'top',
    lineHeight: 1,
    shadow: false,
  },
});
describe('PDF paragraphs', () => {
  it('joins regular lines into a wrapping box with the source leading', () => {
    const result = pdfParagraphs([
      line('a', 'First placeholder line'),
      line('b', 'second placeholder line', 20, 36),
      line('c', 'last words', 20, 52, 70),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'a',
      text: 'First placeholder line second placeholder line last words',
      frame: { x: 20, y: 20, width: 180, height: 46.4 },
      style: { lineHeight: 16 / 12 },
    });
  });
  it('keeps columns, paragraph gaps and different styles separate', () => {
    const bold = line('d', 'Heading', 20, 100);
    bold.style.fontWeight = 700;
    const input = [line('a', 'Left'), line('b', 'Right', 240), line('c', 'New paragraph', 20, 70), bold];
    expect(pdfParagraphs(input)).toEqual(input);
  });
  it('does not join a short final line to the next paragraph', () => {
    const input = [
      line('a', 'First line'),
      line('b', 'End', 20, 36, 40),
      line('c', 'Next paragraph', 20, 52),
    ];
    expect(pdfParagraphs(input).map((el) => el.kind === 'text' && el.text)).toEqual([
      'First line End',
      'Next paragraph',
    ]);
  });
  it('keeps italic runs when joining', () => {
    const a = line('a', 'First line');
    a.runs = [{ text: a.text, italic: true }];
    const b = line('b', 'Last line', 20, 36);
    b.runs = [{ text: b.text, italic: true }];
    expect(pdfParagraphs([a, b])[0]).toMatchObject({
      runs: [{ text: 'First line Last line', italic: true }],
    });
  });
});
