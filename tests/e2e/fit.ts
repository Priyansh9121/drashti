import type { Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Check a panel or dialog is laid out at the window's size: inside the
 * window, nothing sideways-scrolling, and no button whose words do not fit.
 */
export async function expectFits(panel: Locator, what: string): Promise<void> {
  await expect(panel).toBeVisible();
  const problems = await panel.evaluate((root) => {
    const out: string[] = [];
    const vw = innerWidth;
    const vh = innerHeight;
    const r = root.getBoundingClientRect();
    if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5)
      out.push(
        `it is cut off (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`,
      );
    if (document.documentElement.scrollWidth > vw) out.push('the page scrolls sideways');
    for (const b of root.querySelectorAll('button')) {
      const box = b.getBoundingClientRect();
      if (box.width === 0) continue;
      if (b.scrollWidth > b.clientWidth + 1) out.push(`“${b.textContent}”: its words do not fit`);
      if (box.right > vw + 0.5) out.push(`“${b.textContent}” is off the right edge`);
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-scroll-x="no"], footer, header')) {
      if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()} scrolls sideways`);
    }
    return out;
  });
  expect(problems, what).toEqual([]);
}
