import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import WebSocket from 'ws';
import type { ToDevice } from '../../src/shared/network';
import { NETWORK_ENV, networkOn, pairToken } from './devices';
import { expectPhoneRefuses } from './phone-refuses';
import {
  launchApp,
  openSection,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  type PageGlobals,
  relaunchApp,
  windowShowing,
} from './helpers';

/*
 * Stage starts off, and can always be started (alpha.22; the owner, 24 Nov 2026: "right now i am unable to setup
 * stage screen even its on. by default it should be off. keep it off. i can turn on, and then turn off. right now i
 * am unable to start"). Until alpha.22 Stage was On at every start, and its switch only changed what stage screens
 * that already existed showed: with the laptop alone, or the laptop and the hall's projector, no display had the
 * Stage job, so Stage On started nothing, said nothing and offered nothing. Now: Stage starts off on a new library
 * (and once after the update), then as it was left; On and Off work every time, from the top bar, the status bar
 * and the keys (a phone is refused them since alpha.23, QA23-PHONE-1); On with no screen set to Stage says so, with
 * Set up Stage screen… (Screens); and the Stage
 * screen panel's Stage preview opens a window on this computer that shows what a stage screen would. The second
 * display plugged in still becomes the stage by itself, and the hall's screens never change with Stage.
 *
 * The displays are Drashti's pretend ones, set by themselves (as screens-set-themselves.spec.ts has them), the
 * outputs windowed. Every other spec starts with Stage on (DRASHTI_TEST_STAGE_AT_START, tests/e2e/helpers.ts); this
 * one starts as an installed Drashti does. Placeholder words only.
 */

/** The first pretend display's id (src/main/outputs/electron-outputs.ts, EXTRA_DISPLAY_ID). */
const PRETEND = 900_000_000;

const AUTO = {
  // As an installed Drashti starts: Stage off on a new library.
  DRASHTI_TEST_STAGE_AT_START: '',
  DRASHTI_TEST_AUTO_SCREENS: 'pretend',
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_TEST_DISPLAY_CHANGES: '1',
  DRASHTI_TEST_DISPLAY_SERIALS: 'PJ-A,PJ-B',
};
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const plugIn = (app: ElectronApplication, n: number) =>
  app.evaluate((_electron, count) => {
    (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays?.(count);
  }, n);

/** The pretend displays' jobs now: each "display: audience | stage" for those given one. */
const jobs = (win: Page) =>
  win.evaluate(async (first) => {
    const s = await (globalThis as PageGlobals).drashti.screens.get();
    return s.uses
      .filter((u) => u.displayId >= first && u.displayId < first + 4 && u.screenId !== null)
      .map((u) => `${String(u.displayId - first + 1)}: ${u.role === 'stage' ? 'stage' : 'audience'}`);
  }, PRETEND);

const switches = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.screenSwitches.get());

const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
const outputWith = async (app: ElectronApplication, role: string) => {
  for (const p of outputPages(app)) if ((await roleOf(p)) === role) return p;
  throw new Error(`No ${role} output is open`);
};
const stageShows = (p: Page) => p.getByTestId('output-root').getAttribute('data-stage-shows');

/** The Stage preview window (alpha.22): a stage screen's page in a window of its own, never a screen. */
const isPreview = (p: Page) => p.url().includes('output.html') && p.url().includes('stagePreview=');

/** The top bar's Stage says On or Off, and the main process agrees. */
async function stageIs(win: Page, on: boolean): Promise<void> {
  await expect(win.getByTestId('switch-stage')).toHaveAttribute('data-on', on ? 'true' : 'false');
  await expect(win.getByTestId('switch-stage')).toContainText(on ? 'On' : 'Off');
  expect((await switches(win)).stage).toBe(on);
  await expect(win.getByTestId('switch-off-stage')).toHaveCount(on ? 0 : 1);
}

/** A tablet's feed opened as its stage display's page opens it (paired-seats.spec.ts): the hello, then the welcome. */
async function connectTablet(port: number, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/api/v1/feed`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      resolve();
    });
    ws.once('error', reject);
  });
  const welcome = new Promise<ToDevice>((resolve) =>
    ws.once('message', (data: Buffer) => {
      resolve(JSON.parse(data.toString('utf8')) as ToDevice);
    }),
  );
  ws.send(JSON.stringify({ type: 'hello', token }));
  expect(await welcome).toMatchObject({ type: 'welcome', device: { kind: 'stage' } });
  return ws;
}

/** The line under the top bar: no screen is set to Stage, with Set up Stage screen…. */
const noStageLine = (win: Page) => win.locator('[data-testid="screens-said"][data-kind="no-stage"]');

test('(a) the controls alone: Stage starts off; on says no screen is set to Stage, with Set up Stage screen… (Screens); on and off every time, from the top bar, the status bar and Mod+2; kept as it was left across a restart', async () => {
  test.setTimeout(150_000);
  const { app, userData } = await launchApp(AUTO);
  const win = await operatorPage(app);
  await operatorReady(win);
  expect(await jobs(win)).toEqual([]);
  // A new library: Stage off, said in the status bar with Turn on.
  await stageIs(win, false);
  expect(await switches(win)).toEqual({ audience: true, stage: false });
  await expect(win.getByTestId('switch-off-stage')).toContainText('Stage off');
  await expect(noStageLine(win)).toHaveCount(0);

  // On from the top bar: there is no stage screen, and it says so, never a silent nothing.
  await win.getByTestId('switch-stage').click();
  await stageIs(win, true);
  await expect(noStageLine(win).getByTestId('screens-said-text')).toHaveText('No screen is set to Stage.');
  await expect(noStageLine(win).getByTestId('screens-said-set-up-stage')).toHaveText('Set up Stage screen…');
  // Off from the top bar: no stage screen is open, so nothing to ask.
  await win.getByTestId('switch-stage').click();
  await expect(win.getByTestId('screen-switch-ask')).toHaveCount(0);
  await stageIs(win, false);
  // On from the status bar's Turn on, off and on with Mod+2: every time.
  await win.getByTestId('switch-off-stage').getByRole('button', { name: 'Turn on Stage' }).click();
  await stageIs(win, true);
  await win.keyboard.press(`${MOD}+2`);
  await stageIs(win, false);
  await win.keyboard.press(`${MOD}+2`);
  await stageIs(win, true);
  // Set up Stage screen… opens Screens, where each display has its job, Stage among them, one click away.
  await noStageLine(win).getByTestId('screens-said-set-up-stage').click();
  const screensDialog = win.getByRole('dialog', { name: 'Screens' });
  await expect(screensDialog).toBeVisible();
  await expect(screensDialog.getByTestId('display-job-stage').first()).toBeVisible();
  await expect(noStageLine(win)).toHaveCount(0);
  await win.keyboard.press('Escape');
  await expect(screensDialog).toHaveCount(0);

  // Left on: on at the next start. Left off: off.
  await app.close();
  const again = await relaunchApp(userData, AUTO);
  const next = await operatorPage(again.app);
  await operatorReady(next);
  await stageIs(next, true);
  await next.getByTestId('switch-stage').click();
  await stageIs(next, false);
  await again.app.close();
  const third = await relaunchApp(userData, AUTO);
  const last = await operatorPage(third.app);
  await operatorReady(last);
  await stageIs(last, false);
  await third.app.close();
});

test('(b) the controls and the hall’s projector: Stage starts off and the hall never changes with it; Edit layouts… works; Stage preview shows what a stage screen would, the layout with Stage on and the audience picture with it off; a phone is refused it, in words', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ ...AUTO, ...NETWORK_ENV });
  const win = await operatorPage(app);
  await operatorReady(win);
  await plugIn(app, 1);
  await expect.poll(() => jobs(win)).toEqual(['1: audience']);
  await expect.poll(() => outputPages(app).length).toBe(1);
  const hall = await outputWith(app, 'audience');
  await outputReady(hall);
  await stageIs(win, false);

  // The Stage screen panel says no screen is set to Stage, with Set up Stage screen… and Stage preview.
  await openSection(win, 'stage');
  const panel = win.getByTestId('stage-message-control');
  await expect(panel.getByTestId('stage-no-screen')).toContainText('No screen is set to Stage.');
  await expect(panel.getByTestId('stage-set-up')).toHaveText('Set up Stage screen…');
  // Edit layouts… opens the stage layout editor, and it closes.
  await panel.getByTestId('stage-edit-layout').click();
  const editor = win.getByTestId('stage-layout-editor');
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Close stage layouts' }).click();
  await expect(editor).toHaveCount(0);

  // Stage preview: a window of its own, a stage screen's page, never one of the hall's screens.
  await panel.getByTestId('stage-preview-open').click();
  const preview = await windowShowing(app, isPreview, 'Stage preview');
  await outputReady(preview);
  await expect(preview.getByTestId('output-root')).toHaveAttribute('data-role', 'stage');
  // Stage off: what a stage screen shows now, the audience picture.
  await expect.poll(() => stageShows(preview)).toBe('audience');
  expect(outputPages(app)).toHaveLength(1);
  expect(await jobs(win)).toEqual(['1: audience']);
  // Pressed again: the same window, brought forward, never a second.
  await panel.getByTestId('stage-preview-open').click();
  await expect.poll(() => app.windows().filter(isPreview).length).toBe(1);

  // On from a phone: refused in words, Stage still off (alpha.23, QA23-PHONE-1); on from the top bar (moved from the
  // phone): the preview shows the layout; the hall's screen is the same window, still the audience's.
  const { port } = await networkOn(win);
  const token = await pairToken(win, port, 'remote', 'Placeholder phone');
  const asks = { win, port, token };
  await expectPhoneRefuses(asks, 'POST', '/api/v1/switches/stage', { on: true }, 'computer', () =>
    switches(win),
  );
  await stageIs(win, false);
  await win.getByTestId('switch-stage').click();
  await stageIs(win, true);
  await expect.poll(() => stageShows(preview)).toBe('standard');
  await expect(noStageLine(win).getByTestId('screens-said-text')).toHaveText('No screen is set to Stage.');
  expect(hall.isClosed()).toBe(false);
  expect(await roleOf(hall)).toBe('audience');
  expect(await stageShows(hall)).toBeNull();
  // Off from the phone: refused, Stage still on; off from the top bar (no stage screen open, nothing to confirm), on
  // again, off again.
  await expectPhoneRefuses(asks, 'POST', '/api/v1/switches/stage', { on: false }, 'computer', () =>
    switches(win),
  );
  await stageIs(win, true);
  await win.getByTestId('switch-stage').click();
  await stageIs(win, false);
  await expect.poll(() => stageShows(preview)).toBe('audience');
  await win.getByTestId('switch-stage').click();
  await stageIs(win, true);
  await expect.poll(() => stageShows(preview)).toBe('standard');
  await win.getByTestId('switch-stage').click();
  await stageIs(win, false);
  expect(hall.isClosed()).toBe(false);
  expect(outputPages(app)).toHaveLength(1);

  // Closed by its own window: the hall's screen carries on.
  await preview.close();
  await expect.poll(() => app.windows().filter(isPreview).length).toBe(0);
  expect(hall.isClosed()).toBe(false);
  await app.close();
});

test('(c) the controls and two projectors: the second is the stage by itself, showing the audience picture while Stage is off; on shows its layout, off asks first; the hall’s screen never changes', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(AUTO);
  const win = await operatorPage(app);
  await operatorReady(win);
  await plugIn(app, 2);
  await expect.poll(() => jobs(win)).toEqual(['1: audience', '2: stage']);
  await expect.poll(() => outputPages(app).length).toBe(2);
  const hall = await outputWith(app, 'audience');
  const stage = await outputWith(app, 'stage');
  await outputReady(stage);
  await stageIs(win, false);
  await expect.poll(() => stageShows(stage)).toBe('audience');

  // On: its own layout, the same window; nothing says no screen is set to Stage.
  await win.getByTestId('switch-stage').click();
  await stageIs(win, true);
  await expect.poll(() => stageShows(stage)).toBe('standard');
  await expect(noStageLine(win)).toHaveCount(0);
  await openSection(win, 'stage');
  await expect(win.getByTestId('stage-no-screen')).toHaveCount(0);
  // Off: a stage screen is open, so it asks first.
  await win.getByTestId('switch-stage').click();
  const ask = win.getByTestId('screen-switch-ask');
  await expect(ask).toContainText('Turn Stage off?');
  await ask.getByRole('button', { name: 'Turn off' }).click();
  await stageIs(win, false);
  await expect.poll(() => stageShows(stage)).toBe('audience');
  // On again from the status bar.
  await win.getByTestId('switch-off-stage').getByRole('button', { name: 'Turn on Stage' }).click();
  await stageIs(win, true);
  await expect.poll(() => stageShows(stage)).toBe('standard');
  // The hall's screen: the same window throughout, the audience's.
  expect(hall.isClosed()).toBe(false);
  expect(stage.isClosed()).toBe(false);
  expect(await roleOf(hall)).toBe('audience');
  expect(outputPages(app)).toHaveLength(2);
  await app.close();
});

/** How the stage group's screens stand now, this computer's (Screens' states). */
const stageStates = (win: Page) =>
  win.evaluate(async () => {
    const s = await (globalThis as PageGlobals).drashti.screens.get();
    const staged = new Set(
      s.groups.filter((g) => g.role === 'stage').flatMap((g) => g.screens.map((sc) => sc.id)),
    );
    return s.status.filter((st) => staged.has(st.screenId)).map((st) => st.state);
  });

/** Stage off, then on again from the top bar (nothing to ask: no stage screen is open on this computer). */
async function offAndOn(win: Page): Promise<void> {
  await win.getByTestId('switch-stage').click();
  await expect(win.getByTestId('screen-switch-ask')).toHaveCount(0);
  await stageIs(win, false);
  await win.getByTestId('switch-stage').click();
  await stageIs(win, true);
}

// alpha.23 (a22-review-stage S8; lead 2's QA23-STAGE8-1): a tablet paired as Stage is a stage display, and a stage
// screen whose display is unplugged is still set to Stage: "No screen is set to Stage." would be wrong then.
test('(d) set to Stage with nothing showing it on this computer: only a tablet paired as Stage (while the Network is on), then a stage screen whose display is unplugged; Stage On never says no screen is set to Stage, and says it once neither is left or the Network is off', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ ...AUTO, ...NETWORK_ENV });
  const win = await operatorPage(app);
  await operatorReady(win);
  await plugIn(app, 1);
  await expect.poll(() => jobs(win)).toEqual(['1: audience']);
  await stageIs(win, false);

  // Stage off with no tablet paired: the status bar says "Stage off" alone, as in alpha.22.
  const hint = win.getByTestId('switch-off-stage-hint');
  await expect(win.getByTestId('switch-off-stage')).toContainText('Stage off');
  await expect(hint).toHaveCount(0);

  // The hall's projector and one tablet paired as Stage. Stage still off (the owner's QA23-STAGE8-2, "Keep Off, say
  // so (Rec.)"): the status bar says the tablet shows the audience picture until Stage is on.
  const { port } = await networkOn(win);
  const token = await pairToken(win, port, 'stage', 'Placeholder tablet');
  await stageIs(win, false);
  // Paired but not connected now (a22-review-stage8, third look, SHOULD): it shows nothing, so "Stage off" alone.
  const tabletIcon = win.getByTestId('switch-off-stage-tablet');
  await expect(win.getByTestId('switch-off-stage')).toContainText('Stage off');
  await expect(hint).toHaveCount(0);
  await expect(tabletIcon).toHaveCount(0);
  // Its stage display's feed open: the tablet shows the audience picture until Stage is on, and the status bar says so.
  // A tablet in place of the screen icon (the status bar no wider: operator-fit.spec.ts), the words for screen
  // readers, and the sentence as its tooltip.
  const feed = await connectTablet(port, token);
  await expect(tabletIcon).toBeVisible();
  await expect(hint).toHaveText('the stage tablet shows the audience picture');
  await expect(win.getByTestId('switch-off-stage')).toContainText(
    'Stage off · the stage tablet shows the audience picture',
  );
  await win.getByTestId('switch-off-stage').getByText('Stage off', { exact: true }).hover();
  await expect(win.locator('[role="tooltip"]')).toHaveText(
    'Stage off: the stage tablet shows the audience picture.',
  );
  await win.mouse.move(0, 0);
  await expect(win.locator('[role="tooltip"]')).toHaveCount(0);
  // Its feed closed (the tablet switched off): "Stage off" alone again; open again, said again.
  feed.close();
  await expect(hint).toHaveCount(0);
  await expect(tabletIcon).toHaveCount(0);
  const tabletFeed = await connectTablet(port, token);
  await expect(hint).toHaveText('the stage tablet shows the audience picture');
  // On says nothing of no screen, here or in the panel.
  await win.getByTestId('switch-stage').click();
  await stageIs(win, true);
  await openSection(win, 'stage');
  const panel = win.getByTestId('stage-message-control');
  await expect(panel.getByTestId('stage-preview-open')).toBeVisible();
  await expect(panel.getByTestId('stage-no-screen')).toHaveCount(0);
  await expect(noStageLine(win)).toHaveCount(0);
  await offAndOn(win);
  await expect(noStageLine(win)).toHaveCount(0);

  // The Network (phones and tablets) turned off (a22-review-stage8 S5): the tablet can show nothing, so On says no
  // screen is set to Stage, in the line and in the panel; on again, the tablet counts again.
  const networkSet = (on: boolean) =>
    win.evaluate(async (on) => (await (globalThis as PageGlobals).drashti.network.setOn(on)).ok, on);
  expect(await networkSet(false)).toBe(true);
  await expect(panel.getByTestId('stage-no-screen')).toContainText('No screen is set to Stage.');
  await offAndOn(win);
  await expect(noStageLine(win).getByTestId('screens-said-text')).toHaveText('No screen is set to Stage.');
  expect(await networkSet(true)).toBe(true);
  await expect(panel.getByTestId('stage-no-screen')).toHaveCount(0);
  // The line said before stays until it is closed or another is said: closed, and On again says nothing.
  await noStageLine(win).getByRole('button', { name: 'Dismiss' }).click();
  await expect(noStageLine(win)).toHaveCount(0);
  await offAndOn(win);
  await expect(noStageLine(win)).toHaveCount(0);

  // The tablet forgotten: nothing is set to Stage now, and On says so again, in the line and in the panel.
  const tablet = await win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.network.status()).devices.find((d) => d.kind === 'stage'),
  );
  if (!tablet) throw new Error('the tablet paired as Stage was expected');
  await win.evaluate(
    async (id) => (await (globalThis as PageGlobals).drashti.network.revokeDevice(id)).ok,
    tablet.id,
  );
  await expect(panel.getByTestId('stage-no-screen')).toContainText('No screen is set to Stage.');
  // Off: "Stage off" alone again, with no tablet paired.
  await win.getByTestId('switch-stage').click();
  await stageIs(win, false);
  await expect(hint).toHaveCount(0);
  await win.getByTestId('switch-stage').click();
  await stageIs(win, true);
  await expect(noStageLine(win).getByTestId('screens-said-text')).toHaveText('No screen is set to Stage.');

  // A second projector: the stage by itself. Unplugged, its screen is still set to Stage (it shows the stage again
  // as the display comes back), so On says nothing of no screen.
  await plugIn(app, 2);
  await expect.poll(() => jobs(win)).toEqual(['1: audience', '2: stage']);
  await expect.poll(() => stageStates(win)).toEqual(['showing']);
  await plugIn(app, 1);
  await expect.poll(() => stageStates(win), { timeout: 30_000 }).toEqual(['missing-display']);
  await expect(panel.getByTestId('stage-no-screen')).toHaveCount(0);
  await offAndOn(win);
  await expect(noStageLine(win)).toHaveCount(0);
  await expect(panel.getByTestId('stage-no-screen')).toHaveCount(0);
  tabletFeed.close();
  await app.close();
});
