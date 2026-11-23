import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import {
  chooseMenuItem,
  launchApp,
  NO_PLACEHOLDERS,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  setUpScreen,
} from './helpers';

/*
 * Caption words (alpha.22): File › Live Captions… › Caption Words… (Pro Mode) keeps names and terms per language,
 * spelt as the captions should show them; a word heard close to one shows as written. The test switch
 * DRASHTI_TEST_SPEECH stands in for the engine (no sound, no model, no download) and "hears" invented placeholder
 * words, misspelt ("Zentroba" for "Zentrova", "Persan Q7" for "Person Q7"); never a real name, kirtan or scripture.
 * The list is kept in the library, imported and exported as a small CSV file through the system's dialogs (answered
 * by the test), and Simple Mode cannot see or change it.
 */

const OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
const SPEECH = { DRASHTI_TEST_SPEECH: 'alpha Zentroba beta|gamma Persan Q7 delta' };
const GU = 'ઝેન્ટ્રોવા';

const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
const openRoles = async (app: ElectronApplication) =>
  (await Promise.all(outputPages(app).map(roleOf))).sort();
const outputWith = async (app: ElectronApplication, role: string) => {
  for (const p of outputPages(app)) if ((await roleOf(p)) === role) return p;
  throw new Error(`No ${role} output is open`);
};

/** The hall's screen on the first display and the stage screen on the second. */
async function hallAndStage(win: Page, app: ElectronApplication): Promise<void> {
  await setUpScreen(win, 'Main Hall', 0);
  const stage = await setUpScreen(win, 'Stage', 1);
  await win.evaluate(async (screenId) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.screens.some((x) => x.id === screenId));
    const set = await d.screens.setGroupRole(group?.id ?? '', 'stage');
    if (!set.ok) throw new Error(set.message);
  }, stage);
  await expect.poll(() => openRoles(app)).toEqual(['audience', 'stage']);
}

test('caption words: a word heard close to one shows as written; kept in the library; imported and exported as CSV; Pro Mode only', async () => {
  test.setTimeout(180_000);
  const folder = mkdtempSync(join(tmpdir(), 'drashti-caption-words-e2e-'));
  const { app, userData } = await launchApp({ ...OUTPUTS, ...NO_PLACEHOLDERS, ...SPEECH });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await hallAndStage(win, app);
    const stage = await outputWith(app, 'stage');
    const captions = stage.getByTestId('captions');

    // Captions on, in English: the stand-in's words as heard.
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    await dialog.getByTestId('captions-language').selectOption('en');
    await dialog.getByTestId('captions-on').click();
    await expect(captions).toContainText('Zentroba', { timeout: 15_000 });

    // Caption Words…: empty at first, for the language captions listen in.
    await dialog.getByTestId('captions-words').click();
    const words = win.getByTestId('caption-words-dialog');
    await expect(words).toBeVisible();
    await expect(words.getByTestId('caption-words-language')).toHaveValue('en');
    await expect(words.getByTestId('caption-words-hints')).toHaveText('No English caption words yet.');
    await expect(words.getByTestId('caption-words-export')).toBeDisabled();

    // A word added: kept at once, given to the engine as a hint, and the word heard close to it shows as written.
    await words.getByTestId('caption-words-new').fill('Zentrova');
    await words.getByTestId('caption-words-add').click();
    await expect(words.getByTestId('caption-word')).toHaveText(['Zentrova']);
    await expect(words.getByTestId('caption-words-hints')).toHaveText(
      '1 English word, given to the captions engine as a hint.',
    );
    await expect(captions).toContainText('alpha Zentrova beta', { timeout: 15_000 });
    // A name of two words, fixed as a whole.
    await words.getByTestId('caption-words-new').fill('Person Q7');
    await words.getByTestId('caption-words-new').press('Enter');
    await expect(words.getByTestId('caption-word')).toHaveText(['Zentrova', 'Person Q7']);
    await expect(captions).toContainText('gamma Person Q7 delta', { timeout: 15_000 });

    // What cannot be kept says why, and keeps nothing.
    await words.getByTestId('caption-words-new').fill('Zentrova, Velmorin');
    await words.getByTestId('caption-words-add').click();
    await expect(words).toContainText('A comma or a double quote is not kept in a word.');
    await words.getByTestId('caption-words-new').fill('zentrova');
    await words.getByTestId('caption-words-add').click();
    await expect(words).toContainText('That word is in the English list already.');
    await expect(words.getByTestId('caption-word')).toHaveCount(2);

    // The most important first: the first ones are the engine's hints.
    await words.getByRole('button', { name: 'Move Person Q7 up' }).click();
    await expect(words.getByTestId('caption-word')).toHaveText(['Person Q7', 'Zentrova']);

    // Export…: the list as CSV where the admin chooses (the test answers the system's Save dialog).
    const saved = join(folder, 'Caption words.csv');
    await app.evaluate(({ dialog: d }, path) => {
      d.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, saved);
    await words.getByTestId('caption-words-export').click();
    await expect(words.getByTestId('caption-words-said')).toHaveText('Saved 2 words.');
    expect(readFileSync(saved, 'utf8')).toBe(
      '\uFEFFLanguage,Word\r\nEnglish,Person Q7\r\nEnglish,Zentrova\r\n',
    );

    // Import…: a file's words added to the list, and the line it could not read named.
    const list = join(folder, 'more words.csv');
    writeFileSync(list, `Language,Word\nGujarati,${GU}\nFrench,Velmorin\nEnglish,Zentrova\n`, 'utf8');
    await app.evaluate(({ dialog: d }, path) => {
      d.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
    }, list);
    await words.getByTestId('caption-words-import').click();
    await expect(words.getByTestId('caption-words-said')).toHaveText(
      'Added 1 word. 1 word was in the list already. 1 line could not be read; line 3: The language is not Gujarati, Hindi, Sanskrit or English.',
    );
    await words.getByTestId('caption-words-language').selectOption('gu');
    await expect(words.getByTestId('caption-word')).toHaveText([GU]);
    // Gujarati's hints start off (they did not help Gujarati on real speech); its spellings are fixed either way.
    await expect(words.getByTestId('caption-words-hints-on')).toHaveAttribute('aria-checked', 'false');
    await words.getByTestId('caption-words-hints-on').click();
    await expect(words.getByTestId('caption-words-hints-on')).toHaveAttribute('aria-checked', 'true');
    await words.getByTestId('caption-words-hints-on').click();
    await expect(words.getByTestId('caption-words-hints-on')).toHaveAttribute('aria-checked', 'false');
    await expect(words.getByTestId('caption-words-hints')).toHaveText(
      '1 Gujarati word, used when captions listen for Gujarati.',
    );

    // Readable in CI's operator window and at 1280 × 720, and nothing serious for a screen reader.
    for (const size of [
      { width: 1024, height: 645 },
      { width: 1280, height: 720 },
    ]) {
      await win.setViewportSize(size);
      await expectFits(words, `the Caption words dialog at ${String(size.width)} × ${String(size.height)}`);
    }
    await expectNoSeriousA11yIssues(win, 'Caption words');

    // A word removed: the word heard shows as heard again.
    await words.getByTestId('caption-words-language').selectOption('en');
    await words.getByRole('button', { name: 'Remove Zentrova' }).click();
    await expect(words.getByTestId('caption-word')).toHaveText(['Person Q7']);
    await expect(captions).toContainText('alpha Zentroba beta', { timeout: 15_000 });
    await words.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(words).toHaveCount(0);
    await expect(dialog).toBeVisible();
  } finally {
    await app.close();
  }

  // Kept in the library: there after a restart, and Simple Mode can neither see nor change it.
  const again = await launchApp({ ...NO_PLACEHOLDERS }, userData);
  try {
    const win = await operatorPage(again.app);
    await operatorReady(win);
    const view = await win.evaluate(() => (globalThis as PageGlobals).drashti.captionWords.view());
    expect(view.words).toEqual([
      { language: 'en', word: 'Person Q7' },
      { language: 'gu', word: GU },
    ]);
    await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
    await expect
      .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode()))
      .toBe('simple');
    const refused = await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      return { view: await d.captionWords.view(), set: await d.captionWords.set([]) };
    });
    expect(refused.view).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(refused.set).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  } finally {
    await again.app.close();
  }
});
