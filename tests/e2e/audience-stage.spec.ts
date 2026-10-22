import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { apiCall, NETWORK_ENV, networkOn, pairToken } from './devices';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  NO_PLACEHOLDERS,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  relaunchApp,
  setUpScreen,
} from './helpers';

/*
 * Audience and Stage (Session 50): two switches, each giving this computer's screens of its kind back to the
 * computer, and taking them again. Off closes those output windows; the show carries on (the engine, LIVE, the
 * other switch's screens). Turning one off asks first while its screens show something; on never asks. The
 * status bar says "Audience off" or "Stage off" with Turn on, in Simple Mode too (which can only turn them on).
 * Both are on again at every start. Mod+1 and Mod+2 are the page's keys only (the View menu's items carry no
 * accelerator), so one press acts once.
 *
 * Two outputs on one computer, as quiet runs make them: windowed, the second on a pretend display. No window is
 * assumed wider than 1024: the keys and the status bar do the switching here, never a header button that a
 * narrow window could crowd. Placeholder words only.
 */

const OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
/** The roles of the output windows open now, sorted. */
const openRoles = async (app: ElectronApplication) =>
  (await Promise.all(outputPages(app).map(roleOf))).sort();
const outputWith = async (app: ElectronApplication, role: string) => {
  for (const p of outputPages(app)) if ((await roleOf(p)) === role) return p;
  throw new Error(`No ${role} output is open`);
};

/** The hall's screen on the first display and the stage screen on the second; their screen ids. */
async function hallAndStage(win: Page, app: ElectronApplication): Promise<{ hall: string; stage: string }> {
  const hall = await setUpScreen(win, 'Main Hall', 0);
  const stage = await setUpScreen(win, 'Stage', 1);
  await win.evaluate(async (screenId) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.screens.some((x) => x.id === screenId));
    const set = await d.screens.setGroupRole(group?.id ?? '', 'stage');
    if (!set.ok) throw new Error(set.message);
  }, stage);
  await expect.poll(() => openRoles(app)).toEqual(['audience', 'stage']);
  return { hall, stage };
}

/** A placeholder presentation of two slides, its first slide up on the screens; its id. */
async function slideUp(win: Page): Promise<string> {
  return win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.library.newFromWords(
      'Placeholder switches',
      'Placeholder switch line one\n\nPlaceholder switch line two',
    );
    if (!made.ok) throw new Error(made.message);
    const live = await d.engine.dispatch({ type: 'goLive', presentationId: made.id, slideIndex: 0 });
    if (!live.ok) throw new Error(live.message);
    return made.id;
  });
}

const switches = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.screenSwitches.get());

/** How a screen stands now, and the display it is on (or opens on again). */
const standing = (win: Page, screenId: string) =>
  win.evaluate(async (id) => {
    const st = (await (globalThis as PageGlobals).drashti.screens.get()).status.find(
      (s) => s.screenId === id,
    );
    return st ? { state: st.state, displayId: st.displayId } : null;
  }, screenId);

const slideOnScreens = (win: Page) =>
  win.evaluate(async () => {
    const slide = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide;
    return slide ? slide.slideIndex : null;
  });

test('Mod+1 asks first while the hall’s screens show something; off closes only them, the show carries on, and on opens them where they were', async () => {
  test.setTimeout(120_000);
  // Its own slides only (Session 50): with the tests' placeholder presentations, the first would be open in the
  // middle, and Next would start it rather than go on in the slides that are up.
  const { app } = await launchApp({ ...OUTPUTS, ...NO_PLACEHOLDERS });
  const win = await operatorPage(app);
  await operatorReady(win);
  const { hall } = await hallAndStage(win, app);
  const hallPlace = await standing(win, hall);
  expect(hallPlace?.state).toBe('showing');
  await slideUp(win);
  // This window's copy of the show has it too: what it asks depends on that.
  await expect(win.getByTestId('live-text')).toContainText('slide 1 of 2');
  const ask = win.getByTestId('screen-switch-ask');
  const audienceSwitch = win.getByTestId('switch-audience');
  await expect(audienceSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(audienceSwitch).toContainText('On');

  // Something is up: Mod+1 asks first, in the words asked for. Cancel changes nothing.
  await win.keyboard.press(`${MOD}+1`);
  await expect(ask).toContainText('Turn Audience off?');
  await expect(ask).toContainText('The hall’s screens will show this computer’s desktop.');
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toHaveCount(0);
  expect(await openRoles(app)).toEqual(['audience', 'stage']);
  expect(await switches(win)).toEqual({ audience: true, stage: true });

  // Again, and Turn off: only the hall's window closes; the stage screen carries on.
  await win.keyboard.press(`${MOD}+1`);
  await ask.getByRole('button', { name: 'Turn off' }).click();
  await expect.poll(() => openRoles(app)).toEqual(['stage']);
  expect(await switches(win)).toEqual({ audience: false, stage: true });
  // Said in words, in the top bar and the status bar; off on purpose, never failed.
  await expect(audienceSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(audienceSwitch).toContainText('Off');
  await expect(win.getByTestId('switch-off-audience')).toContainText('Audience off');
  await expect(win.getByTestId('switch-off-stage')).toHaveCount(0);
  expect(await standing(win, hall)).toEqual({ state: 'switched-off', displayId: hallPlace?.displayId });
  // Screens: the hall's screen (named after its display) says so, and how it comes back.
  await win.keyboard.press(`${MOD}+Shift+S`);
  const row = win.getByTestId('screen-row').filter({ has: win.getByTestId('screen-switched-off') });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('screen-state')).toHaveText('Switched off');
  await expect(row.getByTestId('screen-switched-off')).toContainText('Audience is off');
  await win.keyboard.press('Escape');
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  await win.getByTestId('screens-summary').click();
  const card = win.locator(`[data-testid="dashboard-display"][data-screen="${hall}"]`);
  await expect(card.getByTestId('dashboard-state')).toHaveText('Audience off');
  await win.keyboard.press('Escape');
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);

  // The show carries on: the slide is still up, LIVE says so, and Next moves on, the stage screen following.
  expect(await slideOnScreens(win)).toBe(0);
  await expect(win.getByTestId('live-text')).toContainText('slide 1 of 2');
  await win.keyboard.press('ArrowRight');
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 2');
  const stage = await outputWith(app, 'stage');
  await expect(stage.getByTestId('stage-current')).toContainText('Placeholder switch line two');

  // Mod+1 again: on at once, never asked, on the display it was on, showing the show as it is now.
  await win.keyboard.press(`${MOD}+1`);
  await expect.poll(() => openRoles(app)).toEqual(['audience', 'stage']);
  await expect(ask).toHaveCount(0);
  expect(await standing(win, hall)).toEqual({ state: 'showing', displayId: hallPlace?.displayId });
  await expect(win.getByTestId('switch-off-audience')).toHaveCount(0);
  await expect(audienceSwitch).toHaveAttribute('aria-checked', 'true');
  const back = await outputWith(app, 'audience');
  await expect(back.locator('[data-layer="slide"]')).toContainText('Placeholder switch line two');
  expect(await slideOnScreens(win)).toBe(1);
  await app.close();
});

test('Mod+2 asks first whenever a stage screen is open, closes only the stage screens, and the status bar’s Turn on brings them back; a Remote is told', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ ...OUTPUTS, ...NETWORK_ENV });
  const win = await operatorPage(app);
  await operatorReady(win);
  const { stage } = await hallAndStage(win, app);
  const hallWindow = await outputWith(app, 'audience');
  const { port } = await networkOn(win);
  const token = await pairToken(win, port, 'remote', 'Placeholder phone');
  const hallAnswer = () => apiCall(port, '/api/v1/hall', { token }).then((r) => r.json['switches']);
  expect(await hallAnswer()).toEqual({ audience: true, stage: true });

  // Nothing is up, but the stage screens always show the stage view: asked first.
  const ask = win.getByTestId('screen-switch-ask');
  await win.keyboard.press(`${MOD}+2`);
  await expect(ask).toContainText('Turn Stage off?');
  await expect(ask).toContainText('The stage screens will show this computer’s desktop.');
  await ask.getByRole('button', { name: 'Turn off' }).click();
  await expect.poll(() => openRoles(app)).toEqual(['audience']);
  // The hall's window is the same one, never closed or opened again.
  expect(hallWindow.isClosed()).toBe(false);
  expect((await standing(win, stage))?.state).toBe('switched-off');
  const off = win.getByTestId('switch-off-stage');
  await expect(off).toContainText('Stage off');
  await expect(win.getByTestId('switch-stage')).toContainText('Off');
  // A Remote is told which are off, and has no way to turn them.
  await expect.poll(hallAnswer).toEqual({ audience: true, stage: false });

  // One click in the status bar: on again, never asked.
  await off.getByRole('button', { name: 'Turn on Stage' }).click();
  await expect.poll(() => openRoles(app)).toEqual(['audience', 'stage']);
  await expect(off).toHaveCount(0);
  await expect(ask).toHaveCount(0);
  expect(hallWindow.isClosed()).toBe(false);
  await expect.poll(hallAnswer).toEqual({ audience: true, stage: true });
  await app.close();
});

test('one press acts once: the View menu’s Audience and Stage carry no key, their ticks follow, and Uncover leaves them alone', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(OUTPUTS);
  const win = await operatorPage(app);
  await operatorReady(win);
  const hall = await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => openRoles(app)).toEqual(['audience']);
  const item = (id: string) =>
    app.evaluate(({ Menu }, itemId) => {
      const found = Menu.getApplicationMenu()?.getMenuItemById(itemId);
      return found ? { checked: found.checked, accelerator: found.accelerator ?? null } : null;
    }, id);
  expect(await item('screen-switch-audience')).toEqual({ checked: true, accelerator: null });
  expect(await item('screen-switch-stage')).toEqual({ checked: true, accelerator: null });

  // Nothing is up on the hall's screen: Mod+1 turns it off at once, and once (a second act would turn it back on).
  await win.keyboard.press(`${MOD}+1`);
  await expect.poll(() => openRoles(app)).toEqual([]);
  await holdStill(
    async () => !(await switches(win)).audience && outputPages(app).length === 0,
    1500,
    'one press of Mod+1 turned Audience off once, and nothing turned it back on',
  );
  await expect(win.getByTestId('screen-switch-ask')).toHaveCount(0);
  await expect.poll(() => item('screen-switch-audience')).toEqual({ checked: false, accelerator: null });

  // Uncover the controls works as before, apart from the switches: it leaves them as they are (windowed outputs
  // never cover the controls, so here it turns nothing off either).
  await win.evaluate(() => (globalThis as PageGlobals).drashti.screens.uncoverOperator());
  expect(await switches(win)).toEqual({ audience: false, stage: true });
  expect((await standing(win, hall))?.state).toBe('switched-off');

  // The View menu's item turns it on (nothing to ask), and its tick follows.
  await chooseMenuItem(app, 'screen-switch-audience');
  await expect.poll(() => openRoles(app)).toEqual(['audience']);
  await expect.poll(() => item('screen-switch-audience')).toEqual({ checked: true, accelerator: null });
  await app.close();
});

test('both are on again at every start; Simple Mode only turns them on: Mod+1 and the status bar, never off', async () => {
  test.setTimeout(150_000);
  const { app, userData } = await launchApp(OUTPUTS);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => openRoles(app)).toEqual(['audience']);
  await win.keyboard.press(`${MOD}+1`);
  await expect.poll(() => openRoles(app)).toEqual([]);
  expect(await switches(win)).toEqual({ audience: false, stage: true });

  // Quit with Audience off, and start again: both on, never remembered.
  await app.close();
  const again = await relaunchApp(userData, OUTPUTS);
  const next = await operatorPage(again.app);
  await operatorReady(next);
  await expect.poll(() => openRoles(again.app)).toEqual(['audience']);
  expect(await switches(next)).toEqual({ audience: true, stage: true });
  await expect(next.getByTestId('switch-off-audience')).toHaveCount(0);

  // Off in Pro Mode, then Simple Mode: it says so, and turns it on; it never turns one off.
  await next.keyboard.press(`${MOD}+1`);
  await expect.poll(() => openRoles(again.app)).toEqual([]);
  await chooseMenuItem(again.app, 'switch-mode');
  await expect(next.getByTestId('simple-mode')).toBeVisible();
  // Simple Mode's View menu has neither switch.
  expect(
    await again.app.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('screen-switch-audience') ?? null,
    ),
  ).toBeNull();
  const off = next.getByTestId('switch-off-audience');
  await expect(off).toContainText('Audience off');
  await next.keyboard.press(`${MOD}+1`);
  await expect.poll(() => openRoles(again.app)).toEqual(['audience']);
  await expect(off).toHaveCount(0);
  await next.keyboard.press(`${MOD}+1`);
  await holdStill(
    () => outputPages(again.app).length === 1,
    1000,
    'Mod+1 in Simple Mode leaves an Audience that is on as it is',
  );
  const refused = await next.evaluate(() =>
    (globalThis as PageGlobals).drashti.screenSwitches.turn('audience', false),
  );
  expect(refused).toMatchObject({ ok: false });
  expect(await switches(next)).toEqual({ audience: true, stage: true });
  // Stage off from Pro Mode is still Simple Mode's to turn on, from the status bar.
  await next.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const leave = await d.app.setMode('pro', 'pro');
    if (!leave.ok) throw new Error(leave.message);
    const turned = await d.screenSwitches.turn('stage', false);
    if (!turned.ok) throw new Error(turned.message);
    const back = await d.app.setMode('simple');
    if (!back.ok) throw new Error(back.message);
  });
  await expect(next.getByTestId('simple-mode')).toBeVisible();
  const stageOff = next.getByTestId('switch-off-stage');
  await expect(stageOff).toContainText('Stage off');
  await stageOff.getByRole('button', { name: 'Turn on Stage' }).click();
  await expect(stageOff).toHaveCount(0);
  expect(await switches(next)).toEqual({ audience: true, stage: true });
  await again.app.close();
});
