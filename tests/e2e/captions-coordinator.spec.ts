import { expect, test } from '@playwright/test';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import { chooseGujaratiOwnModel, importCaptionPack, placeholderCaptionPack } from './caption-ai-fixtures';
import { expectFits } from './fit';
import {
  chooseMenuItem,
  launchApp,
  NO_PLACEHOLDERS,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  setUpScreen,
  type PageGlobals,
} from './helpers';

/*
 * Correcting caption AI's phrase (alpha.22; Codex x90's coordinator and panel, on caption AI's real path since the
 * lead's Q-CAPI-4 A: no placeholder rehearsal in the dialog). The stand-in recognizer hears one placeholder phrase
 * once; a placeholder Gujarati model from an offline pack makes Gujarati's captions caption AI's. No sound, no real
 * model, no download. Run on CI only.
 */
test('the operator corrects or dismisses the phrase on the screens; an edit from an earlier session is refused; a long correction fits two lines; back to today’s captions at their own size', async () => {
  test.setTimeout(180_000);
  const pack = placeholderCaptionPack();
  const { app } = await launchApp({
    ...NO_PLACEHOLDERS,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_TEST_SPEECH: 'લીલું ખોખું ગોળ આકાર પાસે છે',
    DRASHTI_TEST_SPEECH_ONCE: '1',
    DRASHTI_TEST_SPEECH_MODELS: pack.list,
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpScreen(win, 'Main Hall', 0);
    await expect.poll(() => outputPages(app).length).toBe(1);
    const [hall] = outputPages(app);
    if (!hall) throw new Error('No hall output is open');
    await outputReady(hall);
    await importCaptionPack(app, win, pack.folder);
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    // No placeholder rehearsal is offered, and no review shows before captions listen.
    await expect(dialog.getByTestId('captions-prototype-on')).toHaveCount(0);
    await expect(dialog.getByTestId('captions-review-status')).toHaveCount(0);
    await dialog.getByTestId('captions-audience').click();
    await chooseGujaratiOwnModel(app, dialog);
    await dialog.getByTestId('captions-on').click();
    await expect(hall.getByTestId('captions')).toHaveText('લીલું ખોખું ગોળ આકાર પાસે છે', {
      timeout: 15_000,
    });
    await expect(dialog.getByTestId('captions-review-status')).toContainText('Settled');

    // A correction replaces the phrase whole on the hall.
    await dialog.getByRole('button', { name: 'Correct last phrase…' }).click();
    await dialog.getByLabel('Corrected phrase').fill('વાદળી ખોખું ગોળ આકાર પાસે છે');
    await dialog.getByRole('button', { name: 'Apply correction' }).click();
    await expect(hall.getByTestId('captions')).toHaveText('વાદળી ખોખું ગોળ આકાર પાસે છે');
    await expect(dialog.getByTestId('captions-review-status')).toContainText('Corrected');

    // Long wide glyphs fit in two lines, measured, not clipped to an estimated count; the dialog fits and reads well.
    await dialog.getByRole('button', { name: 'Correct last phrase…' }).click();
    await dialog.getByLabel('Corrected phrase').fill('W'.repeat(70));
    await dialog.getByRole('button', { name: 'Apply correction' }).click();
    await expect(hall.getByTestId('captions').locator(':scope > div > div')).toHaveCount(2);
    await expect
      .poll(() =>
        hall
          .getByTestId('captions')
          .locator(':scope > div > div')
          .evaluateAll((lines) => lines.every((line) => line.scrollWidth <= line.clientWidth)),
      )
      .toBe(true);
    await expectFits(hall.getByTestId('captions'), 'the two-line phrase on the hall');
    for (const width of [1024, 1280]) {
      await win.setViewportSize({ width, height: width === 1024 ? 645 : 720 });
      await expectFits(dialog, 'caption correction controls');
    }
    await expectNoSeriousA11yIssues(win, 'caption correction controls');
    // The status the dialog reads never holds a word heard or corrected.
    expect(
      JSON.stringify(await win.evaluate(() => (globalThis as PageGlobals).drashti.captions.view())),
    ).not.toContain('WWWW');

    // Dismiss takes it off at once; an edit from this session is refused once captions start again (a new session).
    const before = await win.evaluate(() => (globalThis as PageGlobals).drashti.captions.prototypeView());
    await dialog.getByRole('button', { name: 'Dismiss phrase', exact: true }).click();
    await expect(hall.getByTestId('captions')).toHaveCount(0);
    await dialog.getByTestId('captions-on').click();
    await dialog.getByTestId('captions-on').click();
    await expect(hall.getByTestId('captions')).toHaveText('લીલું ખોખું ગોળ આકાર પાસે છે', {
      timeout: 15_000,
    });
    const refused = await win.evaluate(
      (review) =>
        review?.current
          ? (globalThis as PageGlobals).drashti.captions.correctPrototype({
              sessionId: review.current.sessionId,
              phraseId: review.current.phraseId,
              revision: review.current.revision,
              text: 'Old session words',
            })
          : Promise.resolve('no phrase'),
      before,
    );
    expect(refused).toBe(false);

    // As heard: today's captions, at their own configured size (no fitted size left on the band).
    const normalFont = await hall
      .getByTestId('captions')
      .locator(':scope > div')
      .evaluate((element) => getComputedStyle(element).fontSize);
    await dialog.getByTestId('captions-language').selectOption('auto');
    await dialog.getByTestId('captions-on').click();
    await dialog.getByTestId('captions-on').click();
    await expect(hall.getByTestId('captions')).toContainText('લીલું ખોખું', { timeout: 15_000 });
    await expect(hall.getByTestId('captions').locator(':scope > div')).toHaveCSS('font-size', normalFont);
    await dialog.getByTestId('captions-on').click();
    await expect(hall.getByTestId('captions')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    // Simple Mode: the review and corrections are refused.
    await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
    await expect
      .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode()))
      .toBe('simple');
    expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.captions.prototypeView())).toEqual({
      ok: false,
      message: SIMPLE_MODE_REFUSAL,
    });
  } finally {
    await app.close();
  }
});
