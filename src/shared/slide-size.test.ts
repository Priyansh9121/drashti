import { describe, expect, it } from 'vitest';
import type { SlideElement, TextParagraph } from './model';
import { fitElements, scaleParagraphSpacing } from './slide-size';

const paragraph: TextParagraph = {
  align: 'left',
  marginLeft: 48,
  marginRight: 12,
  indent: -24,
  lineHeight: 1.1,
  lineHeightPx: 30,
  spaceBefore: 6,
  spaceAfter: 9,
  bullet: '•',
  bulletSize: 20,
  bulletScale: 1.5,
};

describe('a paragraph on slides of another size (Paste, Presentation size)', () => {
  it('scales its margins, indent and marker size with its words, as it does its spacing', () => {
    expect(scaleParagraphSpacing(paragraph, 1.5)).toEqual({
      ...paragraph,
      marginLeft: 72,
      marginRight: 18,
      indent: -36,
      lineHeightPx: 45,
      spaceBefore: 9,
      spaceAfter: 13.5,
      bulletSize: 30,
    });
  });

  it('keeps each one within what a slide holds', () => {
    expect(scaleParagraphSpacing(paragraph, 1000)).toMatchObject({
      marginLeft: 16_384,
      marginRight: 12_000,
      indent: -16_384,
      lineHeightPx: 16_384,
      bulletSize: 2000,
    });
  });

  it('leaves a paragraph with nothing in slide pixels as it is', () => {
    const plain: TextParagraph = { align: 'center', lineHeight: 1.2, bullet: '•', bulletScale: 0.8 };
    expect(scaleParagraphSpacing(plain, 2)).toBe(plain);
  });

  it('fits an imported deck’s indented list to another presentation size', () => {
    const words: SlideElement = {
      id: 'placeholder-words',
      kind: 'text',
      frame: { x: 100, y: 100, width: 600, height: 200 },
      text: 'Placeholder point',
      lang: null,
      style: {
        fontFamily: null,
        fontSize: 32,
        fontWeight: 400,
        color: '#ffffff',
        align: 'left',
        verticalAlign: 'top',
        lineHeight: 1.2,
        shadow: false,
      },
      runs: [{ text: 'Placeholder point', size: 32, list: 'disc', paragraph }],
    };
    const [fitted] = fitElements([words], { width: 1280, height: 720 }, { width: 1920, height: 1080 });
    expect(fitted?.kind === 'text' && fitted.runs?.[0]?.paragraph).toMatchObject({
      marginLeft: 72,
      marginRight: 18,
      indent: -36,
      lineHeightPx: 45,
      bulletSize: 30,
    });
  });
});
