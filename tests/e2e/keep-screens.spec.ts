import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ScreensResult } from '../../src/shared/screens';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  holdStill,
  killApp,
  launchApp,
  needsRealScreen,
  operatorPage,
  operatorReady,
  outputPages,
  relaunchApp,
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
 *
 * Session 51: Screens' Shows and a key and fill pair's Sends ask too; Go back puts back only what the change
 * changed; a dialog opened while the question waits goes under it; and a change waiting when Drashti stops dead
 * goes back at the next start.
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

/** A group made through the bridge, as Screens makes it: its id. */
const makeGroup = (win: Page, name: string) =>
  win.evaluate(async (n) => {
    const made = await (globalThis as PageGlobals).drashti.screens.createGroup(n);
    if (!made.ok) throw new Error(made.message);
    return made.snapshot.groups.find((g) => g.name === n)?.id ?? '';
  }, name);

/** A screen change through the bridge, as Screens sends it; it must be taken (asked or not). */
const screensChange = async (run: () => Promise<ScreensResult>): Promise<void> => {
  const result = await run();
  if (!result.ok) throw new Error(result.message);
};

/** Each group's languages in the live Look, by group name. */
const languagesNow = (win: Page) =>
  win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const { state } = await d.engine.snapshot();
    const { groups } = await d.screens.get();
    return Object.fromEntries(groups.map((g) => [g.name, state.look.groups[g.id]?.languages ?? null]));
  });

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
  // The outputs opened again with that Done: each is listed once its page is (a moment after).
  await expect.poll(() => openOutputs(app)).toBe(2);
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

// ---- Session 51 (S3-2 to S3-5) ---------------------------------------------------------------------------------

test('Screens’ Shows and a key and fill pair’s Sends ask too: Esc goes back to the role as it was, Enter keeps, Go back sends the fill again', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ ...ASKS, DRASHTI_EXTRA_DISPLAYS: '2' });
  const win = await operatorPage(app);
  await operatorReady(win);
  // A group on both pretend displays, each kept.
  const groupId = await makeGroup(win, 'Switcher');
  for (const displayId of [PRETEND, PRETEND + 1]) {
    await screensChange(() =>
      win.evaluate(({ g, d }) => (globalThis as PageGlobals).drashti.screens.assignDisplay(g, d), {
        g: groupId,
        d: displayId,
      }),
    );
    await screensChange(() => win.evaluate(() => (globalThis as PageGlobals).drashti.screens.keep()));
  }
  await expect.poll(() => openOutputs(app)).toBe(2);
  const before = await screensNow(win);
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const shows = win.getByTestId('group-role');
  const question = win.getByTestId('keep-screens');

  // Shows: the stage view. Asked; Esc goes back to the audience picture, exactly as it was.
  await shows.selectOption('stage');
  await expect(question).toContainText('Keep these screens?');
  await expect(question.getByTestId('keep-screens-keep')).toBeFocused();
  await win.keyboard.press('Escape');
  await expect(question).toHaveCount(0);
  await expect.poll(() => screensNow(win)).toEqual(before);
  await expect(shows).toHaveValue('audience');

  // Shows: key and fill. Asked; Enter keeps: the first display sends the fill, the second the key.
  await shows.selectOption('keyfill');
  await expect(question).toContainText('Keep these screens?');
  await win.keyboard.press('Enter');
  await expect(question).toHaveCount(0);
  const sends = win.getByTestId('screen-feed');
  await expect(sends).toHaveCount(2);
  await expect(sends.first()).toHaveValue('fill');
  await expect(sends.last()).toHaveValue('key');

  // Sends: the key on the first too. Asked; Go back sends the fill again.
  await sends.first().selectOption('key');
  await expect(question).toContainText('Keep these screens?');
  await question.getByTestId('keep-screens-go-back').click();
  await expect(question).toHaveCount(0);
  await expect(sends.first()).toHaveValue('fill');
  expect(await pending(win)).toBeNull();
  await app.close();
});

test('Go back puts back only what the change changed: another group’s languages, changed while it waited, stay', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ ...ASKS, DRASHTI_EXTRA_DISPLAYS: '2' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const hall = await makeGroup(win, 'Main Hall');
  await screensChange(() =>
    win.evaluate(({ g, d }) => (globalThis as PageGlobals).drashti.screens.assignDisplay(g, d), {
      g: hall,
      d: PRETEND,
    }),
  );
  await screensChange(() => win.evaluate(() => (globalThis as PageGlobals).drashti.screens.keep()));
  await screensChange(() =>
    win.evaluate((g) => (globalThis as PageGlobals).drashti.screens.setGroupLanguages(g, ['gu']), hall),
  );
  const lobby = await makeGroup(win, 'Lobby');
  await screensChange(() =>
    win.evaluate((g) => (globalThis as PageGlobals).drashti.screens.setGroupLanguages(g, ['en']), lobby),
  );

  // Set Up Screens…'s Done, as the wizard sends it: the hall in English, the stage view on the other display.
  const done = await win.evaluate(
    (d) =>
      (globalThis as PageGlobals).drashti.setup.finish({
        outputs: [
          { displayId: d, use: 'audience', languages: ['en'] },
          { displayId: d + 1, use: 'stage', languages: null },
        ],
        sound: 'skip',
        themeId: null,
      }),
    PRETEND,
  );
  expect(done.ok).toBe(true);
  const question = win.getByTestId('keep-screens');
  await expect(question).toContainText('Keep these screens?');
  expect(await languagesNow(win)).toMatchObject({ 'Main Hall': ['en'], Lobby: ['en'] });
  // While it waits, the lobby in Hindi (Screens' languages: not part of the change).
  await screensChange(() =>
    win.evaluate((g) => (globalThis as PageGlobals).drashti.screens.setGroupLanguages(g, ['hi']), lobby),
  );

  // Go back: the hall in Gujarati again and the stage gone; the lobby stays in Hindi.
  await win.keyboard.press('Escape');
  await expect(question).toHaveCount(0);
  await expect.poll(() => languagesNow(win)).toMatchObject({ 'Main Hall': ['gu'], Lobby: ['hi'] });
  expect((await screensNow(win)).groups.map((g) => [g.name, g.screens.length])).toEqual([
    ['Main Hall', 1],
    ['Lobby', 0],
    ['Stream', 0],
  ]);
  await expect.poll(() => openOutputs(app)).toBe(1);
  await app.close();
});

test('a dialog opened while the question waits goes under it: Keep keeps the keyboard, Esc and Enter answer it, then that dialog has the keyboard', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ ...ASKS, DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const groupId = await makeGroup(win, 'Main Hall');
  const ask = () =>
    screensChange(() =>
      win.evaluate(({ g, d }) => (globalThis as PageGlobals).drashti.screens.assignDisplay(g, d), {
        g: groupId,
        d: PRETEND,
      }),
    );
  const question = win.getByTestId('keep-screens');
  const keep = question.getByTestId('keep-screens-keep');
  /** Whether the question is what is drawn at Keep's middle: nothing over it. */
  const questionOnTop = () =>
    win.evaluate(() => {
      const button = document.querySelector('[data-testid="keep-screens-keep"]');
      if (!button) return false;
      const box = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    });

  // Asked; Help › Guides… opened meanwhile, from the menu: under the question, which keeps the keyboard.
  await ask();
  await expect(keep).toBeFocused();
  await chooseMenuItem(app, 'guides');
  const guides = win.getByTestId('guides');
  await expect(guides).toBeVisible();
  await expect.poll(questionOnTop).toBe(true);
  await expect(keep).toBeFocused();
  // Esc goes back; the guides stay, with the keyboard now (Esc closes them).
  await win.keyboard.press('Escape');
  await expect(question).toHaveCount(0);
  await expect.poll(() => openOutputs(app)).toBe(0);
  await expect(guides).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(guides).toHaveCount(0);

  // Asked again; the keys sheet opened meanwhile: Enter keeps.
  await ask();
  await chooseMenuItem(app, 'keyboard-shortcuts');
  const keys = win.getByTestId('keys-sheet');
  await expect(keys).toBeVisible();
  await expect.poll(questionOnTop).toBe(true);
  await expect(keep).toBeFocused();
  await win.keyboard.press('Enter');
  await expect(question).toHaveCount(0);
  expect(await pending(win)).toBeNull();
  await expect.poll(() => openOutputs(app)).toBe(1);
  await expect(keys).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(keys).toHaveCount(0);
  await app.close();
});

test('Drashti stopped dead while the question waits: the next start goes back to the screens as they were, opens no output for the change, and says so', async () => {
  test.setTimeout(150_000);
  const env = { ...ASKS, DRASHTI_EXTRA_DISPLAYS: '1' };
  const first = await launchApp(env);
  const win = await operatorPage(first.app);
  await operatorReady(win);
  const groupId = await makeGroup(win, 'Main Hall');
  const before = await screensNow(win);
  await screensChange(() =>
    win.evaluate(({ g, d }) => (globalThis as PageGlobals).drashti.screens.assignDisplay(g, d), {
      g: groupId,
      d: PRETEND,
    }),
  );
  await expect(win.getByTestId('keep-screens')).toContainText('Keep these screens?');
  await expect.poll(() => openOutputs(first.app)).toBe(1);
  // Kept on disk while it waits (written before the change's answer): then a crash or a power cut.
  const waiting = join(first.userData, 'keep-screens.json');
  expect(existsSync(waiting)).toBe(true);
  await killApp(first.app);

  const second = await relaunchApp(first.userData, env);
  const win2 = await operatorPage(second.app);
  await operatorReady(win2);
  expect((await screensNow(win2)).groups).toEqual(before.groups);
  await holdStill(() => openOutputs(second.app) === 0, 3000, 'no output opens for a change nobody kept');
  expect(await pending(win2)).toBeNull();
  expect(existsSync(waiting)).toBe(false);
  await expect(win2.getByTestId('operator-notice')).toContainText(
    'Drashti stopped before the change to the screens was kept, so they went back to how they were before it.',
  );
  await second.app.close();
});
