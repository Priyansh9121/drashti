import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MotionPreview } from './MotionPreview';

describe('the Appearance dialog’s motion samples', () => {
  it('draws an inert, fixed-size miniature for Calm, Lively and Off, with no show controls or output', () => {
    for (const motion of ['calm', 'lively', 'off'] as const) {
      const html = renderToStaticMarkup(createElement(MotionPreview, { motion }));
      expect(html).toContain(`data-motion-preview="${motion}"`);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('data-motion-preview-picture');
      expect(html).not.toMatch(/<(?:button|canvas|video)|tabindex|data-show-control/iu);
    }
  });
});
