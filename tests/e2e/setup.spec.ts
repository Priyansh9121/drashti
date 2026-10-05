import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  launchApp,
  needsRealScreen,
  operatorPage,
  operatorReady,
  outputPages,
  setUpScreen,
} from './helpers';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';

/*
 * The first-run setup wizard (Session 8): identify the outputs, choose
 * what each shows and in which languages, the sound output with a test
 * tone, the default theme, and a test slide on every screen at Finish.
 * Skipping or closing changes nothing; the operator's display is never
 * covered without the confirm step; Simple Mode never shows it.
 */

/** Each group, with its languages in the live Look. */
const groupsOf = (win: Page) =>
  win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [snapshot, looks] = await Promise.all([d.screens.get(), d.looks.list()]);
    const live = looks.looks.find((l) => l.id === looks.liveId);
    return snapshot.groups.map((g) => ({
      name: g.name,
      role: g.role,
      languages: live?.groups[g.id]?.languages ?? null,
      screens: g.screens.length,
    }));
  });

/** Choose View > Set Up Screens… in the menu, as the operator would. */
async function fromMenu(app: ElectronApplication): Promise<void> {
  await chooseMenuItem(app, 'set-up-screens');
}

const page = (app: ElectronApplication, part: string) => app.windows().find((w) => w.url().includes(part));

test('on the first start: identify, what each output shows and its languages, a test tone, a theme, and a test slide', async () => {
  const { app } = await launchApp({
    DRASHTI_TEST_NO_WIZARD: '0',
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
    DRASHTI_TEST_FAKE_DEVICES: '1',
  });
  const win = await operatorPage(app);
  const wizard = win.getByTestId('setup-wizard');
  await expect(wizard.getByTestId('setup-step')).toHaveText('Welcome');
  await expectNoSeriousA11yIssues(win, 'the setup wizard, welcome');
  await wizard.getByTestId('setup-next').click();

  // Each display's number across it, for a few seconds.
  await expect(wizard.getByTestId('setup-step')).toHaveText('Screens');
  const displays = wizard.getByTestId('setup-display');
  await expect(displays).toHaveCount(2);
  await wizard.getByTestId('setup-identify').click();
  await expect.poll(() => app.windows().filter((w) => w.url().includes('identify=')).length).toBe(2);
  const numbers = await Promise.all(
    app
      .windows()
      .filter((w) => w.url().includes('identify='))
      .map((w) => w.getByTestId('display-number').getAttribute('data-number')),
  );
  expect(numbers.sort()).toEqual(['1', '2']);

  // The first output shows the audience picture in Gujarati then transliteration; the second the stage, in Gujarati.
  await displays.nth(0).getByTestId('setup-use').selectOption('audience');
  const first = displays.nth(0).getByTestId('language-picker');
  await first.getByTestId('languages-some').check();
  await first.getByRole('checkbox', { name: 'Hindi' }).uncheck();
  await first.getByRole('checkbox', { name: 'English' }).uncheck();
  await displays.nth(1).getByTestId('setup-use').selectOption('stage');
  const second = displays.nth(1).getByTestId('language-picker');
  await second.getByTestId('languages-some').check();
  for (const name of ['Hindi', 'Transliteration', 'English'])
    await second.getByRole('checkbox', { name }).uncheck();
  await expectNoSeriousA11yIssues(win, 'the setup wizard, screens');
  // Nothing has changed yet.
  expect(await groupsOf(win)).toEqual([]);
  await wizard.getByTestId('setup-next').click();

  // Sound: the default output, and a test tone through the audio player.
  await expect(wizard.getByTestId('setup-step')).toHaveText('Sound');
  await wizard.getByTestId('setup-sound').first().getByRole('radio').check();
  await wizard.getByTestId('setup-tone').click();
  await expect
    .poll(async () => page(app, 'audio.html')?.evaluate(() => document.body.dataset['testTone']))
    .toBe('default');
  await wizard.getByTestId('setup-next').click();

  // The stream's camera and sound input (Chromium's fake ones here); the key can wait.
  await expect(wizard.getByTestId('setup-step')).toHaveText('Stream');
  const camera = wizard.getByTestId('setup-stream-camera');
  await expect(camera.locator('option')).not.toHaveCount(1);
  await camera.selectOption({ index: 1 });
  await wizard.getByTestId('setup-stream-sound').selectOption({ index: 1 });
  await expectNoSeriousA11yIssues(win, 'the setup wizard, stream');
  await wizard.getByTestId('setup-next').click();

  // Theme, then the summary.
  await expect(wizard.getByTestId('setup-step')).toHaveText('Theme');
  await wizard.getByTestId('setup-theme').first().getByRole('radio').check();
  await wizard.getByTestId('setup-next').click();
  // PINs (Session 14): none for now, so roles stay off.
  await expect(wizard.getByTestId('setup-step')).toHaveText('PINs');
  await wizard.getByTestId('setup-next').click();
  await expect(wizard.getByTestId('setup-summary')).toContainText('PINs: none (roles stay off)');
  await expect(wizard.getByTestId('setup-summary')).toContainText(
    'Display 1: The audience picture, Gujarati, Transliteration',
  );
  await expect(wizard.getByTestId('setup-summary')).toContainText(
    'Display 2: The stage view (performers), Gujarati',
  );
  await expect(wizard.getByTestId('setup-summary')).toContainText('Stream: camera fake_device_0');
  await expectNoSeriousA11yIssues(win, 'the setup wizard, finish');
  await wizard.getByTestId('setup-finish').click();
  await expect(wizard.getByTestId('setup-done')).toContainText('A test slide is on 2 screens');
  const streamInputs = await win.evaluate(async () => {
    const { profiles, activeId } = await (globalThis as PageGlobals).drashti.stream.profiles();
    const p = profiles.find((x) => x.id === activeId);
    return [p?.camera?.label ?? null, p?.sound !== null];
  });
  expect(streamInputs).toEqual(['fake_device_0', true]);
  // Setting up the stream's inputs brings its group into Screens (off screen, every language).
  expect(await groupsOf(win)).toEqual([
    { name: 'Audience', role: 'audience', languages: ['gu', 'translit'], screens: 1 },
    { name: 'Stage', role: 'stage', languages: ['gu'], screens: 1 },
    { name: 'Stream', role: 'stream', languages: null, screens: 0 },
  ]);

  // A test slide on every screen, each in its own languages.
  await expect.poll(() => outputPages(app).length).toBe(2);
  const cards = await Promise.all(
    outputPages(app).map(async (p) => {
      const card = p.getByTestId('test-card');
      await expect(card).toBeVisible();
      return {
        shows: await card.getByTestId('test-card-shows').textContent(),
        langs: await card
          .locator('[data-run]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-lang'))),
      };
    }),
  );
  expect(cards.sort((a, b) => (a.shows ?? '').localeCompare(b.shows ?? ''))).toEqual([
    { shows: 'Audience · The audience picture · Gujarati, Transliteration', langs: ['gu', 'translit'] },
    { shows: 'Stage · The stage view · Gujarati', langs: ['gu'] },
  ]);
  await wizard.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(wizard).toHaveCount(0);

  // It does not open by itself again.
  await win.reload();
  await operatorReady(win);
  await expect(win.getByTestId('setup-wizard')).toHaveCount(0);
  await app.close();
});

test('skipping every step, or closing, changes nothing; it opens again from the menu', async () => {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  // Not the first start here: it stays shut until asked for.
  await expect(win.getByTestId('setup-wizard')).toHaveCount(0);
  await setUpScreen(win, 'Main Hall', 0);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const g = (await d.screens.get()).groups[0];
    await d.screens.setGroupLanguages(g?.id ?? '', ['gu']);
  });
  const before = await groupsOf(win);
  // The sound as it is once the audio player has looked at the outputs (it reports them after a moment).
  const soundOutput = () => win.evaluate(() => (globalThis as PageGlobals).drashti.audio.getOutput());
  await expect.poll(async () => (await soundOutput()).checked).toBe(true);
  const soundBefore = await soundOutput();

  await fromMenu(app);
  const wizard = win.getByTestId('setup-wizard');
  await wizard.getByTestId('setup-next').click();
  // It starts from the setup as it is.
  await expect(wizard.getByTestId('setup-display').first().getByTestId('setup-use')).toHaveValue('audience');
  for (const step of ['Screens', 'Sound', 'Stream', 'Theme', 'PINs']) {
    await expect(wizard.getByTestId('setup-step')).toHaveText(step);
    await wizard.getByTestId('setup-skip').click();
  }
  await expect(wizard.getByTestId('setup-summary')).toContainText('The screens stay as they are.');
  await expect(wizard.getByTestId('setup-summary')).toContainText('Sound: stays as it is');
  await expect(wizard.getByTestId('setup-summary')).toContainText('Stream: stays as it is');
  await expect(wizard.getByTestId('setup-summary')).toContainText('Default theme: stays as it is');
  await wizard.getByTestId('setup-finish').click();
  await expect(wizard.getByTestId('setup-done')).toBeVisible();
  expect(await groupsOf(win)).toEqual(before);
  expect(await soundOutput()).toEqual(soundBefore);
  await wizard.getByRole('button', { name: 'Close', exact: true }).click();

  // Choices made, then closed: still nothing changes.
  await fromMenu(app);
  await wizard.getByTestId('setup-next').click();
  await wizard.getByTestId('setup-display').first().getByTestId('setup-use').selectOption('none');
  await wizard.getByRole('button', { name: 'Close the setup' }).click();
  await expect(wizard).toHaveCount(0);
  expect(await groupsOf(win)).toEqual(before);
  await app.close();
});

test('never covers the operator’s display without the confirm step', async () => {
  needsRealScreen();
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const operatorDisplay = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'));
    return w ? screen.getDisplayMatching(w.getBounds()).id : -1;
  });
  await fromMenu(app);
  const wizard = win.getByTestId('setup-wizard');
  await wizard.getByTestId('setup-next').click();
  const row = wizard.locator(`[data-testid="setup-display"][data-display-id="${operatorDisplay}"]`);
  await expect(row).toContainText('The Drashti controls are here');
  await row.getByTestId('setup-use').selectOption('audience');
  await expect(row).toContainText('Finish asks before it does');
  for (const step of ['Screens', 'Sound', 'Stream', 'Theme', 'PINs']) {
    await expect(wizard.getByTestId('setup-step')).toHaveText(step);
    await wizard.getByTestId('setup-next').click();
  }
  await wizard.getByTestId('setup-finish').click();
  const confirm = win.getByTestId('setup-cover-confirm');
  await expect(confirm).toContainText('Cover the Drashti controls?');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  // Nothing changed, and no output covers the controls.
  expect(await groupsOf(win)).toEqual([]);
  expect(outputPages(app)).toHaveLength(0);
  await wizard.getByTestId('setup-finish').click();
  await confirm.getByRole('button', { name: 'Cover the controls' }).click();
  await expect.poll(() => outputPages(app).length).toBe(1);
  // Get the controls back.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.screens.uncoverOperator());
  await expect.poll(() => outputPages(app).filter((p) => !p.isClosed()).length).toBe(0);
  await app.close();
});

test('Simple Mode never shows it, and refuses to apply a setup', async () => {
  const { app } = await launchApp({ DRASHTI_TEST_NO_WIZARD: '0' });
  const win = await operatorPage(app);
  await expect(win.getByTestId('setup-wizard')).toBeVisible();
  await win.getByTestId('setup-wizard').getByRole('button', { name: 'Close the setup' }).click();
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const menuHasIt = await app.evaluate(
    ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('set-up-screens') !== null,
  );
  expect(menuHasIt).toBe(false);
  const refused = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.setup.finish({ outputs: [], sound: 'skip', themeId: null }),
  );
  expect(refused).toMatchObject({ ok: false });
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.setup.state())).toMatchObject({
    firstRun: false,
  });
  await app.close();
});

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const)
  test(`the setup wizard fits at ${width} x ${height}`, async () => {
    const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '2' });
    const win = await operatorPage(app);
    await win.setViewportSize({ width, height });
    await operatorReady(win);
    await fromMenu(app);
    const wizard = win.getByTestId('setup-wizard');
    await wizard.getByTestId('setup-next').click();
    for (const row of await wizard.getByTestId('setup-display').all()) {
      await row.getByTestId('setup-use').selectOption('audience');
      await row.getByTestId('languages-some').check();
    }
    await expectFits(wizard, `the setup wizard's screens at ${width} x ${height}`);
    await app.close();
  });
