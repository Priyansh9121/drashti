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

/**
 * What `read` says of the window laid out at `size` after a resize, once it has said the same for half a second
 * (help-switch.spec.ts's measuring at rest: the columns take their widths from the window's a frame or more after its
 * resize event, and the Mac's CI once read the boxes mid-way). It waits for that, then measures; it changes nothing that
 * is compared.
 */
export async function settledRead<T>(
  win: Page,
  size: { width: number; height: number },
  read: () => Promise<T>,
  what: string,
): Promise<T> {
  await expect
    .poll(() => win.evaluate(() => [window.innerWidth, window.innerHeight]), {
      message: `the page at ${String(size.width)} × ${String(size.height)}`,
    })
    .toEqual([size.width, size.height]);
  let got = await read();
  let last = JSON.stringify(got);
  let since = Date.now();
  await expect
    .poll(
      async () => {
        got = await read();
        const now = JSON.stringify(got);
        if (now !== last) {
          last = now;
          since = Date.now();
        }
        return Date.now() - since >= 500;
      },
      { message: `${what}: still for half a second`, intervals: [100] },
    )
    .toBe(true);
  return got;
}
