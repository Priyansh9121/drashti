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

/*
 * Captions in another language than the speaker's, end to end (alpha.24, QA24-CAPLANG-2; the owner's 2a-2c): a
 * Gujarati speaker with "Captions in" Hindi. The test switch DRASHTI_TEST_SPEECH stands in for the recogniser
 * (placeholder phrases, each half then whole; no sound, no model) and DRASHTI_TEST_TRANSLATE=1 for the translation
 * engine (x83's marked placeholder, never a translation): no pack and no program on CI. The hall's screen, the stage
 * on a pretend second display, and the stream's page: the audience screens and the stream show the translation only,
 * the stage the speaker's own words; back to "Same as the speaker", today's captions again.
 */

const OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
/** Gujarati placeholder phrases (coloured boxes and shapes), each a single line at Medium. */
const GU_PHRASES = ['લીલું ખોખું ગોળ આકાર પાસે છે', 'વાદળી ખોખું ડાબી બાજુ છે', 'બસ સવા આઠ વાગ્યે આવશે'];
const MARK = '[Test placeholder gu/hi:';

const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
const outputWith = async (app: ElectronApplication, role: string): Promise<Page> => {
  for (const p of outputPages(app)) if ((await roleOf(p)) === role) return p;
  throw new Error(`No ${role} output is open`);
};

/** The hall, the stage and the stream's page, each ready to draw (fonts in, warm-up over), as captions-ai.spec. */
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
  const places = { hall: await outputWith(app, 'audience'), stage: await outputWith(app, 'stage'), stream };
  for (const [page, root] of [
    [places.hall, 'output-root'],
    [places.stage, 'output-root'],
    [places.stream, 'program-root'],
  ] as const) {
    await expect(page.getByTestId(root)).toHaveAttribute('data-fonts', 'ready', { timeout: 30_000 });
    await expect(page.getByTestId(root)).not.toHaveAttribute('data-warm-up', 'warming', { timeout: 30_000 });
  }
  return places;
}

/** Every set of lines a place has drawn since this was called ("" when none), kept by the page itself. */
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

const forgetLines = (p: Page) =>
  p.evaluate(() => {
    (globalThis as unknown as { captionLines: string[] }).captionLines.length = 0;
  });

/** A Gujarati phrase's first word, as the stage draws it. */
const heardGujarati = (lines: string) => GU_PHRASES.some((p) => lines.includes(p.split(' ')[0] ?? p));

test('Captions in Hindi for a Gujarati speaker: the hall and the stream the translation only, the stage the speaker’s words', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({
    ...OUTPUTS,
    ...NO_PLACEHOLDERS,
    DRASHTI_TEST_SPEECH: GU_PHRASES.join('|'),
    DRASHTI_TEST_TRANSLATE: '1',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const places = await threePlaces(win, app);
    const hall = await recordLines(places.hall);
    const stage = await recordLines(places.stage);
    const stream = await recordLines(places.stream);
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    await dialog.getByTestId('captions-audience').click();
    await chooseMenuItem(app, 'speaker-language-gu');
    await expect(dialog.getByTestId('captions-language')).toHaveValue('gu');
    await chooseMenuItem(app, 'caption-language-hi');
    await dialog.getByTestId('captions-on').click();
    await expect(dialog.getByTestId('captions-state')).toHaveText('Listening to the stream’s sound input.');
    // The hall and the stream: the translation (the stand-in's marked placeholder of a Gujarati phrase), only.
    for (const drawn of [hall, stream]) {
      await expect
        .poll(async () => (await drawn()).some((lines) => lines.startsWith(MARK)), { timeout: 30_000 })
        .toBe(true);
      // Never the speaker's words by themselves (2b, 2c): every band drawn there is the translation, or none.
      expect((await drawn()).filter((lines) => lines !== '' && !lines.startsWith(MARK))).toEqual([]);
    }
    // A time said in words is translated as digits (2e): the stand-in shows what reached the engine.
    for (const drawn of [hall, stream])
      await expect
        .poll(
          async () =>
            (await drawn()).some((lines) => lines.startsWith(MARK) && lines.includes('8:15 વાગ્યે')),
          {
            timeout: 30_000,
          },
        )
        .toBe(true);
    // The stage: the speaker's own words, never the translation (its time as said).
    await expect.poll(async () => (await stage()).some(heardGujarati), { timeout: 30_000 }).toBe(true);
    expect((await stage()).filter((lines) => lines.includes(MARK))).toEqual([]);
    await expect
      .poll(async () => (await stage()).some((lines) => lines.includes('સવા આઠ')), { timeout: 30_000 })
      .toBe(true);
    await expect(places.stream.getByTestId('captions')).toHaveAttribute('data-source', 'live');
    // Back to the speaker's own words: the hall shows the Gujarati phrases again, untranslated.
    await chooseMenuItem(app, 'caption-language-same');
    await forgetLines(places.hall);
    await expect
      .poll(async () => (await hall()).some((lines) => heardGujarati(lines) && !lines.includes(MARK)), {
        timeout: 30_000,
      })
      .toBe(true);
    // Off: off every place at once.
    await dialog.getByTestId('captions-on').click();
    for (const p of [places.hall, places.stage, places.stream])
      await expect(p.getByTestId('captions')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
