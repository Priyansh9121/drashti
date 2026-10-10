import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, outputPages, setUpScreen } from './helpers';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';

/*
 * Which languages each screen shows of a kirtan (Session 8): two audience
 * outputs and a stage output, each with its own, set in Screens. The words
 * close up with no gap and shrink-to-fit fits what is left; a slide that is
 * not a kirtan's shows in full everywhere; the live preview follows the
 * first audience group and says so, and thumbnails show every language.
 * The seeded sample kirtan and placeholder words only.
 */

/** The output showing this screen. */
async function outputFor(app: Parameters<typeof outputPages>[0], screenId: string): Promise<Page> {
  await expect
    .poll(async () => {
      for (const p of outputPages(app))
        if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) return true;
      return false;
    })
    .toBe(true);
  for (const p of outputPages(app))
    if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) return p;
  throw new Error(`no output for ${screenId}`);
}

/** The words of each text box on a screen's slide, and each line's language. */
const slideWords = (page: Page) =>
  page.locator('[data-layer="slide"] [data-slide-in] [data-element]').evaluateAll((boxes) =>
    boxes.map((b) => ({
      text: b.textContent.trim(),
      langs: [...b.querySelectorAll('[data-run]')].map((r) => r.getAttribute('data-lang')),
    })),
  );

test('each screen shows its own languages of a kirtan, closed up; other slides in full; the preview says whose', async () => {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '2' });
  const win = await operatorPage(app);
  const hallId = await setUpScreen(win, 'Hall', 0);
  const streamId = await setUpScreen(win, 'Stream', 1);
  const stageId = await setUpScreen(win, 'Stage', 2);
  await expect.poll(() => outputPages(app).length).toBe(3);

  // In Screens: the hall shows Gujarati then transliteration; the stream transliteration then English.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const groups = win.getByTestId('screen-group');
  const hall = groups.nth(0).getByTestId('language-picker');
  await hall.getByTestId('languages-some').check();
  await hall.getByRole('checkbox', { name: 'Hindi' }).uncheck();
  await hall.getByRole('checkbox', { name: 'English' }).uncheck();
  await expect(hall.getByTestId('language-row')).toHaveCount(4);
  const stream = groups.nth(1).getByTestId('language-picker');
  await stream.getByTestId('languages-some').check();
  await stream.getByRole('checkbox', { name: 'Gujarati' }).uncheck();
  await stream.getByRole('checkbox', { name: 'Hindi' }).uncheck();
  // Already transliteration then English; put English first, then back.
  await stream.getByRole('button', { name: 'Up: English' }).click();
  await stream.getByRole('button', { name: 'Down: English' }).click();
  // The stage: Gujarati only, and its stage view.
  const stage = groups.nth(2);
  await stage.getByTestId('group-role').selectOption('stage');
  await stage.getByTestId('languages-some').check();
  for (const name of ['Hindi', 'Transliteration', 'English'])
    await stage.getByTestId('language-picker').getByRole('checkbox', { name }).uncheck();
  // The last one ticked cannot be unticked: a group shows at least one language.
  await expect(
    stage.getByTestId('language-picker').getByRole('checkbox', { name: 'Gujarati' }),
  ).toBeDisabled();
  await expectNoSeriousA11yIssues(win, 'the Screens panel with languages chosen');
  await win.getByRole('button', { name: 'Close screens' }).click();
  // Each group's languages are its settings in the live Look (Standard).
  const chosen = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [snapshot, looks] = await Promise.all([d.screens.get(), d.looks.list()]);
    const live = looks.looks.find((l) => l.id === looks.liveId);
    return snapshot.groups.map((g) => [g.name, live?.groups[g.id]?.languages ?? null]);
  });
  expect(chosen).toEqual([
    ['Hall', ['gu', 'translit']],
    ['Stream', ['translit', 'en']],
    ['Stage', ['gu']],
  ]);

  // The sample kirtan's first slide: one box with Gujarati, Hindi, transliteration and English.
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Sample kirtan/ })
    .click();
  await win.getByTestId('slide-thumb').first().click();
  const [hallOut, streamOut, stageOut] = [
    await outputFor(app, hallId),
    await outputFor(app, streamId),
    await outputFor(app, stageId),
  ];
  await expect(hallOut.getByTestId('output-root')).toHaveAttribute('data-languages', 'gu,translit');
  await expect
    .poll(() => slideWords(hallOut))
    .toEqual([{ text: 'નમૂનાની પહેલી પંક્તિ\nNamūnānī pahelī paṅkti', langs: ['gu', 'translit'] }]);
  await expect
    .poll(() => slideWords(streamOut))
    .toEqual([{ text: 'Namūnānī pahelī paṅkti\nPlaceholder verse, first line', langs: ['translit', 'en'] }]);
  await expect(stageOut.getByTestId('stage-current')).toHaveText('નમૂનાની પહેલી પંક્તિ');

  // The live preview shows the first audience group's languages, and says so; thumbnails show every language.
  await expect(win.getByTestId('preview-languages')).toHaveText(
    'As “Hall” shows it: Gujarati, Transliteration',
  );
  await expect(win.getByTestId('live-preview').locator('[data-run]')).toHaveCount(2);
  await expect(win.getByTestId('slide-thumb').first().locator('[data-run]')).toHaveCount(4);

  // Shrink-to-fit fits what each screen has left, in a box 200 high: two lines shrink a little (each line
  // is as tall as the box's 92 px words), all four lines shrink more.
  const kirtanId = (await win.getByTestId('slide-grid').getAttribute('data-presentation-id')) ?? '';
  await win.evaluate(async (pid) => {
    const d = (globalThis as PageGlobals).drashti;
    const loaded = await d.library.slidesForEdit(pid);
    if (!loaded.ok) throw new Error(loaded.message);
    const first = loaded.doc.groups[0]?.slides[0]?.elements[0];
    if (first?.kind !== 'text') throw new Error('no box');
    first.frame = { ...first.frame, height: 200 };
    first.style = { ...first.style, shrinkToFit: true };
    const saved = await d.library.saveSlides(pid, loaded.doc, loaded.stamp, false);
    if (!saved.ok) throw new Error(saved.message);
  }, kirtanId);
  const fit = (page: Page) =>
    page
      .locator('[data-layer="slide"] [data-slide-in] [data-element]')
      .first()
      .evaluate((b) => Number(b.getAttribute('data-fit') ?? '1'));
  await expect.poll(() => fit(hallOut)).toBeLessThan(1);
  const hallTwo = await fit(hallOut);
  await expect.poll(() => fit(streamOut)).toBeLessThan(1);
  const all = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const snapshot = await d.screens.get();
    const g = snapshot.groups.find((x) => x.name === 'Hall');
    await d.screens.setGroupLanguages(g?.id ?? '', null);
    return true;
  });
  expect(all).toBe(true);
  await expect(hallOut.getByTestId('output-root')).toHaveAttribute('data-languages', 'all');
  await expect.poll(() => fit(hallOut)).toBeLessThan(hallTwo);
  await expect
    .poll(() => slideWords(hallOut))
    .toEqual([
      {
        text: 'નમૂનાની પહેલી પંક્તિ\nनमूने की पहली पंक्ति\nNamūnānī pahelī paṅkti\nPlaceholder verse, first line',
        langs: ['gu', 'hi', 'translit', 'en'],
      },
    ]);

  // A slide that is not a kirtan's shows in full on every screen.
  await win.getByTestId('presentation-list').getByRole('button', { name: 'Language test slides' }).click();
  await win.getByTestId('slide-thumb').first().click();
  await expect.poll(async () => (await slideWords(streamOut)).length).toBe(4);
  await expect(stageOut.getByTestId('stage-current').locator('[data-stage-element]')).toHaveCount(4);
  await app.close();
});

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const)
  test(`the Screens panel with its languages fits at ${width} x ${height}`, async () => {
    const { app } = await launchApp();
    const win = await operatorPage(app);
    await win.setViewportSize({ width, height });
    await setUpScreen(win, 'Hall', 0);
    await win.getByRole('button', { name: 'Screens', exact: true }).click();
    await win.getByTestId('screen-group').first().getByTestId('languages-some').check();
    await expectFits(
      win.getByRole('dialog', { name: 'Screens' }),
      `the Screens panel at ${width} x ${height}`,
    );
    await app.close();
  });
