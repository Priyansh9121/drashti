import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { launchApp, operatorPage, operatorReady } from './helpers';

/*
 * Notices (the owner, 11 Nov 2026: "small and see-through, in the bottom-right corner, in both modes"), such as "plays
 * at the even loudness … 0.3 dB louder": the operator's notice floats in the window's bottom-right corner, just above the
 * bars at its foot, in small words on a see-through card. It takes no room (nothing above it moves when it comes or
 * goes) and never stands in the way: a click on it reaches what is under it, its Dismiss excepted. In Pro Mode and in
 * Simple Mode; each notice here is the one a single click on the mode switch gives. Placeholder words only.
 */

/** Where something is, and how big, in the window. */
const boxOf = async (l: Locator) => {
  const box = await l.boundingBox();
  if (!box) throw new Error('not drawn');
  return box;
};

/** The alpha of a computed colour (1 when it has none). */
const alphaOf = (colour: string): number => {
  const slash = /\/\s*([0-9.]+)\s*\)\s*$/u.exec(colour);
  if (slash) return Number(slash[1]);
  const rgba = /^rgba\([^)]*,\s*([0-9.]+)\s*\)$/u.exec(colour);
  return rgba ? Number(rgba[1]) : 1;
};

async function expectSmallSeeThroughInTheCorner(
  win: Page,
  show: () => Promise<void>,
  above: Locator,
  bars: Locator,
): Promise<void> {
  const notice = win.getByTestId('operator-notice');
  await expect(notice).toHaveCount(0);
  const before = await boxOf(above);
  await show();
  await expect(notice).toBeVisible();
  // Nothing above it moved: it takes no room in the window.
  expect(await boxOf(above)).toEqual(before);
  const card = await boxOf(notice);
  const foot = await boxOf(bars);
  const width = await win.evaluate(() => document.documentElement.clientWidth);
  // In the bottom-right corner: its right edge near the window's, its foot just above the bars.
  expect(width - (card.x + card.width)).toBeLessThanOrEqual(24);
  expect(card.y + card.height).toBeLessThanOrEqual(foot.y);
  expect(foot.y - (card.y + card.height)).toBeLessThanOrEqual(16);
  // Small: its words at 12 px at most, the card at most 352 px wide.
  const look = await notice.evaluate((el) => {
    const words = el.querySelector('p');
    return {
      size: words ? Number.parseFloat(getComputedStyle(words).fontSize) : 0,
      background: getComputedStyle(el).backgroundColor,
    };
  });
  expect(look.size).toBeGreaterThan(0);
  expect(look.size).toBeLessThanOrEqual(12);
  expect(card.width).toBeLessThanOrEqual(352);
  // See-through.
  expect(alphaOf(look.background)).toBeLessThan(1);
  // Never in the way: a click on its middle reaches what is under it.
  const middle = { x: card.x + card.width / 2, y: card.y + card.height / 2 };
  expect(
    await win.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="operator-notice"]') === null,
      middle,
    ),
  ).toBe(true);
  // Its Dismiss still takes a click.
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
  expect(await boxOf(above)).toEqual(before);
}

test('a notice is small and see-through, in the bottom-right corner, taking no room and never in the way, in Pro Mode and in Simple Mode', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);

  // Pro Mode: one click on Simple Mode says to double-click it.
  const header = win.getByTestId('app-header');
  await expectSmallSeeThroughInTheCorner(
    win,
    async () => {
      await header.getByRole('button', { name: 'Simple Mode', exact: true }).click();
      await expect(win.getByTestId('operator-notice')).toContainText('Double-click Simple Mode');
    },
    win.locator('aside[aria-label="Live"]'),
    win.getByTestId('layer-bar'),
  );

  // Simple Mode: one click on Pro Mode says to double-click it.
  await header.getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expectSmallSeeThroughInTheCorner(
    win,
    async () => {
      await win.getByTestId('simple-leave').click();
      await expect(win.getByTestId('operator-notice')).toContainText('Double-click Pro Mode');
    },
    win.getByTestId('simple-mode').locator('aside[aria-label="Live"]'),
    win.getByTestId('simple-buttons'),
  );
  await app.close();
});
