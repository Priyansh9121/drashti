import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PdfTools } from './PdfTools';
const props = {
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
  onUnderline: () => {},
  onStrikeThrough: () => {},
  onRotateRight: () => {},
  onDeletePage: () => {},
  onCropPage: () => {},
};
it('offers Crop page and refuses it with its own words until stream and recording are off', () => {
  const off = renderToStaticMarkup(createElement(PdfTools, { ...props, pagesWait: false }));
  expect(off).toMatch(/<button[^>]*data-testid="pdf-crop-page"[^>]*>.*?Crop page…<\/button>/);
  const on = renderToStaticMarkup(createElement(PdfTools, { ...props, pagesWait: true }));
  expect(on).toMatch(/<button[^>]*disabled=""[^>]*data-testid="pdf-crop-page"/);
  expect(on).toContain('Crop page waits until the stream and recording are off.');
});
