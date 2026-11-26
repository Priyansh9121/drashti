import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Help on (alpha.24: the status bar's Help switch, off at a first start), so every ? and every key beside a button's
 * words shows as before: for a spec that clicks a ? or reads a key. It is pressed by its own click event, so the
 * keyboard stays where it was and no tooltip opens; and remembered on this computer, so a reload, Simple Mode or a start
 * on the same data keeps it on. Help itself is help-switch.spec.ts's.
 */
export async function helpOn(win: Page): Promise<void> {
  const help = win.getByTestId('help-toggle');
  if ((await help.getAttribute('aria-pressed')) !== 'true') await help.dispatchEvent('click');
  await expect(help).toHaveAttribute('aria-pressed', 'true');
}
