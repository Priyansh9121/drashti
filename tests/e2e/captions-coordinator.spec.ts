import { expect, test } from '@playwright/test';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import { chooseMenuItem, launchApp, NO_PLACEHOLDERS, operatorPage, operatorReady, outputPages, setUpScreen, type PageGlobals } from './helpers';

/* Alpha.22: written now; run only after alpha.21 PUBLISHED. Manual generated events, no sound/model/download. */
test('the operator can rehearse provisional, settled and corrected clauses; stale edits never reach the hall', async () => {
  const { app } = await launchApp({ ...NO_PLACEHOLDERS, DRASHTI_WINDOWED_OUTPUTS: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpScreen(win, 'Main Hall', 0);
    const hall = outputPages(app)[0]!;
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    await expect(dialog.getByTestId('captions-prototype-on')).toHaveAttribute('aria-checked', 'false');
    await expect(hall.getByTestId('captions')).toHaveCount(0);
    await dialog.getByTestId('captions-audience').click();
    await dialog.getByTestId('captions-prototype-on').click();
    await dialog.getByRole('button', { name: 'Next placeholder update' }).click();
    await expect(hall.getByTestId('captions')).toHaveText('The blue box');
    await expect(dialog.getByTestId('captions-review-status')).toContainText('Provisional');
    await dialog.getByRole('button', { name: 'Next placeholder update' }).click();
    await expect(hall.getByTestId('captions')).toHaveText('The green box moves beside a round shape.');
    await dialog.getByRole('button', { name: 'Correct last phrase…' }).click();
    await dialog.getByLabel('Corrected phrase').fill('The red box stays beside a round shape.');
    await dialog.getByRole('button', { name: 'Apply correction' }).click();
    await expect(hall.getByTestId('captions')).toHaveText('The red box stays beside a round shape.');
    await expect(dialog.getByTestId('captions-review-status')).toContainText('Corrected');

    // A draft open while the recognizer restarts must be refused, even though the phrase id repeats.
    const old = await win.evaluate(() => (globalThis as PageGlobals).drashti.captions.prototypeView());
    await dialog.getByRole('button', { name: 'Correct last phrase…' }).click();
    await dialog.getByLabel('Corrected phrase').fill('Old session words');
    await dialog.getByRole('button', { name: 'Restart placeholders' }).click();
    await expect(dialog.getByLabel('Corrected phrase')).toHaveCount(0);
    const refused = await win.evaluate(async review => {
      const d = (globalThis as PageGlobals).drashti;
      return d.captions.correctPrototype({ ...review.current!, text: 'Old session words' });
    }, old);
    expect(refused).toBe(false);
    await expect(hall.getByTestId('captions')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Next placeholder update' }).click();
    await dialog.getByRole('button', { name: 'Next placeholder update' }).click();
    await expect(hall.getByTestId('captions')).toHaveText('The green box moves beside a round shape.');

    // Long wide glyphs must actually fit, not just be clipped to an estimated character count.
    await dialog.getByRole('button', { name: 'Correct last phrase…' }).click();
    await dialog.getByLabel('Corrected phrase').fill('W'.repeat(250));
    await dialog.getByRole('button', { name: 'Apply correction' }).click();
    await expect(hall.getByTestId('captions').locator(':scope > div > div')).toHaveCount(2);
    await expect.poll(() => hall.getByTestId('captions').locator(':scope > div > div').evaluateAll(lines => lines.every(line => line.scrollWidth <= line.clientWidth))).toBe(true);
    await expectFits(hall.getByTestId('captions'), 'the two-line clause on the hall');
    for (const width of [1024, 1280]) {
      await win.setViewportSize({ width, height: width === 1024 ? 645 : 720 });
      await expectFits(dialog, 'caption correction controls');
    }
    await expectNoSeriousA11yIssues(win, 'caption correction controls');
    expect(JSON.stringify(await win.evaluate(() => (globalThis as PageGlobals).drashti.captions.view()))).not.toContain('WWWW');

    await dialog.getByRole('button', { name: 'Dismiss phrase', exact: true }).click();
    await expect(hall.getByTestId('captions')).toHaveCount(0);
    await dialog.getByTestId('captions-prototype-on').click();
    await expect(dialog.getByTestId('captions-prototype-on')).toHaveAttribute('aria-checked', 'false');
    await expect(dialog.getByTestId('captions-on')).toHaveAttribute('aria-checked', 'false');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
    await expect.poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode())).toBe('simple');
    expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.captions.prototypeView())).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.captions.setPrototypeOn(true))).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  } finally { await app.close(); }
});
