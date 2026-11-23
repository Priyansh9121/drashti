import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PdfTools, type PdfToolsProps } from './PdfTools';

const PAGE_ACTIONS = ['Extract pages…', 'Replace page…', 'Split…', 'Hand-out…'];
const GO_ON = [
  'Highlight',
  'Underline',
  'Turn page right',
  'Insert pages…',
  'Make a slide…',
  'Save a PDF copy…',
];

function tools(change: Partial<PdfToolsProps> = {}): string {
  const act = () => undefined;
  return renderToStaticMarkup(
    createElement(PdfTools, {
      available: {
        highlight: true,
        underline: true,
        strike: true,
        draw: true,
        cover: true,
        rotateRight: true,
        deletePage: true,
        insertPages: true,
        saveCopy: true,
        makeSlide: true,
      },
      activeTool: null,
      underlined: false,
      struckThrough: false,
      pending: null,
      blocked: false,
      onHighlight: act,
      onUnderline: act,
      onStrikeThrough: act,
      onDraw: act,
      onCover: act,
      onRotateRight: act,
      onDeletePage: act,
      onInsertPages: act,
      onSaveCopy: act,
      onMakeSlide: act,
      onExtractPages: act,
      onReplacePage: act,
      onSplit: act,
      onHandout: act,
      ...change,
    }),
  );
}

/** Whether the button with exactly this name is disabled in the markup (undefined: no such button). */
function disabled(markup: string, name: string): boolean | undefined {
  for (const match of markup.matchAll(/<button([^>]*)>(.*?)<\/button>/gsu)) {
    const label = (match[2] ?? '').replace(/<[^>]*>/gu, '').trim();
    if (label === name) return /\sdisabled=""/u.test(match[1] ?? '');
  }
  return undefined;
}

// x85's page actions (alpha.21, taken from alpha.22): only they wait while the stream is on air or recording; every
// PDF control alpha.21 already had goes on during a show (the lead's 19:19 ruling on x82's guard).
describe('PDF pages while the stream is on air or recording', () => {
  it('waits with Extract pages, Replace page, Split and Hand-out only, and says why', () => {
    const onAir = tools({ pagesWait: true });
    for (const name of PAGE_ACTIONS) expect(disabled(onAir, name), name).toBe(true);
    for (const name of GO_ON) expect(disabled(onAir, name), name).toBe(false);
    expect(onAir).toContain('data-testid="pdf-pages-wait"');
    expect(onAir).toContain(
      'Extract, Replace, Split and Hand-out wait until the stream and recording are off.',
    );
  });

  it('offers every page action once both are off, with no waiting note', () => {
    const offAir = tools({ pagesWait: false });
    for (const name of [...PAGE_ACTIONS, ...GO_ON]) expect(disabled(offAir, name), name).toBe(false);
    expect(offAir).not.toContain('data-testid="pdf-pages-wait"');
  });
});
