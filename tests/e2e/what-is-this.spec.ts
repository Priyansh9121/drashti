import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { manualChapter } from '../../src/shared/manual';
import { PANEL_HELP } from '../../src/shared/panel-help';
import { expectNoSeriousA11yIssues } from './a11y';
import { NETWORK_ENV, networkOn } from './devices';
import { chooseMenuItem, launchApp, openLibrary, operatorPage, operatorReady, slidesOf } from './helpers';
import { helpOn } from './help';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

/*
 * "What is this?" on the operator panels (Session 25): the ? on a panel's heading opens its two or
 * three sentences under the heading, never over the show controls; Got it (or Esc) closes them and
 * gives the keyboard back to the ?. Pro Mode only. Open the manual (x37, the owner's "Yes, A" to Q60-25: Read more
 * until then) opens the Drashti Manual at that panel's chapter.
 */

/** Open the placeholder playlist and put the kirtan's second slide live. */
async function showRunning(win: Page) {
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  // Its slides are rows under its name (Session 55).
  await slidesOf(win, KIRTAN).nth(1).click();
  await expect(win.getByTestId('live-text')).toContainText(`${KIRTAN} · slide 2 of 5`);
}

test('What is this? opens a panel’s words under its heading, never over the show controls', async () => {
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
  // In the panel's own space: the show controls along the bottom are still what is at their middle.
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
