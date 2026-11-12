import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ShapeElement } from '../../../shared/model';
import { ElementView } from './SlideView';

it('omits hidden source objects wherever individual slide elements are drawn', () => {
  const object: ShapeElement = {
    id: 'placeholder-object',
    kind: 'shape',
    frame: { x: 1, y: 1, width: 40, height: 30 },
    fill: '#123456',
    cornerRadius: 0,
    opacity: 1,
  };
  const hidden = { ...object, hidden: true };
  expect(renderToStaticMarkup(createElement(ElementView, { el: hidden, media: 'still' }))).toBe('');
  expect(renderToStaticMarkup(createElement(ElementView, { el: object, media: 'still' }))).toContain(
    'data-element="placeholder-object"',
  );
});
