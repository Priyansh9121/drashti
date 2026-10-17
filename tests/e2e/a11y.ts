import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Accessibility checks with axe-core, run inside the page (Electron cannot
 * open the extra page @axe-core/playwright needs). Fails on any serious or
 * critical finding, listing each one with the elements it found. Pictures of
 * the screens (slide previews and thumbnails, marked data-a11y-picture) are
 * left out: their colours are the slides' own, not the interface's.
 */

type AxeWindow = typeof globalThis & { axe?: typeof axe };

/** The moderate findings accepted, each with why (a11y-moderate.json). */
const ACCEPTED = (
  JSON.parse(readFileSync(join(__dirname, 'a11y-moderate.json'), 'utf8')) as {
    accepted: { what: string; rule: string; why: string }[];
  }
).accepted;

/**
 * Wait for things still arriving (a dialog rising, a sheet sliding in: Session 26g) to settle, so a
 * check sees the window as people do once it has, not part-way through a fade.
 */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

export async function expectNoSeriousA11yIssues(page: Page, what: string, include?: string): Promise<void> {
  await settled(page);
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
  // Moderate findings (Sessions 31–36, A11Y-3): said in the log, and each one not in the committed baseline
  // (tests/e2e/a11y-moderate.json, each accepted with why) fails the test.
  const moderate = violations.filter((v) => v.impact === 'moderate');
  for (const v of moderate)
    console.log(`A11Y_MODERATE ${what} :: ${v.id}: ${v.help}\n${v.nodes.map((n) => `  - ${n}`).join('\n')}`);
  const fresh = moderate
    .filter((v) => !ACCEPTED.some((a) => a.what === what && a.rule === v.id))
    .map((v) => `${v.id}: ${v.help}`);
  expect(fresh, `moderate accessibility findings in ${what} not in tests/e2e/a11y-moderate.json`).toEqual([]);
}

/**
 * Every `lang` on the page is a real language tag (Sessions 31–36, I18N-4): axe's valid-lang, html-has-lang
 * and html-lang-valid alone, so a screen's own colours (the slides') are not judged here. Returns how many
 * elements valid-lang passed, so a check knows it saw some.
 */
export async function expectValidLang(page: Page, what: string): Promise<number> {
  if (!(await page.evaluate(() => Boolean((globalThis as AxeWindow).axe)))) await page.evaluate(axe.source);
  const result = await page.evaluate(async () => {
    const engine = (globalThis as AxeWindow).axe;
    if (!engine) throw new Error('axe-core did not load');
    const run = await engine.run(document, {
      runOnly: { type: 'rule', values: ['valid-lang', 'html-has-lang', 'html-lang-valid'] },
      resultTypes: ['violations', 'passes'],
    });
    return {
      violations: run.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      passed: run.passes.find((p) => p.id === 'valid-lang')?.nodes.length ?? 0,
    };
  });
  expect(result.violations, `language tags in ${what}`).toEqual([]);
  return result.passed;
}
