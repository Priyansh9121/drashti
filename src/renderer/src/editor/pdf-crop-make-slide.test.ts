import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { EditDoc } from '../../../shared/slide-edit';
import { MakeSlideDialog } from './MakeSlideDialog';
import { newSlide } from './ops';
vi.mock('../ui/Dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));
it('Make a slide previews and measures its part on the page already cropped for showing', () => {
  const page = {
    ...newSlide(null),
    id: 'page',
    pageSize: { width: 480, height: 320 },
    documentPage: {
      sha256: 'a'.repeat(64),
      ext: 'pdf' as const,
      page: 0,
      crop: { x: 0, y: 0, w: 0.5, h: 0.75 },
    },
  };
  const doc: EditDoc = {
    presentationId: 'generated',
    name: 'Generated',
    width: 1920,
    height: 1080,
    transition: null,
    loop: false,
    groups: [{ id: 'g', name: '', color: null, slides: [page] }],
  };
  const html = renderToStaticMarkup(
    createElement(MakeSlideDialog, {
      base: { doc, slideId: 'page', stamp: 'generated' },
      onClose: vi.fn(),
      onMade: vi.fn(),
    }),
  );
  expect(html).toMatch(/data-testid="make-slide-page"[^>]*style="aspect-ratio:240 \/ 240;/);
});
