import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { clearOfShowControls, expectFits } from './fit';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  needsRealScreen,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  relaunchApp,
} from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Screens that set themselves (Session 55, Part 1; Priyansh, 29 Oct 2026: "A display I plug in has to be set up by
 * hand, and I get stuck in a loop. Then a test slide in its languages comes up."). A display plugged in is used at
 * once, with no Set Up Screens, no question and no click: the first that is not the controls' shows the audience
 * picture, the next the stage, and one line says so, with Change… (Screens, at that display, its job in one click).
 * Each display is remembered by itself (its own identity: the pretend displays' here, DRASHTI_TEST_DISPLAY_SERIALS),
 * through unplugging, another port and a restart, and a job changed by hand instead; Not used too. The controls'
 * display is never taken. Nothing asks Keep these screens? (it would here: DRASHTI_TEST_KEEP_SCREENS), and there is
 * no test slide: a screen just started shows black until something is put up. The displays are Drashti's pretend
 * ones (DRASHTI_TEST_DISPLAY_CHANGES), set by themselves alone (DRASHTI_TEST_AUTO_SCREENS: 'pretend', so a second
 * real display here changes nothing), the outputs windows. Until Session 55 this spec was Show on's (Session 44).
 */

/** The first pretend display's id (src/main/outputs/electron-outputs.ts, EXTRA_DISPLAY_ID). */
const PRETEND = 900_000_000;

const AUTO = {
  DRASHTI_TEST_AUTO_SCREENS: 'pretend',
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_TEST_DISPLAY_CHANGES: '1',
  // Two projectors of one model, told apart by their own serial numbers (pretend ones).
  DRASHTI_TEST_DISPLAY_SERIALS: 'PJ-A,PJ-B',
  // Were anything to ask Keep these screens?, it would here.
  DRASHTI_TEST_KEEP_SCREENS: '1',
};

const plugIn = (app: ElectronApplication, n: number) =>
  app.evaluate((_electron, count) => {
    (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays?.(count);
  }, n);

/** The pretend displays' own serial numbers, by their place: as if each projector were plugged into another port. */
const serials = (app: ElectronApplication, list: string[]) =>
  app.evaluate((_electron, l) => {
    (globalThis as { drashtiTestDisplaySerials?: (l: string[]) => void }).drashtiTestDisplaySerials?.(l);
  }, list);

/** The pretend displays' jobs now: each "display: audience | stage" for those given one. */
const jobs = (win: Page) =>
  win.evaluate(async (first) => {
    const s = await (globalThis as PageGlobals).drashti.screens.get();
    // A build before Session 55 (a red run's) has no `uses`: no display has a job there.
    return ((s.uses as typeof s.uses | undefined) ?? [])
      .filter((u) => u.displayId >= first && u.screenId !== null)
      .map((u) => `${String(u.displayId - first + 1)}: ${u.role === 'stage' ? 'stage' : 'audience'}`);
  }, PRETEND);

/** The groups, each with how many screens. */
const groups = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.screens.get()).groups
      .filter((g) => g.role !== 'stream')
      .map((g) => `${g.name} (${g.role}): ${String(g.screens.length)}`),
  );

const pending = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.screens.pending());

const openOutputs = (app: ElectronApplication) => outputPages(app).filter((p) => !p.isClosed()).length;

/** What the window said the screens did, in one line. */
const said = (win: Page) => win.getByTestId('screens-said');

test('a display plugged in is used at once, asking nothing: the first the audience picture, the next the stage, each said in one line; no test slide, black until something is put up', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(AUTO);
  const win = await operatorPage(app);
  await operatorReady(win);
  // Nothing plugged in: nothing given, nothing said.
  await holdStill(async () => (await jobs(win)).length === 0, 2000, 'nothing is given with no display');
  await expect(said(win)).toHaveCount(0);

  // Plugged in: the audience picture, at once.
  await plugIn(app, 1);
  await expect.poll(() => jobs(win)).toEqual(['1: audience']);
  await expect(said(win).getByTestId('screens-said-text')).toHaveText(
    '“Extra display 1” shows the audience picture.',
  );
  await expect(said(win).getByTestId('screens-said-change')).toBeVisible();
  expect(await pending(win)).toBeNull();
  await expect(win.getByTestId('keep-screens')).toHaveCount(0);
  await expect.poll(() => openOutputs(app)).toBe(1);
  // No test slide: black until something is put up.
  const [out] = outputPages(app);
  if (!out) throw new Error('an output was expected');
  await outputReady(out);
  await expect(out.getByTestId('scene')).toHaveAttribute('data-nothing-up', 'black');
  await holdStill(async () => (await out.getByTestId('test-card').count()) === 0, 3000, 'no test slide');

  // The next: the stage.
  await plugIn(app, 2);
  await expect.poll(() => jobs(win)).toEqual(['1: audience', '2: stage']);
  await expect(said(win).getByTestId('screens-said-text')).toHaveText('“Extra display 2” shows the stage.');
  expect(await groups(win)).toEqual(['Audience (audience): 1', 'Stage (stage): 1']);
  expect(await pending(win)).toBeNull();
  await expect.poll(() => openOutputs(app)).toBe(2);
  // In the window's flow, never over the show controls.
  await clearOfShowControls(win, said(win));
  await expectNoSeriousA11yIssues(win, 'the screens’ one line', '[data-testid="screens-said"]');
  await app.close();
});

test('Change… opens Screens at that display: one click gives the second projector the audience picture too, and the display remembers it, unplugged and plugged in again, and after a restart', async () => {
  test.setTimeout(150_000);
  const first = await launchApp(AUTO);
  const { app, userData } = first;
  const win = await operatorPage(app);
  await operatorReady(win);
  await plugIn(app, 2);
  await expect.poll(() => jobs(win)).toEqual(['1: audience', '2: stage']);
  await expect(said(win).getByTestId('screens-said-text')).toHaveText(
    '“Extra display 1” shows the audience picture, and “Extra display 2” the stage.',
  );

  // Change…: Screens, at the first display it named, its job in reach.
  await said(win).getByTestId('screens-said-change').click();
  await expect(said(win)).toHaveCount(0);
  const row = (n: number) =>
    win.locator(`[data-testid="display-row"][data-display-id="${String(PRETEND + n - 1)}"]`);
  await expect(row(1).getByTestId('display-job')).toHaveAttribute('data-job', 'audience');
  await expect(row(1).getByRole('radio', { name: 'Audience' })).toBeFocused();
  await expect(row(2).getByTestId('display-job')).toHaveAttribute('data-job', 'stage');
  await expectNoSeriousA11yIssues(win, 'Screens’ displays, each with its job', '[role="dialog"]');

  // One click: the second projector shows the audience picture too. Nothing asks.
  await row(2).getByTestId('display-job-audience').click();
  await expect(row(2).getByTestId('display-job')).toHaveAttribute('data-job', 'audience');
  await expect.poll(() => jobs(win)).toEqual(['1: audience', '2: audience']);
  expect(await pending(win)).toBeNull();
  expect(await groups(win)).toEqual(['Audience (audience): 2', 'Stage (stage): 0']);

  // Unplugged and plugged in again: straight back to their jobs, nothing said.
  await plugIn(app, 0);
  await expect.poll(() => jobs(win)).toEqual([]);
  await plugIn(app, 2);
  await expect.poll(() => jobs(win)).toEqual(['1: audience', '2: audience']);
  await expect.poll(() => openOutputs(app)).toBe(2);
  await expect(said(win)).toHaveCount(0);
  await app.close();

  // A restart: each display goes straight back to its job, nothing said.
  const again = await relaunchApp(userData, { ...AUTO, DRASHTI_EXTRA_DISPLAYS: '2' });
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  await expect.poll(() => jobs(win2)).toEqual(['1: audience', '2: audience']);
  await holdStill(async () => (await said(win2).count()) === 0, 3000, 'nothing is said at a restart');
  expect(await groups(win2)).toEqual(['Audience (audience): 2', 'Stage (stage): 0']);
  await again.app.close();
});

test('two projectors of one model, each on the other’s port: each goes back to its own job, known by itself', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ ...AUTO, DRASHTI_EXTRA_DISPLAYS: '2' });
  const win = await operatorPage(app);
  await operatorReady(win);
  // At the start: given their jobs, and said.
  await expect.poll(() => jobs(win)).toEqual(['1: audience', '2: stage']);
  await expect(said(win).getByTestId('screens-said-text')).toHaveText(
    '“Extra display 1” shows the audience picture, and “Extra display 2” the stage.',
  );
  // Swapped: the first port now has projector B, the second projector A.
  await serials(app, ['PJ-B', 'PJ-A']);
  await expect.poll(() => jobs(win)).toEqual(['1: stage', '2: audience']);
  expect(await groups(win)).toEqual(['Audience (audience): 1', 'Stage (stage): 1']);
  expect(await pending(win)).toBeNull();
  await app.close();
});

test('the controls’ display is never taken; Not used is remembered by the display, unplugged and after a restart, until a job is given by hand', async () => {
  test.setTimeout(150_000);
  const env = { ...AUTO, DRASHTI_EXTRA_DISPLAYS: '2', DRASHTI_TEST_CONTROLS_DISPLAY: String(PRETEND) };
  const { app, userData } = await launchApp(env);
  const win = await operatorPage(app);
  await operatorReady(win);
  // The first pretend display has the controls: the second is the audience's.
  await expect.poll(() => jobs(win)).toEqual(['2: audience']);
  await holdStill(async () => (await jobs(win)).length === 1, 2000, 'the controls’ display is never taken');

  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const row = (n: number) =>
    win.locator(`[data-testid="display-row"][data-display-id="${String(PRETEND + n - 1)}"]`);
  await expect(row(1).getByTestId('display-controls-here')).toHaveText('The controls are on this display');
  await expect(row(1).getByTestId('display-job')).toHaveAttribute('data-job', 'none');
  // Not used, one click: its screen goes, nothing asks.
  await row(2).getByTestId('display-job-none').click();
  await expect(row(2).getByTestId('display-job')).toHaveAttribute('data-job', 'none');
  await expect.poll(() => openOutputs(app)).toBe(0);
  expect(await pending(win)).toBeNull();
  // Unplugged and plugged in again: still Not used.
  await plugIn(app, 0);
  await plugIn(app, 2);
  await holdStill(async () => (await jobs(win)).length === 0, 3000, 'a display set Not used is never taken');
  await app.close();

  // After a restart too; then given a job by hand, it is its.
  const again = await relaunchApp(userData, env);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  await holdStill(async () => (await jobs(win2)).length === 0, 3000, 'Not used is kept with the library');
  const given = await win2.evaluate(
    (d) => (globalThis as PageGlobals).drashti.screens.setJob(d, 'stage'),
    PRETEND + 1,
  );
  expect(given.ok).toBe(true);
  await expect.poll(() => jobs(win2)).toEqual(['2: stage']);
  await again.app.close();
});

test('mirroring: said once, how to extend instead, with nothing to change in Screens', async () => {
  const { app } = await launchApp({ ...AUTO, DRASHTI_TEST_MIRRORED_ONTO: 'PLACEHOLDER PJ' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await expect(said(win)).toHaveAttribute('data-kind', 'mirroring');
  const text = said(win).getByTestId('screens-said-text');
  await expect(text).toContainText('“PLACEHOLDER PJ”');
  await expect(text).toContainText('so Drashti sees one display');
  await expect(text).toContainText('extend instead');
  await expect(said(win).getByTestId('screens-said-change')).toHaveCount(0);
  // Closed, it stays closed: said once.
  await said(win).getByRole('button', { name: 'Dismiss' }).click();
  await win.reload();
  await operatorReady(win);
  await holdStill(async () => (await said(win).count()) === 0, 2000, 'said once');
  await app.close();
});

test('Simple Mode says it too, with no Change… (it changes no screen)', async () => {
  const { app } = await launchApp(AUTO);
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await plugIn(app, 1);
  await expect(said(win).getByTestId('screens-said-text')).toHaveText(
    '“Extra display 1” shows the audience picture.',
  );
  await expect(said(win).getByTestId('screens-said-change')).toHaveCount(0);
  await clearOfShowControls(win, said(win));
  await app.close();
});

// In a window CI's size, 1024 × 645, and at 1280 × 720: the line and Screens' displays with their jobs fit.
for (const size of [CI_WINDOW, { width: 1280, height: 720 }])
  test(`the line and Screens’ displays with their jobs fit at ${String(size.width)} × ${String(size.height)}`, async () => {
    test.setTimeout(90_000);
    const { app } = await launchApp({ ...AUTO, DRASHTI_EXTRA_DISPLAYS: '2' });
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, size);
    await expect.poll(() => jobs(win)).toEqual(['1: audience', '2: stage']);
    await expectFits(said(win), `the screens’ line at ${String(size.width)} × ${String(size.height)}`);
    await said(win).getByTestId('screens-said-change').click();
    const dialog = win.getByRole('dialog', { name: 'Screens' });
    await expectFits(dialog, `Screens at ${String(size.width)} × ${String(size.height)}`);
    for (const row of await dialog.getByTestId('display-row').all()) {
      await row.scrollIntoViewIfNeeded();
      await expectFits(row.getByTestId('display-job'), 'a display’s job');
    }
    await app.close();
  });

test('Set Up Screens… gives each display its job in one click; Done changes the screens at once, asking nothing, with no test slide', async () => {
  test.setTimeout(90_000);
  // A library set up by hand (displays do not set themselves here), Keep these screens? asking were it to.
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '2',
    DRASHTI_TEST_KEEP_SCREENS: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await chooseMenuItem(app, 'set-up-screens');
  const wizard = win.getByTestId('setup-wizard');
  await expect(wizard.getByTestId('setup-step')).toHaveText('Screens');
  const display = (n: number) =>
    wizard.locator(`[data-testid="setup-display"][data-display-id="${String(PRETEND + n - 1)}"]`);
  // As they are: nothing set up, nothing chosen for them.
  for (const n of [1, 2])
    await expect(display(n).getByTestId('setup-use')).toHaveAttribute('data-use', 'none');
  await expectNoSeriousA11yIssues(win, 'Set Up Screens on its displays', '[data-testid="setup-wizard"]');
  // One click each: Audience, Stage. Done: set at once, nothing asked, no test slide.
  await display(1).getByTestId('setup-use-audience').click();
  await display(2).getByTestId('setup-use-stage').click();
  await wizard.getByTestId('setup-screens-done').click();
  await expect(wizard.getByTestId('setup-done')).toHaveText('Done. 2 screens show now.');
  await expect(win.getByTestId('keep-screens')).toHaveCount(0);
  expect(await pending(win)).toBeNull();
  await expect.poll(() => openOutputs(app)).toBe(2);
  await holdStill(
    async () => {
      for (const p of outputPages(app)) if ((await p.getByTestId('test-card').count()) > 0) return false;
      return true;
    },
    3000,
    'no test slide after Done',
  );
  await app.close();
});

// The Dell display's run (Session 55, Part 11): on a computer with a second real display, as plugged in at the start.
test('a real second display is used at once, full screen, its job said', async () => {
  needsRealScreen();
  test.setTimeout(90_000);
  const { app } = await launchApp({ DRASHTI_TEST_AUTO_SCREENS: '1' });
  try {
    const count = await app.evaluate(({ screen }) => screen.getAllDisplays().length);
    test.skip(count < 2, 'This computer has one display (CI’s): nothing to plug in');
    const win = await operatorPage(app);
    await operatorReady(win);
    await expect(said(win)).toHaveAttribute('data-kind', 'set');
    await expect(said(win).getByTestId('screens-said-text')).toContainText('shows the audience picture');
    await expect.poll(() => openOutputs(app)).toBeGreaterThan(0);
    // Full screen on its display, never on the controls'.
    const placed = await app.evaluate(({ BrowserWindow, screen }) => {
      const all = BrowserWindow.getAllWindows();
      const out = all.find((w) => w.webContents.getURL().includes('output.html'));
      const op = all.find((w) => w.webContents.getURL().includes('index.html'));
      if (!out || !op) return null;
      return {
        fills:
          JSON.stringify(out.getBounds()) ===
          JSON.stringify(screen.getDisplayMatching(out.getBounds()).bounds),
        apart: screen.getDisplayMatching(out.getBounds()).id !== screen.getDisplayMatching(op.getBounds()).id,
      };
    });
    expect(placed).toEqual({ fills: true, apart: true });
  } finally {
    await app.close();
  }
});
