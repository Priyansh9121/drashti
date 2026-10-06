import type { ElectronApplication, Page } from '@playwright/test';
import { chromium, expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { setUpPlaceholderShow } from './placeholder-show';

/*
 * Accessibility of what is seen (Session 15, WCAG 2.2 AA): the text made
 * larger (200%) loses no control, in Pro Mode, Simple Mode and a dialog;
 * with the computer set to reduce motion, the interface's transitions stop;
 * and axe at 1280 x 720 on the screens other specs do not open, and on every
 * tab of the phone remote at 375 x 812 (axe's target-size check included).
 */

/** Zoom the operator window as View > Zoom In does (1 is 100%). */
async function zoom(app: ElectronApplication, factor: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, f) => {
    for (const w of BrowserWindow.getAllWindows())
      if (w.webContents.getURL().includes('index.html')) w.webContents.setZoomFactor(f);
  }, factor);
}

/**
 * Controls that cannot be reached: each one scrolled to (as the keyboard
 * would), then nothing else may be on top of it or cut it off.
 */
function unreachable(page: Page, within: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const out: string[] = [];
    const root = document.querySelector(selector) ?? document.body;
    const controls = [
      ...root.querySelectorAll<HTMLElement>(
        'button, select, input, textarea, [role="separator"][tabindex="0"]',
      ),
    ];
    for (const el of controls) {
      if (el.offsetParent === null || el.closest('[hidden], [aria-hidden="true"]')) continue;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
      const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      const hit = document.elementFromPoint(x, y);
      const reached =
        r.width > 0 && r.height > 0 && hit !== null && (el === hit || el.contains(hit) || hit.contains(el));
      if (!reached)
        out.push((el.getAttribute('aria-label') ?? el.textContent).trim().replace(/\s+/gu, ' ').slice(0, 50));
    }
    return out;
  }, within);
}

/** How wide the layout is in CSS pixels now (the window's width divided by the zoom). */
const cssWidth = (page: Page) => page.evaluate(() => window.innerWidth);

test('with the text at 200%, every control can still be reached: Pro Mode, a dialog, Simple Mode', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  await win.reload();
  await operatorReady(win);
  await zoom(app, 2);
  await expect.poll(() => cssWidth(win)).toBeLessThanOrEqual(660);
  // The window scrolls rather than cutting the columns off.
  expect(await win.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(960);
  expect(await unreachable(win, '#root'), 'Pro Mode at 200%').toEqual([]);
  await expectNoSeriousA11yIssues(win, 'Pro Mode at 200%');

  // A dialog: Screens, as large as the window allows, scrolling inside.
  await win.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const dialog = win.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await unreachable(win, '[role="dialog"]'), 'the Screens dialog at 200%').toEqual([]);
  await win.getByRole('button', { name: 'Close screens' }).click();

  // Simple Mode.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  expect(await unreachable(win, '[data-testid="simple-mode"]'), 'Simple Mode at 200%').toEqual([]);
  await expectNoSeriousA11yIssues(win, 'Simple Mode at 200%');
  await zoom(app, 1);
  await app.close();
});

test('with the computer set to reduce motion, the interface does not move', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const tab = win.getByTestId('library-tab-presentations');
  const duration = () => tab.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
  // The library's tabs change colour over a moment as usual...
  expect(await duration()).toBeGreaterThan(0.05);
  // ...and at once when motion is reduced, as every transition and animation in the window.
  await win.emulateMedia({ reducedMotion: 'reduce' });
  expect(await duration()).toBeLessThan(0.001);
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await expect(win.getByRole('dialog')).toBeVisible();
  const moving = await win.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a instanceof CSSTransition || a instanceof CSSAnimation)
      .map((a) => Number(a.effect?.getComputedTiming().duration ?? 0))
      .filter((ms) => ms > 1),
  );
  expect(moving).toEqual([]);
  await app.close();
});

test('axe at 1280 x 720 on Themes and the words editor', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await win.getByRole('button', { name: 'Themes', exact: true }).click();
  await expect(win.getByTestId('themes-panel')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'Themes');
  await win.getByRole('button', { name: 'Close themes' }).click();
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Language test slides/u })
    .click();
  await win.getByRole('button', { name: 'Edit words' }).click();
  await expect(win.getByTestId('words-editor')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the words editor');
  await app.close();
});

test('the phone remote at 375 x 812: axe on every tab, targets large enough to tap', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  const { base } = await networkOn(win);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      bypassCSP: true,
    });
    const phone = await context.newPage();
    await pairByQr(phone, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    for (const tab of ['show', 'playlist', 'more']) {
      await phone.getByTestId(`remote-tab-${tab}`).click();
      await expectNoSeriousA11yIssues(phone, `the remote's ${tab} tab at 375 x 812`);
      // Every control at least 24 x 24 CSS pixels (WCAG 2.5.8), or spaced so a 24-pixel circle fits.
      const small = await phone.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('button, a[href], input, select')]
          .filter((el) => el.offsetParent !== null)
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width < 24 || r.height < 24)
          .map(
            ({ el, r }) =>
              `${(el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 30)} (${String(Math.round(r.width))} x ${String(Math.round(r.height))})`,
          ),
      );
      expect(small, `controls smaller than 24 x 24 on the ${tab} tab`).toEqual([]);
    }
  } finally {
    await browser.close();
  }
  await app.close();
});
