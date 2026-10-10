import { expect, test } from '@playwright/test';
import { PANEL_HELP } from '../../src/shared/panel-help';
import { expectNoSeriousA11yIssues } from './a11y';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';

/*
 * "What is this?" on the operator panels (Session 25): the ? on a panel's heading opens its two or
 * three sentences under the heading, never over the show controls; Got it (or Esc) closes them and
 * gives the keyboard back to the ?. Pro Mode only.
 */

test('What is this? opens a panel’s words under its heading, never over the show controls', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);

  // Every panel and column heading has its ?, one each.
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
