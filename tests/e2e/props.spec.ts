import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importAndGetIds, launchApp, operatorPage, outputPage, setUpScreen } from './helpers';
import { makeTestImage } from './test-media';

/*
 * Props: a line of words and a picture that stay up whatever slide is live.
 * Placeholder words and a generated picture only.
 */

test('props stay up over changing slides, and come down when hidden', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-props-'));
  const logo = await makeTestImage(win, join(dir, 'Placeholder Logo.png'), {
    width: 200,
    height: 200,
    color: '#00897b',
  });
  await importAndGetIds(win, [logo]);
  await setUpScreen(win);
  const output = await outputPage(app);
  const propsLayer = output.locator('[data-layer="props"]');
  const panel = win.getByTestId('props');

  // A line of words along the bottom.
  await panel.getByRole('button', { name: 'New prop' }).click();
  const form = panel.getByTestId('prop-form');
  await form.getByRole('textbox', { name: 'Prop words' }).fill('Placeholder Mandir Name');
  await form.getByRole('button', { name: 'Save' }).click();
  // And the picture in a corner.
  await panel.getByRole('button', { name: 'New prop' }).click();
  await form.getByRole('radio', { name: 'Picture or video' }).check();
  await expect(form.getByRole('combobox', { name: 'Prop picture', exact: true })).toHaveValue(/.+/);
  await form.getByRole('button', { name: 'Save' }).click();
  const rows = panel.getByTestId('prop-row');
  await expect(rows).toHaveCount(2);

  // Shown over a slide, and still up after Next and after the slide is cleared.
  await rows.filter({ hasText: 'Placeholder Mandir Name' }).getByRole('button', { name: 'Show' }).click();
  await rows.filter({ hasText: 'Placeholder Logo.png' }).getByRole('button', { name: 'Show' }).click();
  await expect(propsLayer).toHaveCount(2);
  await expect(propsLayer.first()).toHaveText('Placeholder Mandir Name');
  await expect(propsLayer.nth(1).locator('img')).toHaveCount(1);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Language test slides/ })
    .click();
  await win.getByTestId('slide-grid').getByTestId('slide-thumb').first().click();
  const slideText = output.locator('[data-layer="slide"]');
  await expect(slideText).toContainText('Welcome to the test slide');
  await win.keyboard.press('ArrowRight');
  await expect(slideText).toContainText('Second test slide');
  await expect(propsLayer.first()).toHaveText('Placeholder Mandir Name');
  await win.keyboard.press('F2');
  await expect(slideText).toHaveCount(0);
  await expect(propsLayer).toHaveCount(2);

  // Hidden, one at a time; Clear props (F4) takes the rest.
  await rows.filter({ hasText: 'Placeholder Mandir Name' }).getByRole('button', { name: 'Hide' }).click();
  await expect(propsLayer).toHaveCount(1);
  await win.keyboard.press('F4');
  await expect(propsLayer).toHaveCount(0);
  await expect(rows.filter({ hasText: 'Placeholder Logo.png' })).not.toHaveAttribute('data-shown', 'true');
  await app.close();
});
