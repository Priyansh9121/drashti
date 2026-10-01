import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Template } from '../../src/main/import/testing/pp6-fixtures';
import { importAndGetIds, launchApp, operatorPage, outputPage, setUpScreen } from './helpers';

/*
 * Themes: a look per language, applied to a presentation (the live slide
 * changes at once, the words never), and undone. Placeholder words only.
 */

/** The size a run in this language is drawn at on the output. */
const sizeOf = (output: Page, lang: string) =>
  output
    .locator(`[data-layer="slide"] [data-run][data-lang="${lang}"]`)
    .evaluate((el) => getComputedStyle(el).fontSize);

test('a theme with a bigger Gujarati line and a smaller transliteration, applied and undone', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await setUpScreen(win);
  const output = await outputPage(app);

  // A presentation made in Drashti starts with the default theme.
  await win.getByRole('button', { name: 'New…' }).click();
  const editor = win.getByTestId('words-editor');
  await editor.getByRole('textbox', { name: 'Name' }).fill('Placeholder Themed Kirtan');
  await editor.getByTestId('words-text').fill('[Verse]\nનમૂના પંક્તિ\nNamūnā pankti\n');
  await editor.getByRole('button', { name: /Make slides/ }).click();
  const grid = win.getByTestId('slide-grid');
  await expect(grid.getByRole('heading', { level: 2 })).toHaveText('Placeholder Themed Kirtan');
  await grid.getByTestId('slide-thumb').first().click();
  await expect(output.locator('[data-layer="slide"]')).toHaveText(/નમૂના પંક્તિ\s*Namūnā pankti/);
  await expect.poll(() => sizeOf(output, 'gu')).toBe('88px');
  await expect.poll(() => sizeOf(output, 'translit')).toBe('60px');

  // A new theme: Gujarati 120, transliteration 40.
  await win.getByRole('button', { name: 'Themes', exact: true }).click();
  const panel = win.getByTestId('themes-panel');
  await panel.getByRole('button', { name: 'New theme' }).click();
  const themeEditor = panel.getByTestId('theme-editor');
  await expect(themeEditor.getByRole('textbox', { name: 'Theme name' })).toHaveValue('New theme');
  await themeEditor.getByRole('textbox', { name: 'Theme name' }).fill('Placeholder big Gujarati');
  await themeEditor.getByRole('spinbutton', { name: 'Gujarati size' }).fill('120');
  await themeEditor.getByRole('spinbutton', { name: 'Transliteration size' }).fill('40');
  await themeEditor.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByTestId('theme-item').filter({ hasText: 'Placeholder big Gujarati' })).toBeVisible();

  // Applied to the presentation: the live slide changes at once; the words stay.
  await themeEditor.getByRole('button', { name: 'Apply to 1 presentation' }).click();
  await expect(themeEditor).toContainText('Applied to 1 presentation.');
  await expect.poll(() => sizeOf(output, 'gu')).toBe('120px');
  await expect.poll(() => sizeOf(output, 'translit')).toBe('40px');
  await expect(output.locator('[data-layer="slide"]')).toHaveText(/નમૂના પંક્તિ\s*Namūnā pankti/);
  await panel.getByRole('button', { name: 'Close themes' }).click();

  // Undo puts the look back.
  const undo = win.getByTestId('undo-removal');
  await expect(undo).toContainText('Applied the theme “Placeholder big Gujarati” to 1 presentation');
  await undo.getByRole('button', { name: /Undo/ }).click();
  await expect.poll(() => sizeOf(output, 'gu')).toBe('88px');
  await expect.poll(() => sizeOf(output, 'translit')).toBe('60px');

  await app.close();
});

test('an imported template becomes a theme from its first text box', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-theme-template-'));
  const template = join(dir, 'Placeholder Evening Look.pro6Template');
  writeFileSync(
    template,
    pp6Template([
      {
        text: [
          {
            rtf: cocoaRtf([['Placeholder template line', 64, [255, 220, 0]]], 'ql'),
            rect: [100, 700, 1720, 300],
          },
        ],
      },
    ]),
  );
  await importAndGetIds(win, [template]);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Placeholder Evening Look/ })
    .click();
  await win.getByTestId('slide-grid').getByRole('button', { name: 'Make a theme from this' }).click();
  const panel = win.getByTestId('themes-panel');
  await expect(
    panel.getByTestId('theme-item').filter({ hasText: 'Placeholder Evening Look' }),
  ).toHaveAttribute('aria-current', 'true');
  const editor = panel.getByTestId('theme-editor');
  await expect(editor.getByRole('combobox', { name: 'Alignment', exact: true })).toHaveValue('left');
  await expect(editor.getByRole('spinbutton', { name: 'Box y' })).toHaveValue('64.8');
  await expect(editor.getByLabel('English colour')).toHaveValue('#ffdc00');
  await app.close();
});
