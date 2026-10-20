import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { plainWords } from '../../src/shared/guides';
import { PANEL_HELP } from '../../src/shared/panel-help';
import { expectNoSeriousA11yIssues } from './a11y';
import { NETWORK_ENV, networkOn } from './devices';
import {
  chooseMenuItem,
  launchApp,
  openLibrary,
  openMoreTools,
  operatorPage,
  operatorReady,
} from './helpers';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

/*
 * "What is this?" on the operator panels (Session 25): the ? on a panel's heading opens its two or
 * three sentences under the heading, never over the show controls; Got it (or Esc) closes them and
 * gives the keyboard back to the ?. Pro Mode only.
 */

/** Open the placeholder playlist and put the kirtan's second slide live. */
async function showRunning(win: Page) {
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await win.getByTestId('playlist-item').filter({ hasText: KIRTAN }).click();
  await win.getByTestId('slide-thumb').nth(1).click();
  await expect(win.getByTestId('live-text')).toContainText(`${KIRTAN} · slide 2 of 5`);
}

test('What is this? opens a panel’s words under its heading, never over the show controls', async () => {
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  // A playlist open, and the network on, so the open playlist's and Announcements' ? show (Sessions 31–36).
  await setUpPlaceholderShow(win);
  await networkOn(win);
  await showRunning(win);

  // Every panel and column heading has its ?, one each (Macros, Masks and the Idle rotation in More tools,
  // unfolded: Session 26a), and the places added in Sessions 31–36.
  await openMoreTools(win);
  // The library's is in its sheet (Session 44).
  await openLibrary(win);
  for (const id of Object.keys(PANEL_HELP)) {
    if (id === 'slides') continue; // the slide grid's heading shows once something is chosen
    await expect(win.getByTestId(`what-is-this-${id}`)).toHaveCount(1);
  }

  const ask = win.getByTestId('what-is-this-looks');
  await expect(ask).toHaveAccessibleName('What is this? Looks');
  await ask.click();
  const card = win.getByTestId('what-is-this');
  await expect(card).toContainText(PANEL_HELP.looks.text);
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

test('Read more opens the guide at the passage its words follow; Esc closes it, and Space moves the show at once (Sessions 31–36)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  await showRunning(win);
  // Next and Back's words, then Read more.
  await win.getByTestId('what-is-this-nextback').click();
  const card = win.getByTestId('what-is-this');
  await expect(card).toContainText(PANEL_HELP.nextback.text);
  await card.getByTestId('what-is-this-read-more').click();
  const guides = win.getByTestId('guides');
  await expect(guides).toBeVisible();
  const shown = guides.locator('[data-passage][data-current="true"]');
  await expect(shown).toContainText(plainWords(PANEL_HELP.nextback.guide));
  await expect(shown).toBeInViewport();
  // The show waits while the guides are open...
  await win.keyboard.press('Space');
  await expect(win.getByTestId('live-text')).toContainText(`${KIRTAN} · slide 2 of 5`);
  // ...Esc closes them, and Space moves the show straight after.
  await win.keyboard.press('Escape');
  await expect(guides).toBeHidden();
  await win.keyboard.press('Space');
  await expect(win.getByTestId('live-text')).toContainText(`${KIRTAN} · slide 3 of 5`);
  // A card whose words are in the admin's guide opens that guide.
  await openMoreTools(win);
  await win.getByTestId('what-is-this-masks').click();
  await win.getByTestId('what-is-this').getByTestId('what-is-this-read-more').click();
  await expect(guides.getByRole('tab', { name: 'Admin' })).toHaveAttribute('aria-selected', 'true');
  await expect(guides.locator('[data-passage][data-current="true"]')).toContainText(
    plainWords(PANEL_HELP.masks.guide),
  );
  await win.keyboard.press('Escape');
  await app.close();
});
