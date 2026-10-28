import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { IPC } from '../../src/shared/ipc';
import type { StreamStatus } from '../../src/shared/stream';
import { apiCall, NETWORK_ENV, networkOn, pairToken } from './devices';
import { expectFits } from './fit';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  needsRealScreen,
  NO_PLACEHOLDERS,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  type PageGlobals,
  relaunchApp,
  setUpScreen,
  windowShowing,
} from './helpers';

/*
 * Audience and Stage (Session 50): two switches, each giving this computer's screens of its kind back to the
 * computer, and taking them again. Off closes those output windows; the show carries on (the engine, LIVE, the
 * other switch's screens). Turning one off asks first while its screens show something; on never asks. The
 * status bar says "Audience off" or "Stage off" with Turn on, in Simple Mode too (which can only turn them on).
 * Both are on again at every start. Mod+1 and Mod+2 are the page's keys: the View menu's items show them without
 * binding them (Session 51), so one press acts once.
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
  // A Remote is told which are off (and since Session 54 turns them as the window does: phone-desktop.spec.ts).
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

test('one press acts once: the View menu’s Audience and Stage show their keys unbound, their ticks follow, and Uncover leaves them alone', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(OUTPUTS);
  const win = await operatorPage(app);
  await operatorReady(win);
  const hall = await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => openRoles(app)).toEqual(['audience']);
  // Each item as the menu has it now, built again with every change: its tick, and its key shown and left unbound
  // (Session 51; function-keys.spec.ts presses the keys in a field and under a dialog).
  const item = (id: string) =>
    app.evaluate(({ Menu }, itemId) => {
      const found = Menu.getApplicationMenu()?.getMenuItemById(itemId);
      return found
        ? {
            checked: found.checked,
            accelerator: found.accelerator ?? null,
            registerAccelerator: found.registerAccelerator,
          }
        : null;
    }, id);
  const shown = (checked: boolean, accelerator: string) => ({
    checked,
    accelerator,
    registerAccelerator: false,
  });
  expect(await item('screen-switch-audience')).toEqual(shown(true, 'CommandOrControl+1'));
  expect(await item('screen-switch-stage')).toEqual(shown(true, 'CommandOrControl+2'));

  // Nothing is up on the hall's screen: Mod+1 turns it off at once, and once (a second act would turn it back on).
  await win.keyboard.press(`${MOD}+1`);
  await expect.poll(() => openRoles(app)).toEqual([]);
  await holdStill(
    async () => !(await switches(win)).audience && outputPages(app).length === 0,
    1500,
    'one press of Mod+1 turned Audience off once, and nothing turned it back on',
  );
  await expect(win.getByTestId('screen-switch-ask')).toHaveCount(0);
  await expect.poll(() => item('screen-switch-audience')).toEqual(shown(false, 'CommandOrControl+1'));
  expect(await item('screen-switch-stage')).toEqual(shown(true, 'CommandOrControl+2'));

  // Uncover the controls works as before, apart from the switches: it leaves them as they are (windowed outputs
  // never cover the controls, so here it turns nothing off either).
  await win.evaluate(() => (globalThis as PageGlobals).drashti.screens.uncoverOperator());
  expect(await switches(win)).toEqual({ audience: false, stage: true });
  expect((await standing(win, hall))?.state).toBe('switched-off');

  // The View menu's item turns it on (nothing to ask), and its tick follows.
  await chooseMenuItem(app, 'screen-switch-audience');
  await expect.poll(() => openRoles(app)).toEqual(['audience']);
  await expect.poll(() => item('screen-switch-audience')).toEqual(shown(true, 'CommandOrControl+1'));
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

// ---- Session 51: the reviewers' S2 items ----------------------------------------------------------------------

/** The change waiting for Keep these screens?, as the main process has it. */
const pending = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.screens.pending());

/**
 * The top bar as laid out now (Session 51, S2-3): its name, every button and the states' panel inside the window,
 * none over another, each button's words fitting, nothing scrolling sideways; and what the states' panel holds (ON
 * AIR, REC and No sound, the network's badge, LIVE's or Off's) inside it, in sight.
 */
async function expectTopBarFits(win: Page, what: string): Promise<void> {
  const problems = await win.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth > vw)
      out.push(`the page scrolls sideways (${String(document.documentElement.scrollWidth)} > ${String(vw)})`);
    const header = document.querySelector('[data-testid="app-header"]');
    const states = document.querySelector('[data-testid="header-states"]');
    if (!header || !states) return ['no top bar'];
    if (header.scrollWidth > header.clientWidth + 1) out.push('the top bar scrolls sideways');
    const name = (el: Element) =>
      el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? el.textContent.trim().slice(0, 40);
    const box = (el: Element) => el.getBoundingClientRect();
    const parts = [...header.querySelectorAll('h1, button'), states].filter((el) => box(el).width > 0);
    for (const el of parts) {
      const r = box(el);
      if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5)
        out.push(`${name(el)} is cut off by the window edge`);
      if (el instanceof HTMLButtonElement && el.scrollWidth > el.clientWidth + 1)
        out.push(`${name(el)}: its words do not fit`);
    }
    parts.forEach((one, i) => {
      for (const other of parts.slice(i + 1)) {
        if (one.contains(other) || other.contains(one)) continue;
        const a = box(one);
        const b = box(other);
        const overlap =
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        if (overlap) out.push(`${name(one)} is over ${name(other)}`);
      }
    });
    const panel = box(states);
    for (const el of states.querySelectorAll(
      '[data-testid="on-air"], [data-testid="rec"], [data-testid="no-sound"], [data-testid="network-badge"], [data-badge]',
    )) {
      const r = box(el);
      if (r.width === 0) out.push(`${name(el)} cannot be seen`);
      else if (r.left < panel.left - 0.5 || r.right > panel.right + 0.5)
        out.push(`${name(el)} spills out of the states' panel`);
    }
    return out;
  });
  expect(problems, what).toEqual([]);
}

/**
 * ON AIR and REC in the top bar (Session 51, S2-3's review), and No sound when asked, as the stream's state that
 * the window reads says them: the window alone is told the stream is live (or reconnecting) and recording.
 * Nothing is started or sent anywhere.
 */
async function onAirAndRec(
  app: ElectronApplication,
  win: Page,
  live: 'live' | 'reconnecting',
  noSound: boolean,
): Promise<void> {
  const status = await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
  const told: StreamStatus = {
    ...status,
    live: { ...status.live, state: live },
    recording: { ...status.recording, state: 'recording' },
    noSound: noSound
      ? { since: 0, why: 'quiet', message: 'Placeholder: no sound has reached the stream.' }
      : null,
  };
  await app.evaluate(
    ({ BrowserWindow }, { channel, payload }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('index.html'))
        ?.webContents.send(channel, payload);
    },
    { channel: IPC.stream.changed, payload: told },
  );
  await expect(win.getByTestId('on-air')).toHaveText(live === 'live' ? 'On air' : 'On air · reconnecting');
  await expect(win.getByTestId('rec')).toBeVisible();
  await expect(win.getByTestId('no-sound')).toHaveCount(noSound ? 1 : 0);
}

test('the top bar fits at 1024 × 645 and 1280 × 720 with Phones on: nothing cut off, nothing over another, no sideways scroll', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await networkOn(win);
  const header = win.getByTestId('app-header');
  await expect(header.getByTestId('network-badge')).toBeVisible();
  await expect(header.getByTestId('open-announcements')).toBeVisible();
  // No button says who is at the controls (Session 54, E5: roles are gone).
  await expect(header.getByTestId('role-chip')).toHaveCount(0);
  const sizes = [
    [1024, 645],
    [1280, 720],
  ] as const;
  for (const [width, height] of sizes) {
    await win.setViewportSize({ width, height });
    await expectTopBarFits(win, `the top bar at ${String(width)} × ${String(height)}, with Phones on`);
    // Crowded, its buttons keep their names for the keyboard and screen readers; Screens and the switches their words.
    for (const words of ['Themes', 'Stream', 'Phones', 'Announcements', 'Simple Mode'])
      await expect(header.getByRole('button', { name: words, exact: true })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Screens', exact: true })).toContainText('Screens');
    await expect(header.getByTestId('switch-audience')).toContainText('On');
    await expect(header.getByTestId('switch-stage')).toContainText('On');
  }
  // On air and recording too, and reconnecting, or with No sound: still nothing cut off or over another.
  const streams = [
    { live: 'live', noSound: false, words: 'on air and recording' },
    { live: 'reconnecting', noSound: false, words: 'reconnecting and recording' },
    { live: 'live', noSound: true, words: 'on air and recording, with no sound' },
  ] as const;
  for (const [width, height] of sizes)
    for (const stream of streams) {
      await win.setViewportSize({ width, height });
      await onAirAndRec(app, win, stream.live, stream.noSound);
      await expectTopBarFits(win, `the top bar at ${String(width)} × ${String(height)}, ${stream.words}`);
    }
  await app.close();
});

test('a hall screen switched off, turned off and on again in Screens, asks nothing; Audience on, it is back where it was', async () => {
  test.setTimeout(120_000);
  // Keep these screens? asks here, as it does for the operators.
  const { app } = await launchApp({ ...OUTPUTS, DRASHTI_TEST_KEEP_SCREENS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const hall = await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => openRoles(app)).toEqual(['audience']);
  const place = await standing(win, hall);
  expect(place?.state).toBe('showing');
  // Nothing up: Mod+1 turns it off at once.
  await win.keyboard.press(`${MOD}+1`);
  await expect.poll(() => openRoles(app)).toEqual([]);

  // In Screens, its On, off and on again: no output is put on a display while Audience is off, so nothing asks.
  await win.keyboard.press(`${MOD}+Shift+S`);
  const state = win.getByTestId('screen-state');
  await expect(state).toHaveText('Switched off');
  const on = win.getByTestId('screen-row').getByLabel('On', { exact: true });
  await on.click();
  await expect(state).toHaveText('Off');
  await on.click();
  await expect(state).toHaveText('Switched off');
  await holdStill(
    async () => (await pending(win)) === null && outputPages(app).every((p) => p.isClosed()),
    1500,
    'turned on again while Audience is off, nothing is asked and nothing opens',
  );
  await expect(win.getByTestId('keep-screens')).toHaveCount(0);
  expect(await standing(win, hall)).toEqual({ state: 'switched-off', displayId: place?.displayId });
  await win.keyboard.press('Escape');
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);

  // Audience on: on the display it was on, never asked.
  await win.getByTestId('switch-off-audience').getByRole('button', { name: 'Turn on Audience' }).click();
  await expect.poll(() => openRoles(app)).toEqual(['audience']);
  expect(await standing(win, hall)).toEqual({ state: 'showing', displayId: place?.displayId });
  expect(await pending(win)).toBeNull();
  await expect(win.getByTestId('keep-screens')).toHaveCount(0);
  await app.close();
});

test('the screens dashboard shows a switched-off screen as off, never its last picture', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(OUTPUTS);
  const win = await operatorPage(app);
  await operatorReady(win);
  const hall = await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => openRoles(app)).toEqual(['audience']);
  await win.getByTestId('screens-summary').click();
  const card = win.locator(`[data-testid="dashboard-display"][data-screen="${hall}"]`);
  // Its picture first, as it shows the show (taken every 3 s while the dashboard is open).
  await expect(card.getByTestId('dashboard-thumb')).toBeVisible({ timeout: 20_000 });
  /** Audience off or on, as the switch does (the dashboard has the keyboard while it is open). */
  const audience = (on: boolean) =>
    win.evaluate(async (isOn) => {
      const turned = await (globalThis as PageGlobals).drashti.screenSwitches.turn('audience', isOn);
      if (!turned.ok) throw new Error(turned.message);
    }, on);

  await audience(false);
  await expect.poll(() => openRoles(app)).toEqual([]);
  await expect(card.getByTestId('dashboard-state')).toHaveText('Audience off');
  await expect(card.getByTestId('dashboard-thumb')).toHaveCount(0);
  await expect(card.getByTestId('dashboard-no-picture')).toHaveText('This computer’s desktop');
  // Past the next picture or two the dashboard takes: its last one never comes back while it is off.
  await holdStill(
    async () => (await card.getByTestId('dashboard-thumb').count()) === 0,
    4000,
    'a switched-off screen shows no picture on the dashboard',
  );

  // On again: showing, with a picture of its own again.
  await audience(true);
  await expect(card.getByTestId('dashboard-state')).toHaveText('Showing');
  await expect(card.getByTestId('dashboard-thumb')).toBeVisible({ timeout: 20_000 });
  await app.close();
});

test('in the first moments, before the window knows which screens are open, turning one off asks', async () => {
  test.setTimeout(150_000);
  const { app, userData } = await launchApp(OUTPUTS);
  const win = await operatorPage(app);
  await operatorReady(win);
  await hallAndStage(win, app);
  await app.close();

  // Started again, the window told the screens 20 s after it asks for them (a test's first moments, held).
  const again = await relaunchApp(userData, { ...OUTPUTS, DRASHTI_TEST_SCREENS_LATE_MS: '20000' });
  const next = await operatorPage(again.app);
  await operatorReady(next);
  await expect.poll(() => openRoles(again.app)).toEqual(['audience', 'stage']);
  // The window does not know them yet.
  await expect(next.getByTestId('screens-summary')).toContainText('No screens set up');
  // Nothing is up, but nothing is known: asked first, the safe side.
  const ask = next.getByTestId('screen-switch-ask');
  await next.keyboard.press(`${MOD}+1`);
  await expect(ask).toContainText('Turn Audience off?');
  await expect(ask.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toHaveCount(0);
  expect(await switches(next)).toEqual({ audience: true, stage: true });
  expect(await openRoles(again.app)).toEqual(['audience', 'stage']);
  await again.app.close();
});

test('covering the controls: Mod+1’s question shows on that output too; Esc cancels, the output’s own answer counts, Enter turns Audience off', async () => {
  needsRealScreen();
  test.setTimeout(150_000);
  // Real outputs (CI's one display, 1024 wide): the hall's picture over the controls.
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const count = await app.evaluate(({ screen }) => screen.getAllDisplays().length);
    test.skip(count > 1, 'Another display is free: the controls move there instead of being covered');
    const controls = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'));
      return w ? screen.getDisplayMatching(w.getBounds()).id : -1;
    });
    // On the controls' display, as Screens puts it once the operator agreed.
    await win.evaluate(async (displayId) => {
      const d = (globalThis as PageGlobals).drashti;
      const created = await d.screens.createGroup('Main Hall');
      if (!created.ok) throw new Error(created.message);
      const groupId = created.snapshot.groups.find((g) => g.name === 'Main Hall')?.id ?? '';
      const assigned = await d.screens.assignDisplay(groupId, displayId, { coverOperator: true });
      if (!assigned.ok) throw new Error(assigned.message);
    }, controls);
    const out = await windowShowing(
      app,
      (p) => p.url().includes('output.html') && !p.url().includes('identify=') && !p.isClosed(),
      'output',
    );
    // A real full-screen output draws once its fonts are in and its warm-up is done (up to 8 s on CI's Mac).
    await outputReady(out);
    await slideUp(win);
    await expect(out.locator('[data-layer="slide"]')).toContainText('Placeholder switch line one');
    const ask = win.getByTestId('screen-switch-ask');
    const big = out.getByTestId('switch-question');

    // Mod+1: asked in the window under it and, large, on the output; Turn off has the keyboard, so Enter does it.
    await win.keyboard.press(`${MOD}+1`);
    await expect(big).toContainText('Turn Audience off?');
    await expect(big).toContainText('The hall’s screens will show this computer’s desktop.');
    await expect(big).toContainText('Enter turns Audience off');
    await expectFits(big, 'Turn Audience off? on the output over the controls');
    await expect(ask.getByTestId('screen-switch-covered')).toBeVisible();
    await expect(ask.getByTestId('screen-switch-turn-off')).toBeFocused();
    // Esc: nothing changes, and the question goes from both.
    await win.keyboard.press('Escape');
    await expect(ask).toHaveCount(0);
    await expect(big).toHaveCount(0);
    expect(await switches(win)).toEqual({ audience: true, stage: true });
    expect(out.isClosed()).toBe(false);

    // The output's own Esc, as it sends it when it has the keyboard (a windowed output): the same.
    await win.keyboard.press(`${MOD}+1`);
    await expect(big).toBeVisible();
    await out.evaluate(() => {
      void (globalThis as PageGlobals).drashti.output.switchAnswer(false);
    });
    await expect(ask).toHaveCount(0);
    await expect(big).toHaveCount(0);
    expect(await switches(win)).toEqual({ audience: true, stage: true });

    // Enter: Audience off; the output over the controls closes, and with it the question.
    await win.keyboard.press(`${MOD}+1`);
    await expect(big).toBeVisible();
    await win.keyboard.press('Enter');
    await expect.poll(() => switches(win)).toEqual({ audience: false, stage: true });
    await expect.poll(() => outputPages(app).filter((p) => !p.isClosed()).length).toBe(0);
    await expect(ask).toHaveCount(0);
  } finally {
    await app.close();
  }
});
