import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { BLACK, builtIn, WHITE } from '../../src/shared/appearance/appearances';
import { expectNoSeriousA11yIssues } from './a11y';
import { chooseMenuItem, launchApp, openLibrary, operatorPage, operatorReady } from './helpers';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

/*
 * More colourful appearances (Session 42): Dhaja and Tiranga draw their header and their band in their own
 * colours, with LIVE and the other states on a panel of their own in the header; the band is decoration only
 * (hidden from screen readers, no words) and goes in forced colours with the rest of the decoration; axe passes,
 * in Pro Mode and Simple Mode. Black and White draw exactly as at 9ed5d00 (the values below were read from that
 * build), whatever the colourful ones now draw. Placeholder content only.
 */

/** "#rrggbb" as getComputedStyle writes it. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((at) => String(parseInt(hex.slice(at, at + 2), 16))).join(', ')})`;

const style = (l: Locator, prop: string) =>
  l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

/** A show open, so there are tabs, a chosen row and headings to see (the tabs in the library's sheet, Session 44). */
async function inAShow(win: Page) {
  await win.setViewportSize({ width: 1280, height: 720 });
  await setUpPlaceholderShow(win);
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await win.getByTestId('playlist-item').filter({ hasText: KIRTAN }).click();
  await openLibrary(win);
}

/** A panel's heading (a group's heading is in the words' own colour). */
const PANEL_HEADING = 'section > header > :is(h2, h3).text-2xs';

/** The band's blocks: each one's colour and width. */
const bandBlocks = (win: Page) =>
  win.locator('[data-band] > span').evaluateAll((spans) =>
    spans.map((s) => ({
      colour: getComputedStyle(s).backgroundColor,
      width: s.getBoundingClientRect().width,
    })),
  );

for (const id of ['dhaja', 'tiranga']) {
  test(`${id}: its header and band in its colours, the states on a panel, the band hidden from screen readers; axe passes; forced colours take the decoration away`, async () => {
    test.setTimeout(120_000);
    const a = builtIn(id);
    if (!a) throw new Error(`${id} is not a built-in appearance`);
    const { app } = await launchApp();
    const win = await operatorPage(app);
    await operatorReady(win);
    await chooseMenuItem(app, `appearance-${id}`);
    await expect(win.locator('html')).toHaveAttribute('data-appearance', id);
    await inAShow(win);
    const d = a.decoration;
    const header = win.getByTestId('app-header');
    expect(await style(header, 'background-color')).toBe(rgb(d.header));
    expect(await style(header.getByRole('heading', { level: 1 }), 'color')).toBe(rgb(d['on-header']));
    expect(await style(header.getByTestId('open-stream'), 'color')).toBe(rgb(d['on-header-muted']));
    // What is this?: its words and its edge in the header's own.
    const help = header.getByTestId('what-is-this-stream');
    expect(await style(help, 'color')).toBe(rgb(d['on-header-muted']));
    expect(await style(help, 'border-top-color')).toBe(rgb(d['header-field']));
    // LIVE, ON AIR and the network are read on the appearance's panel, never on the header's colour.
    expect(await style(win.getByTestId('header-states'), 'background-color')).toBe(rgb(a.colours.panel));
    await expect(win.getByTestId('header-states').getByTestId('live-status')).toBeVisible();

    // The band: its colours side by side, 6 px tall, under the header; no words, and hidden from screen readers.
    const band = win.locator('[data-band]');
    await expect(band).toHaveAttribute('aria-hidden', 'true');
    await expect(band).toHaveText('');
    expect((await band.boundingBox())?.height).toBe(6);
    const blocks = await bandBlocks(win);
    expect(blocks.filter((b) => b.width > 0).map((b) => b.colour)).toEqual(d.band.map(rgb));
    const widths = blocks.filter((b) => b.width > 0).map((b) => b.width);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);

    // The second colour marks the chosen tab and the chosen row; headings are in theirs.
    const tab = win.locator('[role="tab"][aria-selected="true"] [data-glide]').first();
    expect(await style(tab, 'background-color')).toBe(rgb(d.second));
    expect(await style(win.locator(PANEL_HEADING).first(), 'color')).toBe(rgb(d.heading));

    await expectNoSeriousA11yIssues(win, `${id}: Pro Mode in a show`);
    await win.getByRole('button', { name: 'Simple Mode' }).click();
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    expect(await style(win.getByTestId('simple-mode').locator('header').first(), 'background-color')).toBe(
      rgb(d.header),
    );
    await expect(win.locator('[data-band]')).toBeVisible();
    await expectNoSeriousA11yIssues(win, `${id}: Simple Mode`);

    // Forced colours (a Windows contrast theme): the system's colours, no band.
    await win.emulateMedia({ forcedColors: 'active' });
    await win.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    await expect(win.locator('[data-band]')).toBeHidden();
    expect(
      await style(win.getByTestId('simple-mode').locator('header').first(), 'background-color'),
    ).not.toBe(rgb(d.header));
    await expectNoSeriousA11yIssues(win, `${id}: Simple Mode in forced colours`, undefined, [
      'color-contrast',
    ]);
    await win.emulateMedia({ forcedColors: 'none' });
    await app.close();
  });
}

/*
 * Black and White as at 9ed5d00: what the header, the chosen tab, the chosen row and a heading draw, and where
 * the header's parts sit. Read from that build (this test's first version, run against it with
 * DRASHTI_E2E_APP_DIR) and written here; this build must draw the same. Session 44 moved one thing on purpose:
 * the left column is one section now (the playlists have it all, the library in a sheet over them), so the
 * first section under the header is the whole column, 587 px tall at 1280 by 720 (247 before).
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
    under: [0, 48, 300, 587],
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
    under: [0, 48, 300, 587],
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

/*
 * Real colour (Session 44): each zone in its own colours (the left column, the middle, the right column, the layer
 * bar), the header and the panels' title strips in their gradients, and the layer buttons in theirs, lit with LIVE's
 * edge; Black and White draw them all as before. Read from the page as it draws them.
 */
async function zonesDrawn(win: Page) {
  return win.evaluate(() => {
    const css = (sel: string, p: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).getPropertyValue(p) : null;
    };
    const lit = '[data-testid="layer-bar"] [data-lit="true"]';
    const unlit = '[data-testid="layer-bar"] [data-show-control]:disabled';
    return {
      left: css('[data-testid="column-left"]', 'background-color'),
      middle: css('[data-testid="column-middle"]', 'background-color'),
      right: css('[data-testid="column-right"]', 'background-color'),
      bar: css('[data-testid="layer-bar"]', 'background-color'),
      header: css('[data-testid="app-header"]', 'background-image'),
      strip: css('[data-testid="open-playlist"] [data-strip]', 'background-image'),
      lit: [css(lit, 'background-color'), css(lit, 'border-top-color')],
      unlit: css(unlit, 'border-top-color'),
    };
  });
}

for (const id of ['saffron', 'holi', 'black', 'white']) {
  test(`${id}: each zone, the header, the title strips and the layer buttons in its colours (Session 44)`, async () => {
    const a = builtIn(id);
    if (!a) throw new Error(`${id} is not a built-in appearance`);
    const { app } = await launchApp();
    const win = await operatorPage(app);
    await operatorReady(win);
    await chooseMenuItem(app, `appearance-${id}`);
    await expect(win.locator('html')).toHaveAttribute('data-appearance', id);
    await inAShow(win);
    await win.getByTestId('library-close').click();
    // A slide live: the slide layer's button is lit.
    await win.getByTestId('slide-thumb').first().click();
    await expect(win.getByTestId('layer-bar').locator('[data-lit="true"]')).toHaveCount(1);
    const d = a.decoration;
    const gradient = (from: string, to: string) => `linear-gradient(90deg, ${rgb(from)}, ${rgb(to)})`;
    const plain = id === 'black' || id === 'white';
    expect(await zonesDrawn(win)).toEqual({
      left: rgb(a.zones.left.panel),
      middle: rgb(a.zones.middle.ink),
      right: rgb(a.zones.right.panel),
      bar: rgb(a.zones.bar.panel),
      header: plain ? 'none' : gradient(d.header, d['header-2']),
      strip: plain ? 'none' : gradient(d.strip, d['strip-2']),
      lit: [rgb(d.layer), rgb(a.colours.live)],
      unlit: rgb(d['layer-edge']),
    });
    if (plain) {
      // As before: the columns and the bar in the panel, the middle the window's own, nothing else drawn.
      expect(a.zones.left.panel).toBe(a.colours.panel);
      expect(a.zones.middle.ink).toBe(a.colours.ink);
      expect(d.layer).toBe(a.colours['panel-2']);
      expect(d['layer-edge']).toBe(a.colours.line);
    } else {
      // Four zones, four colours.
      expect(
        new Set([a.zones.left.panel, a.zones.middle.ink, a.zones.right.panel, a.zones.bar.panel]).size,
      ).toBe(4);
    }
    await expectNoSeriousA11yIssues(win, `${id}: its zones in a show`);
    await app.close();
  });
}
