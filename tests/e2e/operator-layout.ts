import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** The LIVE row's controls, including the contents that can spill outside a button. */
export const liveRowProblems = (win: Page) =>
  win.getByRole('group', { name: 'Next and Back', exact: true }).evaluate((row) => {
    const problems: string[] = [];
    const edge = row.getBoundingClientRect();
    const controls = [...row.children].map((el) => ({ el, box: el.getBoundingClientRect() }));
    const name = (el: Element) => el.getAttribute('data-testid') ?? el.textContent.trim();
    const inside = (inner: DOMRect, outer: DOMRect) =>
      inner.width > 0 &&
      inner.height > 0 &&
      inner.left >= outer.left - 0.5 &&
      inner.right <= outer.right + 0.5 &&
      inner.top >= outer.top - 0.5 &&
      inner.bottom <= outer.bottom + 0.5;
    for (const { el, box } of controls) {
      if (!inside(box, edge)) problems.push(`${name(el)} extends outside the LIVE row`);
      if (!(el instanceof HTMLButtonElement)) continue;
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
        problems.push(`${name(el)}: its contents overflow`);
      for (const part of el.querySelectorAll('kbd, svg'))
        if (!inside(part.getBoundingClientRect(), box))
          problems.push(`${name(el)}: ${part.tagName} ${part.textContent.trim()} extends outside its button`);
      const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = text.nextNode(); node; node = text.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if ([...range.getClientRects()].some((part) => !inside(part, box)))
          problems.push(`${name(el)}: ${node.textContent.trim()} extends outside its button`);
      }
    }
    controls.forEach((a, i) => {
      for (const b of controls.slice(i + 1)) {
        const across = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
        const down = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
        if (across > 0.5 && down > 0.5) problems.push(`${name(a.el)} overlaps ${name(b.el)}`);
      }
    });
    return problems;
  });

/** Measure the actual heading letters, including text inside a collapsible heading's own button. */
export const headingProblems = (win: Page) =>
  win.evaluate(() => {
    const problems: string[] = [];
    for (const heading of document.querySelectorAll('h1, h2, h3, h4')) {
      const header = heading.closest('header');
      if (!header || heading.getBoundingClientRect().width === 0) continue;
      const buttons = [...header.querySelectorAll('button')];
      const text = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      for (let node = text.nextNode(); node; node = text.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const box of range.getClientRects()) {
          for (const button of buttons) {
            // The heading toggle contains its own letters; only another button can cover them.
            if (button.contains(node)) continue;
            const other = button.getBoundingClientRect();
            const across = Math.min(box.right, other.right) - Math.max(box.left, other.left);
            const down = Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top);
            if (across > 0.5 && down > 0.5)
              problems.push(
                `${node.textContent.trim()}: covered by ${button.getAttribute('aria-label') ?? button.textContent.trim()}`,
              );
          }
        }
      }
    }
    return problems;
  });

/** Optional owner-requested evidence from the same quiet placeholder runs as the assertions. */
export async function layoutPicture(win: Page, name: string): Promise<void> {
  const dir = process.env['DRASHTI_LAYOUT_PICTURES'];
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await win.screenshot({ path: join(dir, `${name}.png`) });
}
