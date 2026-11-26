import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Columns } from './Layout';

/*
 * Where the chat popup stands (alpha.24, QA24-CHATPOP-1; the review's MUST 1): a place at the foot of the middle
 * column, which ends just above the quick bar and the bar of clears, so the card lies over the middle only: never over
 * a pinned show button, the bar of clears, the left column's Undo or the live column's notices. Placeholder parts only.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const render = () => {
  vi.stubGlobal('window', { innerWidth: 1024 });
  return renderToStaticMarkup(
    createElement(Columns, { left: 'Placeholder left', middle: 'Placeholder middle', right: 'Placeholder right' }),
  );
};

describe('the chat popup’s place', () => {
  it('is the middle column’s last part, after what the middle shows', () => {
    expect(render()).toMatch(
      /data-testid="column-middle"[^>]*>Placeholder middle<div [^>]*data-testid="pop-place"[^>]*><\/div><\/div>/u,
    );
  });

  it('is there once: neither side column has one', () => {
    expect(render().match(/data-testid="pop-place"/gu)).toHaveLength(1);
  });
});
