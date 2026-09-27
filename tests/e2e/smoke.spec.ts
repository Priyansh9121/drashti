import { expect, test } from '@playwright/test';
import { TEST_LINES } from '../../src/main/db/seed';
import { launchApp } from './helpers';

/*
 * Smoke test (runs on macOS and Windows in CI): launch the app, give the
 * first display an output through the Screens panel, go live on slide 1,
 * and check the output window shows the slide's text.
 */
test('smoke: launch, go live on slide 1, the output window shows it', async () => {
  const { app } = await launchApp();
  const operator = await app.firstWindow();
  await expect(operator).toHaveTitle('Drashti');

  await operator.getByRole('button', { name: 'Screens', exact: true }).click();
  await operator.getByLabel('New group name').fill('Main Hall');
  await operator.getByRole('button', { name: 'Add group' }).click();
  await operator.getByTestId('display-row').first().getByRole('button', { name: 'Use this display' }).click();
  const output = await app.waitForEvent('window', { predicate: (w) => w.url().includes('output.html') });
  await operator.getByRole('button', { name: 'Close screens' }).click();

  await operator
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Language test slides/ })
    .click();
  await operator.getByTestId('slide-thumb').first().click();

  await expect(operator.getByTestId('live-text')).toHaveText('Live: Language test slides · slide 1 of 3');
  for (const [lang, text] of Object.entries(TEST_LINES)) {
    await expect(output.locator(`[data-lang="${lang}"]`)).toHaveText(text);
    await expect(output.locator(`[data-lang="${lang}"]`)).toBeVisible();
  }
  await app.close();
});
