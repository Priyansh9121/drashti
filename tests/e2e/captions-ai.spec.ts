import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {
  chooseMenuItem,
  launchApp,
  NO_PLACEHOLDERS,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  setUpScreen,
  windowShowing,
} from './helpers';
import { chooseGujaratiOwnModel, importCaptionPack, placeholderCaptionPack } from './caption-ai-fixtures';

/*
 * Caption AI end to end (alpha.22, cap-integration): written now, run on CI only after the board says alpha.21
 * PUBLISHED. The test switch DRASHTI_TEST_SPEECH stands in for the recognizer (no sound, no model, no download): it
 * "hears" placeholder phrases in turn, each half then whole. The hall's screen on the first display, the stage on a
 * pretend second one, and the stream's page: the three places captions are drawn on this computer.
 */

const OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
const PHRASES = ['alpha beta gamma', 'delta epsilon zeta'];

const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
const outputWith = async (app: ElectronApplication, role: string): Promise<Page> => {
  for (const p of outputPages(app)) if ((await roleOf(p)) === role) return p;
  throw new Error(`No ${role} output is open`);
};

/** The hall, the stage and the stream's page, captions shown on the hall too. */
async function threePlaces(
  win: Page,
  app: ElectronApplication,
): Promise<{ hall: Page; stage: Page; stream: Page }> {
  await setUpScreen(win, 'Main Hall', 0);
  const stageId = await setUpScreen(win, 'Stage', 1);
  await win.evaluate(async (screenId) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.screens.some((x) => x.id === screenId));
    const set = await d.screens.setGroupRole(group?.id ?? '', 'stage');
    if (!set.ok) throw new Error(set.message);
  }, stageId);
  await expect
    .poll(async () => (await Promise.all(outputPages(app).map(roleOf))).sort())
    .toEqual(['audience', 'stage']);
  await win.getByTestId('open-stream').click();
  const stream = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
  await expect(stream.getByTestId('program-root')).toBeVisible();
  return { hall: await outputWith(app, 'audience'), stage: await outputWith(app, 'stage'), stream };
}

/**
 * Every set of lines a place has drawn since this was called, in order (each line its own element; "" when none):
 * kept by the page itself, so a band shown for only a few hundred milliseconds is never missed by polling.
 */
async function recordLines(p: Page): Promise<() => Promise<string[]>> {
  await p.evaluate(() => {
    const seen: string[] = [];
    (globalThis as unknown as { captionLines: string[] }).captionLines = seen;
    const note = (): void => {
      const lines = [...document.querySelectorAll('[data-testid="captions"] > div > div')].map(
        (l) => l.textContent,
      );
      const now = lines.join(' | ');
      if (seen.at(-1) !== now) seen.push(now);
    };
    new MutationObserver(note).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    note();
  });
  return () => p.evaluate(() => [...(globalThis as unknown as { captionLines: string[] }).captionLines]);
}

/** Forget what a place has drawn so far (recordLines keeps recording from now on). */
const forgetLines = (p: Page) =>
  p.evaluate(() => {
    (globalThis as unknown as { captionLines: string[] }).captionLines.length = 0;
  });

/** Gujarati placeholder phrases (coloured boxes and shapes), each a single line at Medium. */
const GU_PHRASES = ['લીલું ખોખું ગોળ આકાર પાસે છે', 'વાદળી ખોખું ડાબી બાજુ છે'];

test('caption AI off (the default): today’s captions exactly as now on the hall, the stage and the stream', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ ...OUTPUTS, ...NO_PLACEHOLDERS, DRASHTI_TEST_SPEECH: PHRASES.join('|') });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const places = await threePlaces(win, app);
    const watched = await Promise.all(
      [places.hall, places.stage, places.stream].map(async (page) => ({
        page,
        drawn: await recordLines(page),
      })),
    );
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    await dialog.getByTestId('captions-audience').click();
    await dialog.getByTestId('captions-on').click();
    await expect(dialog.getByTestId('captions-state')).toHaveText('Listening to the stream’s sound input.');
    // Today's roll-up: the phrase before stays above the one being heard ("alpha beta gamma | delta epsilon"),
    // which caption AI's coordinator never draws (it replaces a clause whole).
    const rollUp = /^(alpha beta gamma \| delta|delta epsilon zeta \| alpha)/u;
    for (const { page, drawn } of watched) {
      await expect
        .poll(async () => (await drawn()).some((lines) => rollUp.test(lines)), { timeout: 20_000 })
        .toBe(true);
      await expect(page.getByTestId('captions')).toHaveAttribute('data-source', 'live');
    }
    await expect(places.stream.getByTestId('captions')).toHaveAttribute('data-screen', 'stream');
    // Off: off every place at once.
    await dialog.getByTestId('captions-on').click();
    for (const p of [places.hall, places.stage, places.stream])
      await expect(p.getByTestId('captions')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('caption AI: the pack imported, Gujarati’s own model chosen: what is heard goes through the coordinator, one phrase at a time on the hall, the stage and the stream; a correction reaches all three; as heard again: today’s captions', async () => {
  test.setTimeout(180_000);
  const pack = placeholderCaptionPack();
  const { app } = await launchApp({
    ...OUTPUTS,
    ...NO_PLACEHOLDERS,
    DRASHTI_TEST_SPEECH: GU_PHRASES.join('|'),
    DRASHTI_TEST_SPEECH_ONCE: '1',
    DRASHTI_TEST_SPEECH_MODELS: pack.list,
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const places = await threePlaces(win, app);
    const watched = await Promise.all(
      [places.hall, places.stage, places.stream].map(async (page) => ({
        page,
        drawn: await recordLines(page),
      })),
    );
    // The model comes only with the pack (Help › Caption and Translation Models…).
    await importCaptionPack(app, win, pack.folder);
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    await dialog.getByTestId('captions-audience').click();
    await chooseGujaratiOwnModel(app, dialog);
    for (const { page } of watched) await forgetLines(page);
    await dialog.getByTestId('captions-on').click();
    await expect(dialog.getByTestId('captions-state')).toHaveText('Listening to the stream’s sound input.');

    // Each phrase once: both reach every place, each alone (a phrase replaced whole), never today's roll-up.
    for (const { page, drawn } of watched) {
      await expect
        .poll(
          async () => {
            const all = await drawn();
            return GU_PHRASES.every((phrase) => all.includes(phrase));
          },
          { timeout: 20_000 },
        )
        .toBe(true);
      expect((await drawn()).filter((lines) => lines.includes(' | '))).toEqual([]);
      await expect(page.getByTestId('captions')).toHaveAttribute('lang', 'gu');
    }

    // The operator corrects the settled phrase on the screens: all three show the correction.
    await expect(dialog.getByTestId('captions-review-status')).toContainText('Settled');
    await dialog.getByRole('button', { name: 'Correct last phrase…' }).click();
    await dialog.getByLabel('Corrected phrase').fill('પીળું ખોખું ડાબી બાજુ છે');
    await dialog.getByRole('button', { name: 'Apply correction' }).click();
    for (const { page } of watched)
      await expect(page.getByTestId('captions')).toHaveText('પીળું ખોખું ડાબી બાજુ છે');
    await expect(dialog.getByTestId('captions-review-status')).toContainText('Corrected');
    // The status the dialog reads (and the API) never holds a word heard or corrected.
    expect(
      JSON.stringify(await win.evaluate(() => (globalThis as PageGlobals).drashti.captions.view())),
    ).not.toContain('ખોખું');

    // As heard again: today's captions (the stand-in heard its phrases once: say them again by turning on again).
    await dialog.getByTestId('captions-language').selectOption('auto');
    await expect(dialog.getByTestId('captions-review-status')).toHaveCount(0);
    await dialog.getByTestId('captions-on').click();
    for (const { page } of watched) await expect(page.getByTestId('captions')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('caption AI, Route C: Gujarati’s IndicConformer model from the pack is heard through its own route, one phrase at a time on the hall, the stage and the stream', async () => {
  test.setTimeout(180_000);
  const pack = placeholderCaptionPack({ conformer: true });
  const { app } = await launchApp({
    ...OUTPUTS,
    ...NO_PLACEHOLDERS,
    DRASHTI_TEST_SPEECH: GU_PHRASES.join('|'),
    DRASHTI_TEST_SPEECH_MODELS: pack.list,
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const places = await threePlaces(win, app);
    const watched = await Promise.all(
      [places.hall, places.stage, places.stream].map(async (page) => ({
        page,
        drawn: await recordLines(page),
      })),
    );
    await importCaptionPack(app, win, pack.folder);
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    await dialog.getByTestId('captions-audience').click();
    await chooseGujaratiOwnModel(app, dialog);
    for (const { page } of watched) await forgetLines(page);
    await dialog.getByTestId('captions-on').click();
    // Route C made its recognizer from the pack's three files (no "no checked model" refusal), and it hears.
    await expect(dialog.getByTestId('captions-state')).toHaveText('Listening to the stream’s sound input.');
    for (const { page, drawn } of watched) {
      await expect
        .poll(
          async () => {
            const all = await drawn();
            return GU_PHRASES.every((phrase) => all.includes(phrase));
          },
          { timeout: 20_000 },
        )
        .toBe(true);
      expect((await drawn()).filter((lines) => lines.includes(' | '))).toEqual([]);
      await expect(page.getByTestId('captions')).toHaveAttribute('lang', 'gu');
    }
    await dialog.getByTestId('captions-on').click();
    for (const { page } of watched) await expect(page.getByTestId('captions')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
