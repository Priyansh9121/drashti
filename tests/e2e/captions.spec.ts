import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import {
  chooseMenuItem,
  launchApp,
  NO_PLACEHOLDERS,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  setUpScreen,
} from './helpers';

/*
 * Live captions (Session 55, Part 10). The test switch DRASHTI_TEST_SPEECH stands in for the engine (no sound, no
 * model, no download): it "hears" placeholder phrases in turn, each half then whole, and the hub, the captions and
 * the screens run as they do with whisper.cpp. Off until an admin turns them on (File › Live Captions…, Pro Mode),
 * marked Trial; on, they show on the stage screens, and on the audience screens only when chosen; Gujarati chosen
 * says it is a trial; off takes them off every screen; Simple Mode has no way to change them. Two outputs on one
 * computer, windowed, the second on a pretend display: nothing takes the screen.
 */

const OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
const SPEECH = { DRASHTI_TEST_SPEECH: 'alpha beta gamma कखग|delta epsilon zeta कखग' };
const HEARD = /alpha beta gamma|delta epsilon zeta/u;

const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
const openRoles = async (app: ElectronApplication) =>
  (await Promise.all(outputPages(app).map(roleOf))).sort();
const outputWith = async (app: ElectronApplication, role: string) => {
  for (const p of outputPages(app)) if ((await roleOf(p)) === role) return p;
  throw new Error(`No ${role} output is open`);
};

/** The hall's screen on the first display and the stage screen on the second. */
async function hallAndStage(win: Page, app: ElectronApplication): Promise<void> {
  await setUpScreen(win, 'Main Hall', 0);
  const stage = await setUpScreen(win, 'Stage', 1);
  await win.evaluate(async (screenId) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.screens.some((x) => x.id === screenId));
    const set = await d.screens.setGroupRole(group?.id ?? '', 'stage');
    if (!set.ok) throw new Error(set.message);
  }, stage);
  await expect.poll(() => openRoles(app)).toEqual(['audience', 'stage']);
}

test('off until turned on and marked Trial; on, what is heard shows on the stage, on the audience only when chosen; off takes it off every screen', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ ...OUTPUTS, ...NO_PLACEHOLDERS, ...SPEECH });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await hallAndStage(win, app);
    const stage = await outputWith(app, 'stage');
    const hall = await outputWith(app, 'audience');

    // Off at first, marked Trial; nothing on any screen.
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('captions-trial')).toHaveText('Trial');
    await expect(dialog.getByTestId('captions-on')).toHaveText(
      'Live captions on this computer (Trial). Can slow the screens while on.',
    );
    await expect(dialog.getByTestId('captions-on')).toHaveAttribute('aria-checked', 'false');
    await expect(dialog.getByTestId('captions-state')).toHaveText('Off on this computer.');
    for (const p of outputPages(app)) await expect(p.getByTestId('captions')).toHaveCount(0);

    // On: the stand-in's words on the stage screen, not on the audience's.
    await dialog.getByTestId('captions-on').click();
    await expect(dialog.getByTestId('captions-state')).toHaveText('Listening to the stream’s sound input.');
    await expect(stage.getByTestId('captions')).toContainText(HEARD, { timeout: 15_000 });
    await expect(stage.getByTestId('captions')).toHaveAttribute('data-screen', 'stage');
    await expect(hall.getByTestId('captions')).toHaveCount(0);

    // The audience screens too, when chosen: kept in the library.
    await dialog.getByTestId('captions-audience').click();
    await expect(hall.getByTestId('captions')).toContainText(HEARD, { timeout: 15_000 });
    expect(
      await win.evaluate(
        async () => (await (globalThis as PageGlobals).drashti.captions.view()).settings.audience,
      ),
    ).toBe(true);

    // Size and place follow at once.
    await dialog.getByTestId('captions-size').selectOption('large');
    await dialog.getByTestId('captions-place').selectOption('top');
    await expect(stage.getByTestId('captions')).toHaveAttribute('data-size', 'large', { timeout: 15_000 });
    await expect(stage.getByTestId('captions')).toHaveAttribute('data-place', 'top');

    // Gujarati chosen: it says plainly it is a trial.
    await dialog.getByTestId('captions-language').selectOption('gu');
    await expect(dialog.getByTestId('captions-gujarati-trial')).toContainText('Gujarati is a trial');

    // Readable in CI's operator window and at 1280 × 720, and nothing serious for a screen reader.
    for (const size of [
      { width: 1024, height: 645 },
      { width: 1280, height: 720 },
    ]) {
      await win.setViewportSize(size);
      await expectFits(dialog, `the Live captions dialog at ${String(size.width)} × ${String(size.height)}`);
    }
    await expectNoSeriousA11yIssues(win, 'Live captions');

    await dialog.getByTestId('captions-language').selectOption('sa');
    for (const output of [stage, hall]) {
      const captions = output.getByTestId('captions');
      await expect(captions).toHaveAttribute('lang', 'sa-Gujr');
      await expect(captions).toContainText('કખગ');
      await expect(captions.locator(':scope > div')).toHaveCSS('font-family', /^["']?Noto Sans Gujarati/u);
    }

    // Off: off every screen at once.
    await dialog.getByTestId('captions-on').click();
    await expect(dialog.getByTestId('captions-state')).toHaveText('Off on this computer.');
    for (const p of outputPages(app)) await expect(p.getByTestId('captions')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // Simple Mode: no File menu, and the main process refuses to show or change captions.
    await win.getByRole('button', { name: 'Simple Mode' }).click();
    await expect
      .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode()))
      .toBe('simple');
    expect(
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('live-captions') ?? null),
    ).toBeNull();
    const refused = await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      return { view: await d.captions.view(), on: await d.captions.setOn(true) };
    });
    expect(refused.view).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(refused.on).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  } finally {
    await app.close();
  }
});
