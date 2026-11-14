import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TextElement, TextParagraph, TextRun } from '../../../shared/model';
import { ElementView } from './SlideView';

/*
 * A deck's paragraph spacing at a box's edges, as the screens draw it (Session 57, C15; Session 58, PF-11): no space
 * before the box's first paragraph or after its last (unless the box asks for it), and between paragraphs the space
 * each asks for. A box ending in an empty paragraph (PowerPoint leaves one when Enter ends the words) draws no empty
 * line there, but the paragraph before it is not the box's last, so its space after stays, as in the slide editor.
 */

const SPACED: TextParagraph = { align: 'left', spaceBefore: 12, spaceAfter: 16 };

function box(runs: TextRun[], spaceAtTextEdges?: true): TextElement {
  return {
    id: 'placeholder-spaced',
    kind: 'text',
    frame: { x: 0, y: 0, width: 800, height: 400 },
    text: runs.map((r) => r.text).join(''),
    lang: 'en',
    runs,
    style: {
      fontFamily: null,
      fontSize: 40,
      fontWeight: 400,
      color: '#ffffff',
      align: 'left',
      verticalAlign: 'top',
      lineHeight: 1.2,
      shadow: false,
      ...(spaceAtTextEdges ? { spaceAtTextEdges } : {}),
    },
  };
}

/** Each line the screens draw: its words, and whether it has its space before and after. */
function drawn(el: TextElement): { words: string; before: boolean; after: boolean }[] {
  const html = renderToStaticMarkup(createElement(ElementView, { el, media: 'still' }));
  return [...html.matchAll(/<div data-line="\d+"[^>]*?style="([^"]*)">(.*?)<\/div>/gu)].map(
    ([, style = '', inner = '']) => ({
      words: inner.replace(/<[^>]+>/gu, ''),
      before: style.includes('padding-block-start'),
      after: style.includes('padding-block-end'),
    }),
  );
}

describe('a deck’s paragraph spacing at the edges of a box (Session 58, PF-11)', () => {
  it('a box ending in an empty paragraph draws it as PowerPoint does (FT-7), and keeps the space after the paragraph before it', () => {
    const lines = drawn(
      box([
        { text: 'Placeholder first point\n', paragraph: SPACED },
        { text: 'Placeholder second point\n', paragraph: SPACED },
        { text: '', paragraph: SPACED },
      ]),
    );
    // The second point is not the last paragraph, so its space after stays (PF-11); the empty one is drawn, one line
    // with its space before, as PowerPoint lays it out, so a box aligned to its middle or bottom sits where PowerPoint
    // puts it (Session 58, FT-7).
    expect(lines).toEqual([
      { words: 'Placeholder first point', before: false, after: true },
      { words: 'Placeholder second point', before: true, after: true },
      { words: '', before: true, after: false },
    ]);
  });

  it('its empty last paragraph takes the look of the paragraph before it, as PowerPoint’s Enter carries it on (FT-7)', () => {
    const html = renderToStaticMarkup(
      createElement(ElementView, {
        el: box([
          { text: 'Placeholder point\n', paragraph: SPACED, size: 60 },
          { text: '', paragraph: SPACED },
        ]),
        media: 'still',
      }),
    );
    const empty = /<div data-line="1"[^>]*>(.*?)<\/div>/u.exec(html)?.[1] ?? '';
    expect(empty).toContain('<br/>');
    // The size it is drawn at (60 px, as shrink-to-fit scales it), not the box's 40.
    expect(empty).toContain('* 60px)');
  });

  it('words without a deck’s paragraphs (a list made in Drashti) draw no empty last line, as before (FT-7)', () => {
    const lines = drawn({
      ...box([{ text: 'Placeholder listed point\n', list: 'disc' }]),
    });
    expect(lines.map((l) => l.words)).toEqual(['Placeholder listed point']);
  });

  it('a box whose words end its last paragraph has no space after it, as before', () => {
    expect(
      drawn(
        box([
          { text: 'Placeholder first point\n', paragraph: SPACED },
          { text: 'Placeholder second point', paragraph: SPACED },
        ]),
      ),
    ).toEqual([
      { words: 'Placeholder first point', before: false, after: true },
      { words: 'Placeholder second point', before: true, after: false },
    ]);
  });

  it('a box that asks for its edges’ spacing has it at both ends, as before', () => {
    expect(
      drawn(
        box(
          [
            { text: 'Placeholder first point\n', paragraph: SPACED },
            { text: 'Placeholder second point', paragraph: SPACED },
          ],
          true,
        ),
      ),
    ).toEqual([
      { words: 'Placeholder first point', before: true, after: true },
      { words: 'Placeholder second point', before: true, after: true },
    ]);
  });
});
