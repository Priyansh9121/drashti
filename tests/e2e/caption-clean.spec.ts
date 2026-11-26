import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  NO_PLACEHOLDERS,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  setUpScreen,
} from './helpers';

/*
 * Words left out of captions (alpha.24, QA24-CAPCLEAN-1; the owner: "sensor bad words accross all 4 languages. do
 * not show them"): a listed word never shows on the stage or the audience screens, not even for a moment, and a
 * clean word that holds one still shows; the Live Captions dialog counts the words left out since captions were
 * turned on; File › Live Captions… › Words Left Out… keeps the admin's own words per language, hidden in its list
 * until Show the words, and Simple Mode can neither see nor change them. The test switch DRASHTI_TEST_SPEECH stands
 * in for the engine and "hears" invented placeholder words; DRASHTI_TEST_CAPTION_CLEAN gives a test-only list taken
 * as Drashti's own (never in a packaged Drashti). Never a real bad word.
 */

const OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
const SPEECH = { DRASHTI_TEST_SPEECH: 'alpha zqvorn beta|gamma Qelmar delta zqvornish' };
const CLEAN = { DRASHTI_TEST_CAPTION_CLEAN: 'zqvorn' };
const LISTED = /(^|[^\p{L}])zqvorn([^\p{L}]|$)/iu;

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

/** The Live Captions dialog's count of words left out since captions were turned on. */
async function leftOut(dialog: Locator): Promise<number> {
  const text = (await dialog.getByTestId('captions-left-out').textContent()) ?? '';
  return text.startsWith('No words') ? 0 : Number(/^(\d+)/u.exec(text)?.[1] ?? Number.NaN);
}

test('words left out: never on a screen, counted, the admin’s own hidden until shown; kept in the library; Pro Mode only', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp({ ...OUTPUTS, ...NO_PLACEHOLDERS, ...SPEECH, ...CLEAN });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await hallAndStage(win, app);
    const stage = (await outputWith(app, 'stage')).getByTestId('captions');
    const hall = (await outputWith(app, 'audience')).getByTestId('captions');

    // Captions on, in English, on the audience screens too.
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    await dialog.getByTestId('captions-language').selectOption('en');
    await dialog.getByTestId('captions-audience').click();
    await expect(dialog.getByTestId('captions-left-out')).toHaveText(
      'No words left out since captions were turned on.',
    );
    await dialog.getByTestId('captions-on').click();

    // The listed word is left out whole; a clean word that holds it still shows.
    await expect(stage).toContainText('alpha beta', { timeout: 15_000 });
    await expect(stage).toContainText('gamma Qelmar delta zqvornish', { timeout: 15_000 });
    await expect(hall).toContainText('alpha beta', { timeout: 15_000 });
    // Not even for a moment, over a few of the stand-in's phrases (one every 1.5 s, each half then whole).
    await holdStill(
      async () =>
        ![...(await stage.allTextContents()), ...(await hall.allTextContents())].some((t) => LISTED.test(t)),
      5_000,
      'the listed word never shows on the stage or the audience screen',
    );
    await expect(dialog.getByTestId('captions-left-out')).toHaveText(
      /^[1-9]\d* words? left out since captions were turned on\.$/u,
    );

    // Words Left Out…: Drashti's own list said by its count only; none of the admin's own yet.
    await dialog.getByTestId('captions-clean').click();
    const clean = win.getByTestId('caption-clean-dialog');
    await expect(clean).toBeVisible();
    await expect(clean.getByTestId('caption-clean-language')).toHaveValue('en');
    await expect(clean.getByTestId('caption-clean-own')).toContainText('Drashti’s own list has');
    await expect(clean.getByTestId('caption-clean-count')).toHaveText('No English words of your own yet.');
    await expect(clean.getByTestId('caption-clean-export')).toBeDisabled();

    // A word of the admin's own: kept at once, hidden in the list, and left out of the captions from now.
    await clean.getByTestId('caption-clean-new').fill('Qelmar');
    await clean.getByTestId('caption-clean-add').click();
    await expect(clean.getByTestId('caption-clean-count')).toHaveText('1 English word of your own.');
    await expect(clean.getByTestId('caption-clean-word')).toHaveText(['Hidden word 1']);
    await expect(clean).not.toContainText('Qelmar');
    await expect(stage).toContainText('gamma delta zqvornish', { timeout: 15_000 });
    await expect(hall).toContainText('gamma delta zqvornish', { timeout: 15_000 });
    // The same word again, in any case, is there already; what cannot be kept says why.
    await clean.getByTestId('caption-clean-new').fill('QELMAR');
    await clean.getByTestId('caption-clean-add').click();
    await expect(clean).toContainText('That word is in the English list already.');
    await clean.getByTestId('caption-clean-new').fill('Qelmar, Velmorin');
    await clean.getByTestId('caption-clean-add').click();
    await expect(clean).toContainText('A comma or a double quote is not kept in a word.');
    await clean.getByTestId('caption-clean-new').fill('');

    // Shown only when asked for.
    await clean.getByTestId('caption-clean-show').click();
    await expect(clean.getByTestId('caption-clean-word')).toHaveText(['Qelmar']);

    // Readable in CI's operator window and at 1280 × 720, and nothing serious for a screen reader.
    for (const size of [
      { width: 1024, height: 645 },
      { width: 1280, height: 720 },
    ]) {
      await win.setViewportSize(size);
      await expectFits(clean, `the Words left out dialog at ${String(size.width)} × ${String(size.height)}`);
    }
    await expectNoSeriousA11yIssues(win, 'Words left out');

    // Closed and opened again: the words are hidden again.
    await clean.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(clean).toHaveCount(0);
    await dialog.getByTestId('captions-clean').click();
    await expect(clean.getByTestId('caption-clean-word')).toHaveText(['Hidden word 1']);

    // Taken off the list: shown again.
    await clean.getByRole('button', { name: 'Remove Hidden word 1' }).click();
    await expect(clean.getByTestId('caption-clean-count')).toHaveText('No English words of your own yet.');
    await expect(stage).toContainText('gamma Qelmar delta zqvornish', { timeout: 15_000 });
    await clean.getByTestId('caption-clean-new').fill('Velmorin');
    await clean.getByTestId('caption-clean-add').click();
    await clean.getByRole('button', { name: 'Close', exact: true }).click();

    // Off and on again: the count starts from nothing (the stand-in then leaves out one word every two phrases).
    const before = await leftOut(dialog);
    expect(before).toBeGreaterThanOrEqual(3);
    await dialog.getByTestId('captions-on').click();
    await expect(stage).toHaveCount(0, { timeout: 15_000 });
    await dialog.getByTestId('captions-on').click();
    await expect.poll(() => leftOut(dialog), { timeout: 15_000 }).toBeLessThan(before);
  } finally {
    await app.close();
  }

  // Kept in the library: there after a restart, and Simple Mode can neither see nor change it.
  const again = await launchApp({ ...NO_PLACEHOLDERS }, userData);
  try {
    const win = await operatorPage(again.app);
    await operatorReady(win);
    const view = await win.evaluate(() => (globalThis as PageGlobals).drashti.captionClean.view());
    expect(view.words).toEqual([{ language: 'en', word: 'Velmorin' }]);
    await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
    await expect
      .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode()))
      .toBe('simple');
    const refused = await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      return { view: await d.captionClean.view(), set: await d.captionClean.set([]) };
    });
    expect(refused.view).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(refused.set).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  } finally {
    await again.app.close();
  }
});
