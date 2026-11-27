import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { manualChapter } from '../../src/shared/manual';
import { PANEL_HELP } from '../../src/shared/panel-help';
import { expectNoSeriousA11yIssues } from './a11y';
import { NETWORK_ENV, networkOn } from './devices';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  openAllSections,
  openLibrary,
  operatorPage,
  operatorReady,
  slidesOf,
} from './helpers';
import { helpOn, settledRead } from './help';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';
import { CI_WINDOW } from './window-size';

/*
 * "What is this?" on the operator panels (Session 25): the ? on a panel's heading opens its two or
 * three sentences, never over the show controls (since alpha.24, helpcards: in a card over the window, beside its ?'s
 * column in the middle or under its ?, so nothing moves; in the flow under the heading until then); Got it (or Esc)
 * closes them and gives the keyboard back to the ?. Pro Mode only. Open the manual (x37, the owner's "Yes, A" to Q60-25: Read more
 * until then) opens the Drashti Manual at that panel's chapter.
 */

/** Open the placeholder playlist and put the kirtan's second slide live. */
async function showRunning(win: Page) {
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  // Its slides are rows under its name (Session 55).
  await slidesOf(win, KIRTAN).nth(1).click();
  await expect(win.getByTestId('live-text')).toContainText(`${KIRTAN} · slide 2 of 5`);
}

test('What is this? opens a panel’s words by its heading, never over the show controls', async () => {
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await helpOn(win);
  // A playlist open, and the network on, so the open playlist's and Announcements' ? show (Sessions 31–36).
  await setUpPlaceholderShow(win);
  await networkOn(win);
  await showRunning(win);

  // Every panel and column heading has its ?, one each (each section under LIVE has its own on its heading, folded
  // or not: alpha.22), and the places added in Sessions 31–36.
  // The library's is in its sheet (Session 44).
  await openLibrary(win);
  for (const id of Object.keys(PANEL_HELP)) {
    if (id === 'slides') continue; // the slide grid's heading shows once something is chosen
    await expect(win.getByTestId(`what-is-this-${id}`)).toHaveCount(1);
  }

  // (Looks' was the one asked here until Session 55 took Looks out.)
  const ask = win.getByTestId('what-is-this-messages');
  await expect(ask).toHaveAccessibleName('What is this? Messages');
  await ask.click();
  const card = win.getByTestId('what-is-this');
  await expect(card).toContainText(PANEL_HELP.messages.text);
  await expect(card.getByRole('button', { name: 'Got it' })).toBeFocused();
  await expect(ask).toHaveAttribute('aria-expanded', 'true');
  await expectNoSeriousA11yIssues(win, 'a panel’s What is this?');
  // Over the window in the middle, by its heading: the show controls along the bottom are still what is at their middle.
  const covered = await win
    .getByTestId('layer-bar')
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons
        .filter((b) => {
          const r = b.getBoundingClientRect();
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return at !== null && !b.contains(at);
        })
        .map((b) => b.textContent),
    );
  expect(covered).toEqual([]);
  // Got it closes it, and the keyboard is back on the ?.
  await win.keyboard.press('Enter');
  await expect(card).toHaveCount(0);
  await expect(ask).toBeFocused();
  // Esc closes it too.
  await win.keyboard.press('Enter');
  await expect(card).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(ask).toBeFocused();

  // Simple Mode has none.
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.locator('[data-testid^="what-is-this"]')).toHaveCount(0);
  await app.close();
});

test('Open the manual opens the Drashti Manual at the panel’s chapter, at its feature; Esc closes it, and Space moves the show at once (x37, the owner’s “Yes, A”)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await helpOn(win);
  await setUpPlaceholderShow(win);
  await showRunning(win);
  // Next and Back's words, in their place, then Open the manual (Read more until x37).
  await win.getByTestId('what-is-this-nextback').click();
  const card = win.getByTestId('what-is-this');
  await expect(card).toContainText(PANEL_HELP.nextback.text);
  await expect(card.getByRole('button', { name: 'Read more' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Open the manual' }).click();
  const manual = win.getByTestId('manual');
  await expect(manual).toBeVisible();
  // At its chapter, the feature marked and in view.
  await expect(manual.getByRole('heading', { level: 1 })).toHaveText(
    manualChapter(PANEL_HELP.nextback.chapter).title,
  );
  const shown = manual.locator('[data-passage][data-current="true"]');
  await expect(shown).toHaveText(PANEL_HELP.nextback.feature);
  await expect(shown).toBeInViewport();
  // The show waits while the manual is open...
  await win.keyboard.press('Space');
  await expect(win.getByTestId('live-text')).toContainText(`${KIRTAN} · slide 2 of 5`);
  // ...Esc closes it, and Space moves the show straight after.
  await win.keyboard.press('Escape');
  await expect(manual).toBeHidden();
  await win.keyboard.press('Space');
  await expect(win.getByTestId('live-text')).toContainText(`${KIRTAN} · slide 3 of 5`);
  // Got it puts Next and Back's words away (one card open at a time below).
  await card.getByRole('button', { name: 'Got it' }).click();
  await expect(card).toHaveCount(0);
  // Another panel's, in another chapter: Messages.
  await win.getByTestId('what-is-this-messages').click();
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(PANEL_HELP.messages.text);
  await card.getByRole('button', { name: 'Open the manual' }).click();
  await expect(manual.getByRole('heading', { level: 1 })).toHaveText(
    manualChapter(PANEL_HELP.messages.chapter).title,
  );
  await expect(shown).toHaveText(PANEL_HELP.messages.feature);
  await expect(shown).toBeInViewport();
  await win.keyboard.press('Escape');
  await expect(manual).toBeHidden();
  await app.close();
});

/** The controls of a target: what fit.ts counts as one. */
const CONTROLS =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="combobox"], [role="spinbutton"]';

/**
 * Where everything a card could move is: the top bar, the three columns, LIVE's picture and its parts, the quick bar,
 * the bottom bar and the status bar as wholes, and every control in the columns and the bottom bar (but the card's own).
 * The top bar's and the status bar's own controls are left out: their words come and go by themselves (a25 item 17).
 */
const layout = (win: Page) =>
  win.evaluate((controls) => {
    const out: string[] = [];
    const card = document.querySelector('[data-testid="what-is-this"]');
    const put = (what: string, el: Element) => {
      const r = el.getBoundingClientRect();
      out.push(
        `${what}: ${r.left.toFixed(1)}, ${r.top.toFixed(1)}, ${r.width.toFixed(1)} × ${r.height.toFixed(1)}`,
      );
    };
    const wholes = [
      'app-header',
      'column-left',
      'column-middle',
      'column-right',
      'live-preview',
      'live-still',
    ];
    for (const id of [...wholes, 'live-rest', 'quick-bar', 'layer-bar']) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (el && el.getClientRects().length > 0) put(id, el);
    }
    const status = document.querySelector('footer[aria-label="Status"]');
    if (status) put('the status bar', status);
    for (const zone of document.querySelectorAll('[data-zone]'))
      for (const el of zone.querySelectorAll(controls)) {
        if (card?.contains(el) || el.getClientRects().length === 0) continue;
        const name =
          el.getAttribute('data-testid') ??
          el.getAttribute('aria-label') ??
          el.textContent.trim().slice(0, 30);
        put(name, el);
      }
    return out;
  }, CONTROLS);

/** What is wrong with where the open card is: past the window, or over the top bar, LIVE's column or the bottom bar. */
const cardFaults = (win: Page) =>
  win.evaluate(() => {
    const boxOf = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
    const card = boxOf('[data-testid="what-is-this"]');
    if (!card) return ['no card'];
    const faults: string[] = [];
    const px = (n: number) => `${n.toFixed(1)} px`;
    if (card.left < 0 || card.right > innerWidth)
      faults.push(`past the window's side (${px(card.left)}, ${px(card.right)})`);
    if (card.top < 0 || card.bottom > innerHeight)
      faults.push(`past the window's top or foot (${px(card.top)})`);
    const header = boxOf('[data-testid="app-header"]');
    if (header && card.top < header.bottom - 0.5)
      faults.push(`over the top bar by ${px(header.bottom - card.top)}`);
    const bar = boxOf('[data-testid="layer-bar"]');
    if (bar && card.bottom > bar.top + 0.5)
      faults.push(`over the bottom bar by ${px(card.bottom - bar.top)}`);
    const live = boxOf('[data-testid="column-right"]');
    if (live && card.right > live.left + 0.5 && card.left < live.right - 0.5)
      faults.push(
        `over LIVE's column by ${px(Math.min(card.right, live.right) - Math.max(card.left, live.left))}`,
      );
    return faults;
  });

/** The window's layout once it holds still (two reads 50 ms apart the same): a scroll into view has been laid out. */
async function steadyLayout(win: Page): Promise<string[]> {
  let got: string[] = [];
  let last = '';
  await expect
    .poll(
      async () => {
        got = await layout(win);
        const now = JSON.stringify(got);
        const same = now === last;
        last = now;
        return same;
      },
      { message: 'the window holds still', intervals: [50] },
    )
    .toBe(true);
  return got;
}

test('every ? card is drawn over the window, not in it: nothing moves as it opens, and it is whole in sight in the middle, clear of the top bar, LIVE’s column and the bottom bar, at 1024 × 645 and 1410 × 900 (helpcards)', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await helpOn(win);
  // The open playlist's and Announcements' ? too, a slide up, every section under LIVE open (each has its ?), and a
  // pin in the quick bar (the bottom bar's card moved it 151-171 px: a25 item 22).
  await setUpPlaceholderShow(win);
  await networkOn(win);
  await showRunning(win);
  await openAllSections(win);
  const set = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.quickBar.set([
      { kind: 'message', templateId: 'placeholder-message-1', label: 'Placeholder hello' },
    ]),
  );
  expect(set.ok).toBe(true);
  await expect(win.getByTestId('quick-bar').getByRole('button')).toHaveCount(1);
  const card = win.getByTestId('what-is-this');
  for (const size of [CI_WINDOW, { width: 1410, height: 900 }]) {
    const at = `${String(size.width)} × ${String(size.height)}`;
    await win.setViewportSize(size);
    await settledRead(win, size, () => layout(win), `the window at ${at}`);
    const ids = await win
      .locator('[data-what-is-this]')
      .evaluateAll((asks) =>
        asks.filter((a) => a.getClientRects().length > 0).map((a) => a.getAttribute('data-testid') ?? ''),
      );
    expect(ids.length, `the ? in the window at ${at}`).toBeGreaterThanOrEqual(15);
    for (const id of ids) {
      const where = `${id} at ${at}`;
      const ask = win.getByTestId(id);
      await ask.scrollIntoViewIfNeeded();
      const before = await steadyLayout(win);
      await ask.click();
      await expect(card).toBeVisible();
      await expect(
        card.getByRole('button', { name: 'Got it' }),
        `${where}: the keyboard on Got it`,
      ).toBeFocused();
      // Over the window, not in it: nothing moves (a25 items 20 and 22), then or after.
      expect(await layout(win), `${where}: nothing moves as its card opens`).toEqual(before);
      await holdStill(
        async () => JSON.stringify(await layout(win)) === JSON.stringify(before),
        300,
        `${where}: nothing moves while its card is open`,
      );
      // Whole in sight (Stage's had its top under the top bar at 1024 × 645: a25 item 26), in the middle.
      expect(await cardFaults(win), `${where}: its card whole in sight, in the middle`).toEqual([]);
      // Its name said once: no description repeating it (a25 item 37).
      await expect(ask, `${where}: no description repeating its name`).toHaveAccessibleDescription('');
      await win.keyboard.press('Escape');
      await expect(card).toHaveCount(0);
      await expect(ask, `${where}: the keyboard back on its ?`).toBeFocused();
    }
  }
  await app.close();
});

test('the keyboard and a ? card: in and out of it beside its ?, a click elsewhere closes it, and Help › Show Help off puts the keyboard on the Help switch, never on nothing (helpcards)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await helpOn(win);
  const help = win.getByTestId('help-toggle');
  const ask = win.getByTestId('what-is-this-live');
  const card = win.getByTestId('what-is-this');
  const manual = card.getByRole('button', { name: 'Open the manual' });
  const gotIt = card.getByRole('button', { name: 'Got it' });

  // By the keyboard: the card's buttons come straight after its ? (wherever the card is drawn), both ways.
  await ask.focus();
  await win.keyboard.press('Enter');
  await expect(gotIt).toBeFocused();
  await win.keyboard.press('Shift+Tab');
  await expect(manual).toBeFocused();
  await win.keyboard.press('Shift+Tab');
  await expect(ask).toBeFocused();
  await win.keyboard.press('Tab');
  await expect(manual).toBeFocused();
  await win.keyboard.press('Tab');
  await expect(gotIt).toBeFocused();
  // Out of it: on to what follows the ? in LIVE's column, and back into the card from there.
  await win.keyboard.press('Tab');
  const after = await win.evaluate(() => {
    const at = document.activeElement;
    return {
      body: at === document.body,
      inCard: document.querySelector('[data-testid="what-is-this"]')?.contains(at) ?? false,
      inLive: document.querySelector('[data-testid="column-right"]')?.contains(at) ?? false,
    };
  });
  expect(after, 'Tab from Got it: on to what follows the ?, in LIVE’s column').toEqual({
    body: false,
    inCard: false,
    inLive: true,
  });
  await expect(card, 'the card stays open as the keyboard passes').toBeVisible();
  await win.keyboard.press('Shift+Tab');
  await expect(gotIt).toBeFocused();

  // Help › Show Help off with the keyboard on Got it (a25 item 23): the card and every ? go, and the keyboard is on
  // the Help switch, which says Help is off.
  await chooseMenuItem(app, 'help-switch');
  await expect(help).toHaveAttribute('aria-pressed', 'false');
  await expect(card).toHaveCount(0);
  await expect(help, 'Help off by the menu: the keyboard on the Help switch').toBeFocused();
  // On again, the keyboard on a ? itself, and off by the menu: on the switch too.
  await chooseMenuItem(app, 'help-switch');
  await expect(help).toHaveAttribute('aria-pressed', 'true');
  await ask.focus();
  await chooseMenuItem(app, 'help-switch');
  await expect(help).toHaveAttribute('aria-pressed', 'false');
  await expect(help, 'Help off by the menu from a ?: the keyboard on the Help switch').toBeFocused();
  // The show's keys work from there at once.
  await expect(win.getByTestId('show-next')).toBeVisible();

  // By the pointer: its ? opens and closes it; a click anywhere else in the window closes it too.
  await help.click();
  await expect(help).toHaveAttribute('aria-pressed', 'true');
  await ask.click();
  await expect(card).toBeVisible();
  await ask.click();
  await expect(card).toHaveCount(0);
  await ask.click();
  await expect(card).toBeVisible();
  await card.getByText(PANEL_HELP.live.text).click();
  await expect(card, 'a click on its words keeps it open').toBeVisible();
  await win.locator('#live-preview-title').click();
  await expect(card, 'a click elsewhere in the window closes it').toHaveCount(0);
  await app.close();
});
