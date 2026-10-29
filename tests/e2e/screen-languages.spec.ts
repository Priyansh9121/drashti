import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import {
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPages,
  setTicked,
  setUpScreen,
} from './helpers';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';

/*
 * Which languages each screen shows of a kirtan (Session 8): two audience
 * outputs and a stage output, each with its own, set in Screens. The words
 * close up with no gap and shrink-to-fit fits what is left; a slide that is
 * not a kirtan's shows in full everywhere; the live preview follows the
 * first audience group and says so, and thumbnails show every language.
 * Session 55 (Part 12): Looks are gone from the window, and the languages are
 * Screens' own (kept where Drashti kept them since Session 11, the library's
 * first Look); a library from before Looks still keeps each group's.
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
  // A lobby screen (an audience group of its own; the stream's group has no display).
  const streamId = await setUpScreen(win, 'Lobby', 1);
  const stageId = await setUpScreen(win, 'Stage', 2);
  await expect.poll(() => outputPages(app).length).toBe(3);

  // In Screens: the hall shows Gujarati then transliteration; the lobby transliteration then English.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const groups = win.getByTestId('screen-group');
  const hall = groups.nth(0).getByTestId('language-picker');
  await setTicked(hall.getByTestId('languages-some'), true);
  await setTicked(hall.getByRole('checkbox', { name: 'Hindi' }), false);
  await setTicked(hall.getByRole('checkbox', { name: 'English' }), false);
  await expect(hall.getByTestId('language-row')).toHaveCount(4);
  const stream = groups.nth(1).getByTestId('language-picker');
  await setTicked(stream.getByTestId('languages-some'), true);
  await setTicked(stream.getByRole('checkbox', { name: 'Gujarati' }), false);
  await setTicked(stream.getByRole('checkbox', { name: 'Hindi' }), false);
  // Already transliteration then English; put English first, then back.
  await stream.getByRole('button', { name: 'Up: English' }).click();
  await stream.getByRole('button', { name: 'Down: English' }).click();
  // The stage: Gujarati only, and its stage view.
  const stage = groups.nth(2);
  await stage.getByTestId('group-role').selectOption('stage');
  await setTicked(stage.getByTestId('languages-some'), true);
  for (const name of ['Hindi', 'Transliteration', 'English'])
    await setTicked(stage.getByTestId('language-picker').getByRole('checkbox', { name }), false);
  // The last one ticked cannot be unticked: a group shows at least one language.
  await expect(
    stage.getByTestId('language-picker').getByRole('checkbox', { name: 'Gujarati' }),
  ).toBeDisabled();
  await expectNoSeriousA11yIssues(win, 'the Screens panel with languages chosen');
  await win.getByRole('button', { name: 'Close screens' }).click();
  // Each group's languages, as Screens has them (Session 55: no Look any more).
  const chosen = await win.evaluate(async () => {
    const snapshot = await (globalThis as PageGlobals).drashti.screens.get();
    return snapshot.groups.map((g) => [g.name, g.languages ?? null]);
  });
  expect(chosen).toEqual([
    ['Hall', ['gu', 'translit']],
    ['Lobby', ['translit', 'en']],
    ['Stage', ['gu']],
    // The stream's own group (YouTube in Screens, Session 26): every language, as it started.
    ['Stream', null],
  ]);

  // The sample kirtan's first slide: one box with Gujarati, Hindi, transliteration and English.
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Sample kirtan/ })
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
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Language test slides/ })
    .click();
  await win.getByTestId('slide-thumb').first().click();
  await expect.poll(async () => (await slideWords(streamOut)).length).toBe(4);
  await expect(stageOut.getByTestId('stage-current').locator('[data-stage-element]')).toHaveCount(4);
  await app.close();
});

// And at CI's 1024 x 645 since Session 55, the languages on each group's card (Looks gone).
for (const [width, height] of [
  [1024, 645],
  [1280, 720],
  [1920, 1080],
] as const)
  test(`the Screens panel with its languages fits at ${width} x ${height}`, async () => {
    const { app } = await launchApp();
    const win = await operatorPage(app);
    await win.setViewportSize({ width, height });
    await setUpScreen(win, 'Hall', 0);
    await win.getByRole('button', { name: 'Screens', exact: true }).click();
    await setTicked(win.getByTestId('screen-group').first().getByTestId('languages-some'), true);
    await expectFits(
      win.getByRole('dialog', { name: 'Screens' }),
      `the Screens panel at ${width} x ${height}`,
    );
    await app.close();
  });

test('a library from before Looks keeps exactly what each group showed, its languages now in Screens', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'drashti-e2e-'));
  const TWO_OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
  // Written as Drashti kept it in Session 10 (schema 19: each group's languages on the group).
  const electron = createRequire(__filename)('electron') as string;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, TWO_OUTPUTS, {
    DRASHTI_USER_DATA_DIR: userData,
    DRASHTI_SELFTEST: 'old-library',
    DRASHTI_TEST_QUIET: '1',
    DRASHTI_SELFTEST_LIBRARY: JSON.stringify({
      schema: 19,
      groups: [
        { name: 'Hall', role: 'audience', languages: ['translit', 'gu'], display: 0 },
        { name: 'Stage', role: 'stage', languages: ['gu'], display: 1 },
      ],
    }),
  });
  const code = await new Promise<number | null>((resolve) => {
    spawn(electron, ['.'], { env, stdio: 'ignore' }).on('exit', resolve);
  });
  expect(code).toBe(0);
  expect(existsSync(join(userData, 'drashti.sqlite'))).toBe(true);

  const { app } = await launchApp(TWO_OUTPUTS, userData);
  const win = await operatorPage(app);
  await operatorReady(win);
  // The upgrade kept a copy of the old library; each group's languages are in Screens, the stream's group made at
  // the upgrade (YouTube in Screens, Session 26) with every language.
  expect(existsSync(join(userData, 'drashti.sqlite.v19.bak'))).toBe(true);
  const snapshot = await win.evaluate(() => (globalThis as PageGlobals).drashti.screens.get());
  expect(snapshot.groups.map((g) => [g.name, g.role, g.languages ?? null])).toEqual([
    ['Hall', 'audience', ['translit', 'gu']],
    ['Stage', 'stage', ['gu']],
    ['Stream', 'stream', null],
  ]);
  // The screens show what they did: the hall transliteration then Gujarati, the stage Gujarati only.
  await expect.poll(() => outputPages(app).length).toBe(2);
  const hallScreen = snapshot.groups[0]?.screens[0]?.id ?? '';
  const stageScreen = snapshot.groups[1]?.screens[0]?.id ?? '';
  const [hall, stage] = [await outputFor(app, hallScreen), await outputFor(app, stageScreen)];
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Sample kirtan/ })
    .click();
  await win.getByTestId('slide-thumb').first().click();
  await expect(hall.getByTestId('output-root')).toHaveAttribute('data-languages', 'translit,gu');
  await expect
    .poll(() =>
      hall
        .locator('[data-layer="slide"] [data-slide-in] [data-run]')
        .evaluateAll((runs) => runs.map((r) => r.getAttribute('data-lang'))),
    )
    .toEqual(['translit', 'gu']);
  await expect(stage.getByTestId('stage-current')).toHaveText('નમૂનાની પહેલી પંક્તિ');
  await app.close();
});
