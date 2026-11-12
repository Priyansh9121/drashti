import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ImportNoticeLine } from './ImportNoticeLine';

/*
 * An import notice in the bottom-right corner (Session 57, the review of h-notices): one line, cut off where it does
 * not fit, except an import's old fonts, which the admin writes down on setup day: those words are drawn whole, wrapping
 * as the operator's own notice does, so no font and nothing to do is cut off. Placeholder names only.
 */

const OLD_FONTS =
  '“Placeholder Hymn” and 486 more · These presentations use the old fonts “Placeholder Gopika”, “Placeholder Terafont-Varun”, “Placeholder LMG-Arun”, “Placeholder Kruti Dev 010” and “Placeholder Shree Guj”: install them on this computer and on each node, then quit and start Drashti again on each.';

const render = (item: Parameters<typeof ImportNoticeLine>[0]['item']) =>
  renderToStaticMarkup(createElement(ImportNoticeLine, { item, canFindMissing: true }));

it('draws an import’s old fonts whole, its words wrapping, so every font and what to do can be read', () => {
  const html = render({ id: 1, text: OLD_FONTS, whole: true });
  expect(html).toContain(`<p class="min-w-0 flex-1 break-words leading-normal">${OLD_FONTS}</p>`);
  expect(html).not.toMatch(/\btruncate\b/u);
});

it('keeps any other import notice to one line, cut off where it does not fit and whole in its tooltip', () => {
  const text = '“Placeholder damaged.pptx” · This file looks damaged. Repair it, then try again.';
  const html = render({ id: 2, text });
  expect(html).toContain(
    `<span title="${text}" class="block min-w-0 truncate leading-normal">${text}</span>`,
  );
  // No paragraph of words (the icons' <path> aside).
  expect(html).not.toMatch(/<p[\s>]/u);
});
