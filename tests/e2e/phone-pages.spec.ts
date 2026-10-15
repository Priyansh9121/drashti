import type { Page } from '@playwright/test';
import { chromium, devices, expect, test, webkit } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { Engine } from './devices';
import { NETWORK_ENV, networkOn, pairByQr, pairingCode, PHONE } from './devices';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { setUpPlaceholderShow } from './placeholder-show';

/*
 * Every phone page in Diya (Session 26g), at 375 × 812 in Safari's engine and Chrome's: the pairing
 * page, the remote on each of its tabs and the announcement page pass axe, every target is 44 px or
 * more, and the lamp is beside Drashti's name. The stage display is a screen and keeps its look
 * (audience-pixels.spec.ts); it passes axe here too. Placeholder content only.
 */

/** Every visible control under 44 × 44 CSS pixels (a tick box or radio counts with its label). */
const tooSmall = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="button"]',
      ),
    ]
      .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
      .map((el) => {
        const choice = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');
        const target = (choice ? el.closest('label') : null) ?? el;
        const r = target.getBoundingClientRect();
        return {
          name: (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 30),
          w: r.width,
          h: r.height,
        };
      })
      .filter(({ w, h }) => w < 44 || h < 44),
  );

for (const engine of ['webkit', 'chromium'] as const satisfies readonly Engine[])
  test(`the phone pages at 375 × 812 in ${engine === 'webkit' ? 'Safari’s' : 'Chrome’s'} engine`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpPlaceholderShow(win);
    const { base } = await networkOn(win);
    const browser = await (engine === 'webkit' ? webkit : chromium).launch();
    const context = await browser.newContext({
      ...devices[PHONE[engine]],
      viewport: { width: 375, height: 812 },
      bypassCSP: true,
    });
    const page = await context.newPage();
    const check = async (what: string) => {
      await expectNoSeriousA11yIssues(page, `${what} at 375 × 812 (${engine})`);
      expect.soft(await tooSmall(page), `targets under 44 px: ${what} (${engine})`).toEqual([]);
    };
    try {
      // The pairing page, with the lamp beside the name.
      await page.goto(`${base}/pair`);
      await expect(page.getByTestId('pair-page').locator('svg[data-mark]')).toBeVisible();
      await check('the pairing page');

      // The remote, each tab, the lamp in its header.
      await page.goto('about:blank');
      await pairByQr(page, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
      await expect(page.getByTestId('remote').locator('header svg[data-mark]')).toBeVisible();
      for (const tab of ['show', 'playlist', 'library', 'more']) {
        await page.getByTestId(`remote-tab-${tab}`).click();
        await expect(page.getByTestId(`remote-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
        await check(`the remote's ${tab} tab`);
      }
      // Next is the remote's one primary, with the lamp's plum.
      await page.getByTestId('remote-tab-show').click();
      await expect(page.getByTestId('remote-next-button')).toHaveAttribute('data-variant', 'primary');
      expect(
        await page.evaluate(
          () =>
            [...document.querySelectorAll<HTMLButtonElement>('[data-variant="primary"]')].filter(
              (b) => b.offsetParent !== null,
            ).length,
        ),
      ).toBe(1);

      // The announcement page.
      await page.goto('about:blank');
      await pairByQr(
        page,
        base,
        await pairingCode(win, 'announcements', 'Placeholder announcer'),
        '/announce',
      );
      await expect(page.getByTestId('announce-page').locator('svg[data-mark]')).toBeVisible();
      await check('the announcement page');

      // The stage display: a screen, as it was; axe all the same.
      await page.goto('about:blank');
      await pairByQr(page, base, await pairingCode(win, 'stage', 'Placeholder stage'), '/stage');
      await expect(page.getByTestId('stage-view')).toBeVisible();
      await expectNoSeriousA11yIssues(page, `the stage display at 375 × 812 (${engine})`);
    } finally {
      await context.close();
      await browser.close();
      await app.close();
    }
  });
