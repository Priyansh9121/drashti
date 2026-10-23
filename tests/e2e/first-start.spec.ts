import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { DisplayInfo } from '../../src/shared/screens';
import { displayToOffer } from '../../src/shared/setup';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  chooseMenuItem,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  type OutputGlobals,
  type PageGlobals,
  setUpScreen,
} from './helpers';

/*
 * The first start (Session 26g): once per library, the lamp lights, then a welcome with three
 * choices. Set Up Screens… opens the wizard; Skip for now leaves the empty places to lead; Try a
 * practice show first puts placeholder slides on the operator's screen only, and they reach no
 * output and change nothing in the show or the library. Never in Simple Mode or for a volunteer, and
 * nor is the setup wizard opened by itself for one (Session 46: with roles on, Drashti starts in Pro Mode).
 */

/**
 * A first start as a person meets it: the welcome on, and a new library without the tests' placeholder
 * presentations (Session 50: an operator's new library has none; as helpers.ts's NO_PLACEHOLDERS), so the middle
 * behind the welcome has nothing chosen.
 */
const FIRST = { DRASHTI_TEST_NO_WIZARD: '0', DRASHTI_TEST_SEED_PLACEHOLDERS: '' };

const engine = (win: Page) =>
  win.evaluate(async () => {
    const snap = await (globalThis as PageGlobals).drashti.engine.snapshot();
    return { rev: snap.rev, live: snap.state.live, blackout: snap.state.blackout, logo: snap.state.logo };
  });

/**
 * The display the first start offers for the hall's picture (Session 44's Show on), by the window's own rule
 * (ShowOn.tsx's useDisplayOffer): none on CI's computers, whose one display has the controls; a second monitor
 * plugged in here, free for the hall, is offered (Session 53).
 */
const offered = async (win: Page): Promise<DisplayInfo | null> => {
  const { snapshot, state } = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    return { snapshot: await d.screens.get(), state: await d.setup.state() };
  });
  return state.offer ? displayToOffer(snapshot, state.controlsDisplayId) : null;
};

/** The enabled primary buttons in the window, outside dialogs, by their words. */
const primaries = (win: Page) =>
  win.evaluate(() =>
    [...document.querySelectorAll<HTMLButtonElement>('[data-variant="primary"]')]
      .filter((b) => !b.disabled && b.offsetParent !== null && !b.closest('[aria-modal="true"]'))
      .map((b) => b.textContent.trim()),
  );

async function welcomeOf(
  app: ElectronApplication,
): Promise<{ win: Page; welcome: ReturnType<Page['getByTestId']> }> {
  const win = await operatorPage(app);
  const welcome = win.getByTestId('welcome');
  await expect(welcome).toBeVisible();
  return { win, welcome };
}

test('the lamp lights once, then Set Up Screens… opens the wizard at its Screens step; never again', async () => {
  const { app, userData } = await launchApp(FIRST);
  const { win, welcome } = await welcomeOf(app);
  await expect(welcome.getByRole('heading', { name: 'Welcome to Drashti' })).toBeVisible();
  // The lamp lights over 1.4 s: its parts move in turn, all within --dur-light (the breath after it).
  const lamp = welcome.getByTestId('lit-lamp');
  await expect(lamp).toBeVisible();
  const flame = await lamp.locator('.lamp-flame').evaluate((el) => {
    const st = getComputedStyle(el);
    return { names: st.animationName, durations: st.animationDuration, delays: st.animationDelay };
  });
  expect(flame.names).toBe('lamp-flame, lamp-breath');
  expect(flame.delays.split(', ')[1]).toBe('1.4s');
  await expectNoSeriousA11yIssues(win, 'the first start’s welcome');
  // The one primary has the keyboard: Set Up Screens…, or with a display free for the hall (a second monitor
  // plugged in here; CI's computers have none) Show on <it>, Set Up Screens… beside it (show-on.spec.ts).
  const primary = (await offered(win))
    ? welcome.getByTestId('show-on')
    : welcome.getByRole('button', { name: 'Set Up Screens…' });
  await expect(primary).toBeFocused();
  await expect(welcome.locator('[data-variant="primary"]')).toHaveCount(1);
  await welcome.getByRole('button', { name: 'Set Up Screens…' }).click();
  const wizard = win.getByTestId('setup-wizard');
  await expect(wizard.getByTestId('setup-step')).toHaveText('Screens');
  await expect(welcome).toHaveCount(0);
  await wizard.getByRole('button', { name: 'Close the setup' }).click();
  await app.close();
  // Kept with the library: the next start opens straight to the window.
  const again = await launchApp(FIRST, userData);
  const next = await operatorPage(again.app);
  await operatorReady(next);
  await expect(next.getByTestId('welcome')).toHaveCount(0);
  await expect(next.getByTestId('setup-wizard')).toHaveCount(0);
  await again.app.close();
});

test('with reduced motion the lamp is simply lit', async () => {
  const { app } = await launchApp(FIRST);
  const { win, welcome } = await welcomeOf(app);
  await win.emulateMedia({ reducedMotion: 'reduce' });
  const parts = await welcome.getByTestId('lit-lamp').evaluate((svg) =>
    ['.lamp-flame', '.lamp-core', '.lamp-halo', '.lamp-bowl'].map((sel) => {
      const el = svg.querySelector(sel);
      const st = el ? getComputedStyle(el) : null;
      return { sel, animation: st?.animationName, opacity: st?.opacity };
    }),
  );
  for (const p of parts) expect(p, p.sel).toEqual({ sel: p.sel, animation: 'none', opacity: '1' });
  expect(await win.evaluate(() => document.getAnimations().length)).toBe(0);
  await app.close();
});

test('Skip for now: the empty places lead, step 1’s Import… the one primary; never again', async () => {
  const { app, userData } = await launchApp(FIRST);
  const { win, welcome } = await welcomeOf(app);
  await welcome.getByRole('button', { name: 'Skip for now' }).click();
  await expect(welcome).toHaveCount(0);
  await expect(win.getByTestId('setup-wizard')).toHaveCount(0);
  const start = win.getByTestId('start-here');
  await expect(start).toBeVisible();
  await expect(start.getByTestId('start-step')).toHaveCount(3);
  await expect(start.getByTestId('unlit-lamp')).toBeVisible();
  // Step 1's Import… the one primary; with a display free for the hall (a second monitor plugged in here; CI's
  // computers have none), the offer under the header has its own Show on, as a notice's next step does
  // (show-on.spec.ts).
  const free = await offered(win);
  expect(await primaries(win)).toEqual(free ? [expect.stringMatching(/^Show on /u), 'Import…'] : ['Import…']);
  await expectNoSeriousA11yIssues(win, 'the window after Skip for now');
  await app.close();
  const again = await launchApp(FIRST, userData);
  const next = await operatorPage(again.app);
  await operatorReady(next);
  await expect(next.getByTestId('welcome')).toHaveCount(0);
  await again.app.close();
});

test('the practice show: placeholder slides on this screen only, reaching no output and saving nothing', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ ...FIRST, DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const { win, welcome } = await welcomeOf(app);
  // A hall screen is up (through the bridge, behind the welcome), showing nothing.
  await setUpScreen(win, 'Main Hall', 0);
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toBeVisible();
  const beforeEngine = await engine(win);
  const library = () =>
    win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      return JSON.stringify([await d.library.listPresentations(), await d.playlists.tree()]);
    });
  const beforeLibrary = await library();
  const painted = () =>
    output.evaluate(() => ((globalThis as OutputGlobals).drashtiPaintLog ?? []).map((p) => p.rev));
  // The new output has drawn the show as it is (its first paint), before anything is measured.
  await expect.poll(async () => (await painted()).includes(beforeEngine.rev)).toBe(true);
  const beforePaints = await painted();
  const beforePicture = await output.screenshot();

  await welcome.getByRole('button', { name: 'Try a practice show first' }).click();
  await expect(welcome).toHaveCount(0);
  const banner = win.getByTestId('practice-banner');
  await expect(banner).toContainText('nothing is on the screens');
  await expectNoSeriousA11yIssues(win, 'the practice show');
  const thumbs = win.getByTestId('practice-thumb');
  await expect(thumbs).toHaveCount(5);
  // Next, Next, Back, B, F12 and L (the logo: Session 50) and F1 work as in a show, on the window's own LIVE.
  await win.keyboard.press('ArrowRight');
  await expect(thumbs.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(win.getByTestId('live-preview')).toContainText('Practice slide one');
  await win.keyboard.press('ArrowRight');
  await expect(thumbs.nth(1)).toHaveAttribute('aria-current', 'true');
  await win.keyboard.press('ArrowLeft');
  await expect(thumbs.nth(0)).toHaveAttribute('aria-current', 'true');
  await win.keyboard.press('b');
  await expect(win.getByTestId('blackout-button')).toHaveText(/Black-out is on/u);
  await win.keyboard.press('b');
  await win.keyboard.press('F12');
  await expect(win.getByTestId('logo-button')).toHaveText(/Logo is on/u);
  await win.keyboard.press('l');
  await win.keyboard.press('F1');
  await expect(win.getByTestId('put-back')).toBeVisible();
  await win.getByTestId('put-back').click();
  await expect(thumbs.nth(0)).toHaveAttribute('aria-current', 'true');
  await thumbs.nth(3).click();
  await expect(thumbs.nth(3)).toHaveAttribute('aria-current', 'true');

  // None of it reached the show: the engine, the output's pages and picture, and the library as they were.
  expect(await engine(win)).toEqual(beforeEngine);
  expect(await painted()).toEqual(beforePaints);
  expect((await output.screenshot()).equals(beforePicture)).toBe(true);
  expect(await library()).toBe(beforeLibrary);

  // Leaving it comes back to the welcome.
  await win.getByTestId('practice-leave').click();
  await expect(win.getByTestId('welcome')).toBeVisible();
  await expect(banner).toHaveCount(0);
  expect(await engine(win)).toEqual(beforeEngine);
  await app.close();
});

test('View › Set Up Screens… still opens the wizard, from the practice show too', async () => {
  const { app } = await launchApp(FIRST);
  const { win, welcome } = await welcomeOf(app);
  await welcome.getByRole('button', { name: 'Try a practice show first' }).click();
  await expect(win.getByTestId('practice-banner')).toBeVisible();
  await chooseMenuItem(app, 'set-up-screens');
  // Straight to the displays (Session 44).
  await expect(win.getByTestId('setup-wizard').getByTestId('setup-step')).toHaveText('Screens');
  await expect(win.getByTestId('practice-banner')).toHaveCount(0);
  await app.close();
});

test('never in Simple Mode, nor for a volunteer (roles on, the admin PIN not typed), nor the wizard by itself when Drashti starts again in Pro Mode with roles on (Session 46)', async () => {
  const { app, userData } = await launchApp(FIRST);
  const { win, welcome } = await welcomeOf(app);
  await welcome.getByRole('button', { name: 'Try a practice show first' }).click();
  const state = () => win.evaluate(() => (globalThis as PageGlobals).drashti.setup.state());
  // Roles on and locked: a volunteer's start.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const on = await d.roles.setPins({ admin: '246813', operator: '135792' });
    if (!on.ok) throw new Error(on.message);
    await d.roles.lock();
  });
  expect((await state()).welcome).toBe(false);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('welcome')).toHaveCount(0);
  await expect(win.getByTestId('practice-banner')).toHaveCount(0);
  expect((await state()).welcome).toBe(false);
  await app.close();
  // Started again with roles on: Pro Mode as the operator, admin locked (Session 46). Neither the welcome
  // nor the setup wizard opens by itself, though neither was ever answered: both are an admin's.
  const again = await launchApp(FIRST, userData);
  const next = await operatorPage(again.app);
  await operatorReady(next);
  expect(await next.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode())).toBe('pro');
  await expect(next.getByTestId('role-chip')).toHaveAttribute('data-role', 'operator');
  expect(await next.evaluate(() => (globalThis as PageGlobals).drashti.setup.state())).toMatchObject({
    firstRun: false,
    welcome: false,
  });
  await expect(next.getByTestId('welcome')).toHaveCount(0);
  await expect(next.getByTestId('setup-wizard')).toHaveCount(0);
  await again.app.close();
});
