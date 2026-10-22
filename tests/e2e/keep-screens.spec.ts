import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  needsRealScreen,
  operatorPage,
  operatorReady,
  outputPages,
  windowShowing,
} from './helpers';

/*
 * Keep these screens? (Session 50; Priyansh: in Set Up Screens… he chose the display his controls are on as the
 * audience picture by mistake, and couldn't get back). After a change that puts an output on a display, Drashti
 * asks for 15 s, with Keep and Go back; nothing pressed, it goes back by itself to exactly the screens as they
 * were. Turning an output off asks nothing. When the change covers the controls, the output there asks the same,
 * large, in its middle. Set Up Screens… and Screens mark the display the controls are on.
 *
 * Every other test runs without the question (launchApp's DRASHTI_TEST_KEEP_SCREENS: '0'); these ask it. Quiet,
 * the displays are Drashti's pretend ones and the outputs windows (DRASHTI_WINDOWED_OUTPUTS,
 * DRASHTI_EXTRA_DISPLAYS), which never cover the controls; the output over the controls is checked on a real
 * screen (CI's one display, 1024 wide).
 */

const ASKS = { DRASHTI_TEST_KEEP_SCREENS: '1', DRASHTI_WINDOWED_OUTPUTS: '1' };
/** The first pretend display's id (src/main/outputs/electron-outputs.ts, EXTRA_DISPLAY_ID). */
const PRETEND = 900_000_000;

/** The display the operator window is on. */
const controlsDisplay = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'));
    return w ? screen.getDisplayMatching(w.getBounds()).id : -1;
  });

/** The screens as they stand: every group with its screens, and how each screen stands. */
const screensNow = (win: Page) =>
  win.evaluate(async () => {
    const s = await (globalThis as PageGlobals).drashti.screens.get();
    return { groups: s.groups, status: s.status };
  });

/** The change waiting for an answer, as the main process has it. */
const pending = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.screens.pending());

const openOutputs = (app: ElectronApplication) => outputPages(app).filter((p) => !p.isClosed()).length;

/** An output window that is open now (one closed a moment ago is passed over). */
const openOutput = (app: ElectronApplication) =>
  windowShowing(
    app,
    (p) => p.url().includes('output.html') && !p.url().includes('identify=') && !p.isClosed(),
    'output',
  );

test('Set Up Screens… marks the controls’ display; Done asks; Esc goes back to exactly the screens as they were, the wizard to its displays; Enter keeps', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ ...ASKS, DRASHTI_EXTRA_DISPLAYS: '2' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const controls = await controlsDisplay(app);
  const before = await screensNow(win);

  await chooseMenuItem(app, 'set-up-screens');
  const wizard = win.getByTestId('setup-wizard');
  await expect(wizard.getByTestId('setup-step')).toHaveText('Screens');
  // The display the controls are on says so, and only that one; its choices are described by it.
  await expect(wizard.getByTestId('setup-controls-here')).toHaveCount(1);
  const controlsRow = wizard.locator(`[data-testid="setup-display"][data-display-id="${String(controls)}"]`);
  await expect(controlsRow.getByTestId('setup-controls-here')).toHaveText('The controls are on this display');
  await expect(controlsRow.getByTestId('setup-use')).toHaveAccessibleDescription(
    /the controls are on this display/iu,
  );

  // The last display the stage's (the first free one starts as the hall's); Done.
  const displays = wizard.getByTestId('setup-display');
  await displays.last().getByTestId('setup-use-stage').click();
  await wizard.getByTestId('setup-screens-done').click();
  const question = win.getByTestId('keep-screens');
  await expect(question).toContainText('Keep these screens?');
  const countdown = question.getByTestId('keep-screens-countdown');
  await expect(countdown).toHaveText(/^Going back by itself in \d+ seconds?\.$/u);
  expect(Number(await countdown.getAttribute('data-seconds'))).toBeGreaterThan(5);
  expect(Number(await countdown.getAttribute('data-seconds'))).toBeLessThanOrEqual(15);
  await expect(question.getByTestId('keep-screens-keep')).toBeFocused();
  await expect.poll(() => openOutputs(app)).toBe(2);
  expect(await pending(win)).toMatchObject({ coversControls: false });
  await expectNoSeriousA11yIssues(win, 'Keep these screens?', '[data-testid="keep-screens"]');

  // Esc goes back: exactly the screens as they were, the outputs closed, and the operator told. The wizard is at
  // its displays again with the choices as made, saying why.
  await win.keyboard.press('Escape');
  await expect(question).toHaveCount(0);
  await expect.poll(() => screensNow(win)).toEqual(before);
  await expect.poll(() => openOutputs(app)).toBe(0);
  await expect(win.getByTestId('operator-notice')).toContainText(
    'The screens went back to how they were before the change.',
  );
  await expect(wizard.getByTestId('setup-step')).toHaveText('Screens');
  await expect(wizard.getByTestId('setup-went-back')).toBeVisible();
  await expect(displays.last().getByTestId('setup-use')).toHaveAttribute('data-use', 'stage');

  // Done again; Enter keeps (Keep has the keyboard): Done, and the outputs stay.
  await wizard.getByTestId('setup-screens-done').click();
  await expect(question.getByTestId('keep-screens-keep')).toBeFocused();
  await win.keyboard.press('Enter');
  await expect(question).toHaveCount(0);
  await expect(wizard.getByTestId('setup-done')).toContainText('Done. A test slide is on 2 screens');
  await expect(wizard.getByTestId('setup-went-back')).toHaveCount(0);
  expect(await pending(win)).toBeNull();
  expect(openOutputs(app)).toBe(2);
  await app.close();
});

test('Show on asks too; Go back takes the hall’s picture off that display again', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp({ ...ASKS, DRASHTI_TEST_SCREEN_OFFER: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const before = await screensNow(win);
  const offer = win.getByTestId('show-on-offer');
  await offer.getByTestId('show-on').click();
  const question = win.getByTestId('keep-screens');
  await expect(question).toContainText('Keep these screens?');
  await expect.poll(() => openOutputs(app)).toBe(1);
  await question.getByTestId('keep-screens-go-back').click();
  await expect(question).toHaveCount(0);
  await expect.poll(() => screensNow(win)).toEqual(before);
  await expect.poll(() => openOutputs(app)).toBe(0);
  // No hall screen again: the display is offered again.
  await expect(offer.getByTestId('show-on')).toBeVisible();
  await app.close();
});

test('in Screens: the controls’ display marked; Use this display asks, Enter keeps; Off asks nothing; On again, nothing pressed, goes back by itself', async () => {
  test.setTimeout(120_000);
  // A shorter wait (a test's own): the same question and countdown.
  const { app } = await launchApp({
    ...ASKS,
    DRASHTI_EXTRA_DISPLAYS: '1',
    DRASHTI_TEST_KEEP_SCREENS_MS: '8000',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const controls = await controlsDisplay(app);
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await expect(win.getByTestId('display-controls-here')).toHaveCount(1);
  await expect(
    win
      .locator(`[data-testid="display-row"][data-display-id="${String(controls)}"]`)
      .getByTestId('display-controls-here'),
  ).toHaveText('The controls are on this display');
  await win.getByLabel('New group name').fill('Main Hall');
  await win.getByRole('button', { name: 'Add group' }).click();
  await expect(win.getByTestId('screen-group')).toHaveCount(1);

  // Use this display (the pretend one): asked, the seconds left in words; Keep has the keyboard, Enter keeps.
  await win
    .locator(`[data-testid="display-row"][data-display-id="${String(PRETEND)}"]`)
    .getByRole('button', { name: 'Use this display' })
    .click();
  const question = win.getByTestId('keep-screens');
  await expect(question).toContainText('Keep these screens?');
  const countdown = question.getByTestId('keep-screens-countdown');
  await expect(countdown).toHaveText(/^Going back by itself in [1-8] seconds?\.$/u);
  await expect(question.getByTestId('keep-screens-keep')).toBeFocused();
  await win.keyboard.press('Enter');
  await expect(question).toHaveCount(0);
  const state = win.getByTestId('screen-state');
  await expect(state).toContainText('Showing');
  await expect.poll(() => openOutputs(app)).toBe(1);
  // Kept: it stays, past the moment its 8 s would have ended.
  await holdStill(
    async () => (await pending(win)) === null && openOutputs(app) === 1,
    9000,
    'a change kept stays when its time would have ended',
  );

  // Turned off: no question.
  const on = win.getByLabel('On', { exact: true });
  await on.click();
  await expect(state).toHaveText('Off');
  expect(await pending(win)).toBeNull();
  await expect(question).toHaveCount(0);

  // On again: asked, counting down; nothing pressed, it goes back by itself (Off again), and says so.
  await on.click();
  await expect(question).toContainText('Keep these screens?');
  await expect(state).toContainText('Showing');
  const first = Number(await countdown.getAttribute('data-seconds'));
  await expect.poll(async () => Number(await countdown.getAttribute('data-seconds'))).toBeLessThan(first);
  await expect(question).toHaveCount(0, { timeout: 20_000 });
  await expect(state).toHaveText('Off');
  await expect.poll(() => openOutputs(app)).toBe(0);
  await expect(win.getByTestId('operator-notice')).toContainText(
    'Nothing was pressed, so the screens went back to how they were before the change.',
  );
  await app.close();
});

test('covering the controls: the output asks too, large, with its countdown; Esc goes back, Enter keeps; the uncover key leaves the question on the controls', async () => {
  needsRealScreen();
  test.setTimeout(150_000);
  const { app } = await launchApp({ DRASHTI_TEST_KEEP_SCREENS: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    // With another display free, the controls move there rather than being covered (CI has one display).
    const count = await app.evaluate(({ screen }) => screen.getAllDisplays().length);
    test.skip(count > 1, 'Another display is free: the controls move there instead of being covered');
    const controls = await controlsDisplay(app);
    const groupId = await win.evaluate(async () => {
      const created = await (globalThis as PageGlobals).drashti.screens.createGroup('Main Hall');
      if (!created.ok) throw new Error(created.message);
      return created.snapshot.groups.find((g) => g.name === 'Main Hall')?.id ?? '';
    });
    /** Put the hall's picture on the controls' display, as Screens does once the operator agreed. */
    const cover = () =>
      win.evaluate(
        async ({ g, d }) => {
          const r = await (globalThis as PageGlobals).drashti.screens.assignDisplay(g, d, {
            coverOperator: true,
          });
          if (!r.ok) throw new Error(r.message);
        },
        { g: groupId, d: controls },
      );
    const uncoverKey = process.platform === 'darwin' ? 'Meta+Shift+U' : 'Control+Shift+U';
    const question = win.getByTestId('keep-screens');

    // Covered: the output asks, large, in its middle, with the seconds left and the keys; the controls say so.
    await cover();
    let out = await openOutput(app);
    const big = out.getByTestId('keep-question');
    await expect(big).toContainText('Keep these screens?');
    await expect(big.getByTestId('keep-question-countdown')).toHaveText(
      /^Going back by itself in \d+ seconds?\.$/u,
    );
    await expect(big).toContainText(process.platform === 'darwin' ? '⌘⇧U' : 'Ctrl+Shift+U');
    await expectFits(big, 'Keep these screens? on the output over the controls');
    await expect(question.getByTestId('keep-screens-covered')).toBeVisible();
    expect(await pending(win)).toMatchObject({ coversControls: true });
    // Esc goes back: an output never takes the keyboard, so the keys reach the controls under it. The output
    // closes, and the question goes from the controls too.
    await win.keyboard.press('Escape');
    await expect.poll(() => openOutputs(app)).toBe(0);
    await expect(question).toHaveCount(0);
    expect((await screensNow(win)).groups.find((g) => g.id === groupId)?.screens).toEqual([]);

    // Covered again: Enter keeps; it stays over the controls.
    await cover();
    out = await openOutput(app);
    await expect(out.getByTestId('keep-question')).toBeVisible();
    await expect(question.getByTestId('keep-screens-keep')).toBeFocused();
    await win.keyboard.press('Enter');
    await expect(question).toHaveCount(0);
    await expect(out.getByTestId('keep-question')).toHaveCount(0);
    expect(openOutputs(app)).toBe(1);
    // The uncover key works as ever: that output off.
    await win.keyboard.press(uncoverKey);
    await expect.poll(() => openOutputs(app)).toBe(0);

    // On again (agreed): asked again. The output's own answer, as its Esc sends it when it has the keyboard (a
    // windowed output), goes back: off again.
    const screenId = (await screensNow(win)).groups.find((g) => g.id === groupId)?.screens[0]?.id ?? '';
    const turnOn = () =>
      win.evaluate(async (id) => {
        const r = await (globalThis as PageGlobals).drashti.screens.updateScreen(
          id,
          { enabled: true },
          { coverOperator: true },
        );
        if (!r.ok) throw new Error(r.message);
      }, screenId);
    const enabled = async () =>
      (await screensNow(win)).groups.find((g) => g.id === groupId)?.screens.map((sc) => [sc.id, sc.enabled]);
    await turnOn();
    out = await openOutput(app);
    await expect(out.getByTestId('keep-question')).toBeVisible();
    // Sent without waiting for the answer: going back closes this very window.
    await out.evaluate(() => {
      void (globalThis as PageGlobals).drashti.output.keepAnswer(false);
    });
    await expect.poll(() => openOutputs(app)).toBe(0);
    await expect(question).toHaveCount(0);
    expect(await enabled()).toEqual([[screenId, false]]);

    // On again: the uncover key while it waits turns the output off, and the question stays on the controls,
    // seen now; Keep keeps the screens as they are (the screen there, off).
    await turnOn();
    out = await openOutput(app);
    await expect(out.getByTestId('keep-question')).toBeVisible();
    await win.keyboard.press(uncoverKey);
    await expect.poll(() => openOutputs(app)).toBe(0);
    await expect(question).toBeVisible();
    await expect(question.getByTestId('keep-screens-covered')).toHaveCount(0);
    expect(await pending(win)).toMatchObject({ coversControls: false });
    await question.getByTestId('keep-screens-keep').click();
    await expect(question).toHaveCount(0);
    expect(await pending(win)).toBeNull();
    expect(await enabled()).toEqual([[screenId, false]]);
  } finally {
    await app.close();
  }
});
