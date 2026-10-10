import type { Page } from '@playwright/test';
import { devices, expect, test, webkit } from '@playwright/test';
import type { Device } from './devices';
import { NETWORK_ENV, networkOn, pairByQr, pairingCode, PHONE } from './devices';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { setUpPlaceholderShow } from './placeholder-show';

/*
 * The phone pages, hardened for touch (Session 25): on an iPhone-sized screen (390 × 844, WebKit),
 * every control is at least 44 × 44 CSS pixels (docs/design.md), a quick double tap never zooms
 * (touch-action: manipulation) and a pull at the top never reloads (overscroll-behavior: none).
 * A real iPhone and iPad are still owed (PLAN.md §5.2). Placeholder content only.
 */

/** Every visible control under 44 × 44 (a tick box or radio counts with its label, which takes the tap too). */
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
        return { name: (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 30), r };
      })
      .filter(({ r }) => r.width < 44 || r.height < 44)
      .map(({ name, r }) => `${name} (${String(Math.round(r.width))} × ${String(Math.round(r.height))})`),
  );

/**
 * Text under 16 px (docs/design.md), outside the two kinds kept small on purpose: a tab bar's word
 * under its icon (`data-small-label`) and a state badge (`data-badge`, 11 px bold capitals everywhere).
 */
const smallText = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('body *')]
      .filter(
        (el) =>
          el.offsetParent !== null &&
          [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) &&
          el.closest('[data-small-label], [data-badge], [aria-hidden="true"]') === null &&
          parseFloat(getComputedStyle(el).fontSize) < 16,
      )
      .map((el) => `${el.textContent.trim().slice(0, 30)} (${getComputedStyle(el).fontSize})`),
  );

/** No double-tap zoom on the page and its controls, and no pull-to-reload. */
const touch = (page: Page) =>
  page.evaluate(async () => {
    const computed: unknown = getComputedStyle(document.documentElement).overscrollBehaviorY;
    // An engine that does not know the property (Playwright's WebKit on Windows) drops it: there the
    // page's own stylesheet is checked for the rule instead (a real iPhone is still owed).
    const shipped = async () => {
      const sheets = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
      const texts = await Promise.all(sheets.map(async (l) => (await fetch(l.href)).text()));
      return texts.some((t) =>
        /html:has\(\s*>\s*body\.web\s*\)[^{]*\{[^}]*overscroll-behavior:\s*none/u.test(t),
      )
        ? 'none'
        : 'missing';
    };
    return {
      page: getComputedStyle(document.body).touchAction,
      overscroll: typeof computed === 'string' ? computed : await shipped(),
      controls: [
        ...new Set([...document.querySelectorAll('button')].map((b) => getComputedStyle(b).touchAction)),
      ],
    };
  });

const HARDENED = { page: 'manipulation', overscroll: 'none', controls: ['manipulation'] };

/** Safari on an iPhone, its whole screen 390 × 844 (the device profile leaves out Safari's bars). */
async function iphone(): Promise<Device> {
  const browser = await webkit.launch();
  const context = await browser.newContext({
    ...devices[PHONE.webkit],
    viewport: { width: 390, height: 844 },
    bypassCSP: true,
  });
  const page = await context.newPage();
  return {
    browser,
    context,
    page,
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}

test('the phone pages at 390 × 844: every target 44 px or more, no double-tap zoom, no pull to reload', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  const { base } = await networkOn(win);
  const phone = await iphone();
  try {
    const page = phone.page;
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    // The pairing page, before a code is typed.
    await page.goto(`${base}/pair`);
    await expect(page.getByRole('button').first()).toBeVisible();
    expect.soft(await tooSmall(page), 'the pairing page').toEqual([]);
    expect.soft(await smallText(page), 'text under 16 px on the pairing page').toEqual([]);
    expect.soft(await touch(page)).toMatchObject({ page: 'manipulation', overscroll: 'none' });

    // The remote, on each of its tabs (from another page first: the pairing address differs only by its #).
    await page.goto('about:blank');
    await pairByQr(page, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    for (const tab of ['show', 'playlist', 'library', 'more']) {
      await page.getByTestId(`remote-tab-${tab}`).click();
      await expect(page.getByTestId(`remote-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
      expect.soft(await tooSmall(page), `the remote's ${tab} tab`).toEqual([]);
      expect.soft(await smallText(page), `text under 16 px on the remote's ${tab} tab`).toEqual([]);
    }
    expect.soft(await touch(page)).toEqual(HARDENED);
    // The 44 px floor never shrinks what is bigger by design: Back and Next stay 64 px, the actions 48.
    const tall = async (testId: string) => (await page.getByTestId(testId).boundingBox())?.height ?? 0;
    await page.getByTestId('remote-tab-show').click();
    expect.soft(await tall('remote-back'), 'Back').toBeGreaterThanOrEqual(64);
    expect.soft(await tall('remote-next-button'), 'Next').toBeGreaterThanOrEqual(64);
    const actions = await page
      .getByTestId('remote-actions')
      .getByRole('button')
      .evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().height)));
    expect.soft(Math.min(...actions), 'the quick actions').toBeGreaterThanOrEqual(48);
    // A tap that cannot be done (Back with nothing on the screens) shows a notice: its Dismiss too.
    await page.getByTestId('remote-tab-show').click();
    await page.getByTestId('remote-back').click();
    const notice = page.getByRole('alert');
    await expect(notice).toBeVisible();
    expect.soft(await tooSmall(page), 'the remote with a notice').toEqual([]);
  } finally {
    await phone.close();
  }

  // The announcements page, on another phone.
  const sender = await iphone();
  try {
    await pairByQr(
      sender.page,
      base,
      await pairingCode(win, 'announcements', 'Placeholder sender'),
      '/announce',
    );
    await expect(sender.page.getByRole('button').first()).toBeVisible();
    expect.soft(await tooSmall(sender.page), 'the announcements page').toEqual([]);
    expect.soft(await smallText(sender.page), 'text under 16 px on the announcements page').toEqual([]);
    expect.soft(await touch(sender.page)).toEqual(HARDENED);
  } finally {
    await sender.close();
  }

  // The stage display in a browser: nothing to tap, but no zoom and no pull to reload either.
  const tablet = await iphone();
  try {
    await pairByQr(tablet.page, base, await pairingCode(win, 'stage', 'Placeholder stage'), '/stage');
    await expect(tablet.page.getByTestId('stage-view')).toBeVisible();
    expect.soft(await touch(tablet.page)).toMatchObject({ page: 'manipulation', overscroll: 'none' });
  } finally {
    await tablet.close();
  }
  await app.close();
});
