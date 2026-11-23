import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * The operator window as CI's displays leave it (Session 51): they are 1024 wide, and the window's content is
 * about 1024 × 645 on the Mac (1008 wide on Windows, the smallest Drashti allows there).
 */
export const CI_WINDOW = { width: 1024, height: 645 } as const;

/**
 * The operator window at `size` (CSS pixels): its content made that size where the display has room for it, and
 * its page laid out at exactly that size either way, as on CI. Waits until the page has taken the size.
 */
export async function sizeOperatorWindow(
  app: ElectronApplication,
  win: Page,
  size: { width: number; height: number },
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, want) => {
    const w = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('index.html'));
    w?.setContentSize(want.width, want.height);
  }, size);
  await win.setViewportSize(size);
  await expect
    .poll(() => win.evaluate(() => [window.innerWidth, window.innerHeight]))
    .toEqual([size.width, size.height]);
}

/**
 * The live column (`getByRole('complementary', { name: 'Live' })`) from its top: what scrolls in it, which since
 * alpha.21 is inside it (LiveColumn: the part under a still LIVE block, or, in a window too short for one, all of it
 * above the notices' place at its foot), scrolled back up.
 */
export async function liveColumnToTop(live: Locator): Promise<void> {
  await live.evaluate((column) => {
    for (const part of [
      column,
      ...column.querySelectorAll('[data-testid="live-scroll"], [data-testid="live-rest"]'),
    ])
      part.scrollTop = 0;
  });
}
