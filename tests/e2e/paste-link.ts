import { expect, type Page } from '@playwright/test';
import type { PageGlobals } from './helpers';

/** A paste into the operator's field, without using or changing the Mac's or Windows' clipboard. */
export async function pasteLink(win: Page, link: string, accepted = true): Promise<void> {
  const input = win.getByTestId('link-text');
  await expect(input).toBeFocused();
  await input.evaluate((field, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    field.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, link);
  if (accepted) await expect(input).toHaveCount(0);
}

export const linkView = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.links.view());

/** The main process has finished importing the pasted link. */
export function linkFinished(win: Page, timeout = 120_000): Promise<void> {
  return expect(win.getByTestId('link-status')).toHaveAttribute('data-phase', 'done', { timeout });
}
