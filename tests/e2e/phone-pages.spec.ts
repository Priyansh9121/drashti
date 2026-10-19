import type { Page } from '@playwright/test';
import { chromium, devices, expect, test, webkit } from '@playwright/test';
import { BLACK } from '../../src/shared/appearance/appearances';
import { appearanceVars } from '../../src/shared/appearance/vars';
import { expectNoSeriousA11yIssues } from './a11y';
import type { Engine } from './devices';
import { NETWORK_ENV, networkOn, pairByQr, pairingCode, PHONE, TABLET } from './devices';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';
import { setUpPlaceholderShow } from './placeholder-show';

/*
 * Every phone page in Black, fixed (Session 41; Session 26g's plum and the lamp's light until then): the pairing
 * page, the remote on each of its tabs and the announcement page take Black's colours, whatever Main's own
 * appearance is (Saffron here), with no lamp light, `theme-color` Black's window colour and the mark the logo's
 * own. On a phone (375 × 812) and on a tablet (810 × 1080, and held sideways at 1080 × 810), in Safari's engine
 * and Chrome's, every page passes axe and every target is 44 px or more. The stage display is a screen and keeps
 * its look (audience-pixels.spec.ts); it passes axe here too. Placeholder content only.
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

/** "#rrggbb" as getComputedStyle writes it. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((at) => String(parseInt(hex.slice(at, at + 2), 16))).join(', ')})`;

/** Black's colours and its shadows' tints, as app.css's body.web must set them. */
const BLACK_VARS = appearanceVars(BLACK);

/** A colour as written in the built CSS ("#fff", "#000c") in full ("#ffffff", "#000000cc"). */
const full = (hex: string) =>
  /^#[0-9a-f]{3,4}$/iu.test(hex)
    ? `#${hex.slice(1).replace(/./gu, (c) => c + c)}`.toLowerCase()
    : hex.toLowerCase();

/** The mark's tile, filled flat with the logo's own plum (ui/Mark.tsx: the middle of #5e1b52 and #2a0b27). */
const MARK_TILE = '#44133d';

/**
 * The page in Black: every colour and tint Black's, `theme-color` Black's window colour, the page plain (no
 * lamp light: no radial gradient on anything, before anything either), and the mark the logo's own.
 */
async function expectBlack(page: Page, what: string): Promise<void> {
  const seen = await page.evaluate((names) => {
    const body = getComputedStyle(document.body);
    const lit = [...document.querySelectorAll<HTMLElement>('body, body *')]
      .filter((el) => el.closest('[data-a11y-picture]') === null)
      .flatMap((el) =>
        [null, '::before', '::after'].map((pseudo) => ({
          el: `${el.tagName.toLowerCase()}${pseudo ?? ''} ${el.getAttribute('class') ?? ''}`,
          image: getComputedStyle(el, pseudo).backgroundImage,
        })),
      )
      .filter(({ image }) => image.includes('radial-gradient'))
      .map(({ el }) => el.slice(0, 80));
    return {
      vars: Object.fromEntries(names.map((n) => [n, body.getPropertyValue(n).trim()])),
      themeColour: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
      background: body.backgroundColor,
      image: body.backgroundImage,
      lit,
      tiles: [...document.querySelectorAll('svg[data-mark] rect')].map((r) => r.getAttribute('fill')),
    };
  }, Object.keys(BLACK_VARS));
  expect(
    Object.fromEntries(Object.entries(seen.vars).map(([name, hex]) => [name, full(hex)])),
    `${what}: Black's colours`,
  ).toEqual(BLACK_VARS);
  expect(seen.themeColour, `${what}: theme-color`).toBe(BLACK.colours.ink);
  expect(seen.background, `${what}: the page`).toBe(rgb(BLACK.colours.ink));
  expect(seen.image, `${what}: the page`).toBe('none');
  expect(seen.lit, `${what}: no lamp light`).toEqual([]);
  expect(seen.tiles.length, `${what}: the mark`).toBeGreaterThan(0);
  for (const tile of seen.tiles) expect(tile, `${what}: the mark's tile`).toBe(MARK_TILE);
}

/** The sizes every page is checked at: a phone, and a tablet upright and held sideways. */
const SIZES = [
  { name: 'a phone', device: PHONE, width: 375, height: 812, layout: 'phone' },
  {
    name: 'a tablet',
    device: { webkit: TABLET, chromium: 'Galaxy Tab S4' },
    width: 810,
    height: 1080,
    layout: 'wide',
  },
  {
    name: 'a tablet held sideways',
    device: { webkit: `${TABLET} landscape`, chromium: 'Galaxy Tab S4 landscape' },
    width: 1080,
    height: 810,
    layout: 'landscape',
  },
] as const satisfies readonly {
  name: string;
  device: Record<Engine, string>;
  width: number;
  height: number;
  layout: string;
}[];

/** The remote's tabs, as each layout has them. */
const TABS_OF = {
  phone: ['remote-tab-show', 'remote-tab-playlist', 'remote-tab-library', 'remote-tab-more'],
  wide: ['remote-side-playlist', 'remote-side-library'],
  landscape: ['remote-panel-show', 'remote-panel-playlist', 'remote-panel-library', 'remote-panel-more'],
} as const;

for (const engine of ['webkit', 'chromium'] as const satisfies readonly Engine[])
  for (const size of SIZES)
    test(`the phone pages in Black on ${size.name} (${String(size.width)} × ${String(size.height)}) in ${engine === 'webkit' ? 'Safari’s' : 'Chrome’s'} engine`, async () => {
      test.setTimeout(180_000);
      const { app } = await launchApp(NETWORK_ENV);
      const win = await operatorPage(app);
      await operatorReady(win);
      // Main in another appearance: the phones never follow it.
      await chooseMenuItem(app, 'appearance-saffron');
      await expect(win.locator('html')).toHaveAttribute('data-appearance', 'saffron');
      await setUpPlaceholderShow(win);
      const { base } = await networkOn(win);
      const browser = await (engine === 'webkit' ? webkit : chromium).launch();
      const context = await browser.newContext({
        ...devices[size.device[engine]],
        viewport: { width: size.width, height: size.height },
        bypassCSP: true,
      });
      const page = await context.newPage();
      const at = `${String(size.width)} × ${String(size.height)} (${engine})`;
      const check = async (what: string) => {
        await expectBlack(page, `${what} at ${at}`);
        await expectNoSeriousA11yIssues(page, `${what} at ${at}`);
        expect.soft(await tooSmall(page), `targets under 44 px: ${what} at ${at}`).toEqual([]);
      };
      try {
        // The pairing page, with the mark beside the name.
        await page.goto(`${base}/pair`);
        await expect(page.getByTestId('pair-page').locator('svg[data-mark]')).toBeVisible();
        await check('the pairing page');

        // The remote, each tab, the mark in its plain header.
        await page.goto('about:blank');
        await pairByQr(page, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
        const remote = page.getByTestId('remote');
        await expect(remote).toHaveAttribute('data-layout', size.layout);
        const header = remote.locator('header');
        await expect(header.locator('svg[data-mark]')).toBeVisible();
        expect(await header.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
          rgb(BLACK.colours.panel),
        );
        for (const tab of TABS_OF[size.layout]) {
          await page.getByTestId(tab).click();
          await expect(page.getByTestId(tab)).toHaveAttribute('aria-selected', 'true');
          await check(`the remote's ${tab}`);
        }
        // Next is a primary, in Black's: white, with Black's dark words; on a phone's Show tab, the one primary.
        const next = page.getByTestId('remote-next-button');
        await expect(next).toHaveAttribute('data-variant', 'primary');
        if (size.layout === 'phone') {
          await page.getByTestId('remote-tab-show').click();
          expect(
            await page.evaluate(
              () =>
                [...document.querySelectorAll<HTMLButtonElement>('[data-variant="primary"]')].filter(
                  (b) => b.offsetParent !== null,
                ).length,
            ),
          ).toBe(1);
        }
        const look = await next.evaluate((el) => ({
          image: getComputedStyle(el).backgroundImage,
          words: getComputedStyle(el).color,
        }));
        expect(look.image).toContain(rgb(BLACK.colours['primary-hi']));
        expect(look.image).toContain(rgb(BLACK.colours['primary-lo']));
        expect(look.words).toBe(rgb(BLACK.colours['on-primary']));

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
        await expectNoSeriousA11yIssues(page, `the stage display at ${at}`);
      } finally {
        await context.close();
        await browser.close();
        await app.close();
      }
    });
