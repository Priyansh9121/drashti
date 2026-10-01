import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import axe from 'axe-core';

/*
 * Accessibility checks with axe-core, run inside the page (Electron cannot
 * open the extra page @axe-core/playwright needs). Fails on any serious or
 * critical finding, listing each one with the elements it found. Pictures of
 * the screens (slide previews and thumbnails, marked data-a11y-picture) are
 * left out: their colours are the slides' own, not the interface's.
 */

type AxeWindow = typeof globalThis & { axe?: typeof axe };

export async function expectNoSeriousA11yIssues(page: Page, what: string, include?: string): Promise<void> {
  if (!(await page.evaluate(() => Boolean((globalThis as AxeWindow).axe)))) await page.evaluate(axe.source);
  const violations = await page.evaluate(async (selector) => {
    const engine = (globalThis as AxeWindow).axe;
    if (!engine) throw new Error('axe-core did not load');
    const exclude = [['[data-a11y-picture]']];
    const result = await engine.run(selector ? { include: [[selector]], exclude } : { exclude }, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      resultTypes: ['violations'],
    });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? null,
      help: v.help,
      nodes: v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`),
    }));
  }, include ?? null);
  const serious = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact ?? ''} ${v.id}: ${v.help}\n${v.nodes.map((n) => `  - ${n}`).join('\n')}`);
  expect(serious, `accessibility findings in ${what}`).toEqual([]);
}
