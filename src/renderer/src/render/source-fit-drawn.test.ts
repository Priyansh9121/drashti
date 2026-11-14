import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TextElement, TextRun } from '../../../shared/model';
import { ElementView } from './SlideView';

/*
 * A deck's box drawn with its line spacing as PowerPoint's own shrink left it (Session 58, PF-4b): its line
 * spacing reduction taken off the box's spacing and off each paragraph's own share of a line; a spacing fixed in
 * points, and every box without PowerPoint's numbers, as before.
 */

const SHRUNK = { fontScale: 0.85, lineSpacingReduction: 0.1 };

function box(runs: TextRun[] | undefined, sourceFit?: typeof SHRUNK): TextElement {
  return {
    id: 'placeholder-shrunk',
    kind: 'text',
    frame: { x: 0, y: 0, width: 800, height: 300 },
    text: runs ? runs.map((r) => r.text).join('') : 'Placeholder words',
    lang: 'en',
    ...(runs ? { runs } : {}),
    style: {
      fontFamily: null,
      fontSize: 40,
      fontWeight: 400,
      color: '#ffffff',
      align: 'left',
      verticalAlign: 'top',
      lineHeight: 1.2,
      shadow: false,
      shrinkToFit: true,
      ...(sourceFit ? { sourceFit } : {}),
    },
  };
}

const drawn = (el: TextElement) => renderToStaticMarkup(createElement(ElementView, { el, media: 'still' }));
/** The box's own line spacing, and each line's, as drawn. */
const boxLine = (html: string) =>
  /data-element="placeholder-shrunk"[^>]*?line-height:([^;"]+)/u.exec(html)?.[1];
const lineSpacings = (html: string) =>
  [...html.matchAll(/<div data-line="\d+"[^>]*?style="([^"]*)"/gu)].map(
    ([, style = '']) => /line-height:([^;"]+)/u.exec(style)?.[1] ?? null,
  );

describe('a deck’s box drawn as PowerPoint’s own shrink left its line spacing (Session 58, PF-4b)', () => {
  it('the box’s own spacing: 100% less 10% is 90% of a line', () => {
    expect(boxLine(drawn(box(undefined, SHRUNK)))).toBe('1.08');
    expect(boxLine(drawn(box(undefined)))).toBe('1.2');
  });

  it('a paragraph’s own share of a line is cut too; a spacing fixed in points is not', () => {
    const runs: TextRun[] = [
      { text: 'Placeholder first point\n', paragraph: { align: 'left', lineHeight: 1.08 } },
      { text: 'Placeholder second point', paragraph: { align: 'left', lineHeightPx: 48 } },
    ];
    expect(lineSpacings(drawn(box(runs, SHRUNK)))).toEqual(['0.96', 'calc(var(--fit, 1) * 48px)']);
    expect(lineSpacings(drawn(box(runs)))).toEqual(['1.08', 'calc(var(--fit, 1) * 48px)']);
  });
});
