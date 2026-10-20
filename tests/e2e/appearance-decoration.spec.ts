import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { BLACK, WHITE } from '../../src/shared/appearance/appearances';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

/*
 * More colourful appearances (Session 42): Black and White draw exactly as at 9ed5d00 (the values below were read
 * from that build), whatever the colourful ones now draw in the header, the band, the marks and the headings.
 * Placeholder content only.
 */

/** A show open, so there are tabs, a chosen row and headings to see. */
async function inAShow(win: Page) {
  await win.setViewportSize({ width: 1280, height: 720 });
  await setUpPlaceholderShow(win);
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await win.getByTestId('playlist-item').filter({ hasText: KIRTAN }).click();
}

/** A panel's heading (a group's heading is in the words' own colour). */
const PANEL_HEADING = 'section > header > :is(h2, h3).text-2xs';

/*
 * Black and White as at 9ed5d00: what the header, the chosen tab, the chosen row and a heading draw, and where
 * the header's parts sit. Read from that build (this test's first version, run against it with
 * DRASHTI_E2E_APP_DIR) and written here; this build must draw the same.
 */
const AT_9ED5D00: Record<string, unknown> = {
  black: {
    header: ['rgb(18, 18, 21)', 'rgb(245, 245, 247)', 'rgb(44, 44, 50)', [0, 0, 1280, 48]],
    name: ['rgb(245, 245, 247)', [16, 12, 95, 24]],
    stream: ['rgb(200, 200, 207)', 'rgba(0, 0, 0, 0)', [768, 8, 96, 32]],
    screens: ['rgb(245, 245, 247)', 'rgb(130, 130, 141)', 'rgb(27, 27, 31)', [1021, 8, 100, 32]],
    live: ['rgb(245, 245, 247)', [127, 13, 516, 21]],
    underline: ['rgb(138, 180, 248)'],
    row: ['oklab(0.76608 -0.0191589 -0.106575 / 0.7)', 'rgb(38, 38, 43)'],
    heading: ['rgb(200, 200, 207)'],
    under: [0, 48, 300, 247],
    headingText: 'Music',
  },
  white: {
    header: ['rgb(248, 248, 250)', 'rgb(17, 18, 22)', 'rgb(212, 214, 220)', [0, 0, 1280, 48]],
    name: ['rgb(17, 18, 22)', [16, 12, 95, 24]],
    stream: ['rgb(67, 70, 78)', 'rgba(0, 0, 0, 0)', [768, 8, 96, 32]],
    screens: ['rgb(17, 18, 22)', 'rgb(111, 115, 124)', 'rgb(255, 255, 255)', [1021, 8, 100, 32]],
    live: ['rgb(17, 18, 22)', [127, 13, 516, 21]],
    underline: ['rgb(29, 78, 216)'],
    row: ['oklab(0.488178 -0.0212675 -0.21611 / 0.7)', 'rgb(223, 225, 230)'],
    heading: ['rgb(67, 70, 78)'],
    under: [0, 48, 300, 247],
    headingText: 'Music',
  },
};

async function fingerprint(win: Page) {
  const panelHeading = PANEL_HEADING;
  // Every colour change has finished (a chosen row's colours change over 120 ms).
  await expect.poll(() => win.evaluate(() => document.getAnimations().length)).toBe(0);
  return win.evaluate((panelHeading) => {
    const css = (el: Element | null, p: string) => (el ? getComputedStyle(el).getPropertyValue(p) : null);
    const box = (el: Element | null) => {
      const r = el?.getBoundingClientRect();
      return r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null;
    };
    const header = document.querySelector('[data-testid="app-header"]');
    const h1 = header?.querySelector('h1') ?? null;
    const stream = header?.querySelector('[data-testid="open-stream"]') ?? null;
    const screens =
      [...(header?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Screens') ?? null;
    const live = document.querySelector('[data-testid="live-status"]');
    const underline = document.querySelector('[role="tab"][aria-selected="true"] [data-glide]');
    // The chosen playlist's row: the element that draws its edge.
    let row: Element | null = document.querySelector('[data-testid="playlist-node"][aria-current="true"]');
    while (row && getComputedStyle(row).borderTopWidth === '0px') row = row.parentElement;
    const heading = document.querySelector(panelHeading);
    return {
      header: [
        css(header, 'background-color'),
        css(header, 'color'),
        css(header, 'border-bottom-color'),
        box(header),
      ],
      name: [css(h1, 'color'), box(h1)],
      stream: [css(stream, 'color'), css(stream, 'background-color'), box(stream)],
      screens: [
        css(screens, 'color'),
        css(screens, 'border-top-color'),
        css(screens, 'background-color'),
        box(screens),
      ],
      live: [css(live, 'color'), box(live)],
      underline: [css(underline, 'background-color')],
      row: [css(row, 'border-top-color'), css(row, 'background-color')],
      heading: [css(heading, 'color')],
      // What comes under the header: where the first panel sits (a band of 0 px must move nothing).
      under: box(document.querySelector('section')),
      headingText: heading?.textContent ?? null,
    };
  }, panelHeading);
}

for (const a of [BLACK, WHITE]) {
  test(`${a.name} draws exactly as at 9ed5d00: header, chosen tab and row, headings, and where everything sits`, async () => {
    const { app } = await launchApp();
    const win = await operatorPage(app);
    await operatorReady(win);
    await chooseMenuItem(app, `appearance-${a.id}`);
    await expect(win.locator('html')).toHaveAttribute('data-appearance', a.id);
    await inAShow(win);
    const now = await fingerprint(win);
    console.info(`${a.name}: ${JSON.stringify(now)}`);
    expect(now).toEqual(AT_9ED5D00[a.id]);
    await app.close();
  });
}
