import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, outputPages } from './helpers';

/*
 * Screens, the obvious made obvious (Session 44; Priyansh: "creating a screen shouldnt take this long, make
 * obvious stuff obvious"). A display plugged in while no screen shows the hall's picture: the window offers
 * "Show on <its name>", and one click makes it the hall's screen (the first start's welcome offers the same).
 * Set Up Screens… opens on the displays, one click each, with Done. The displays are Drashti's pretend ones
 * (DRASHTI_TEST_DISPLAY_CHANGES, DRASHTI_EXTRA_DISPLAYS), its outputs windows (DRASHTI_WINDOWED_OUTPUTS).
 */

const OFFER = { DRASHTI_TEST_SCREEN_OFFER: '1', DRASHTI_WINDOWED_OUTPUTS: '1' };

const plugIn = (app: ElectronApplication, n: number) =>
  app.evaluate((_electron, count) => {
    (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays?.(count);
  }, n);

const realDisplays = (app: ElectronApplication) =>
  app.evaluate(({ screen }) => screen.getAllDisplays().length);

/** The hall's screens: each "group: screen, its state, on which display". */
const hall = (win: Page) =>
  win.evaluate(async () => {
    const s = await (globalThis as PageGlobals).drashti.screens.get();
    return s.groups
      .filter((g) => g.role === 'audience')
      .flatMap((g) =>
        g.screens.map((sc) => {
          const st = s.status.find((x) => x.screenId === sc.id);
          return { group: g.name, screen: sc.name, state: st?.state ?? '', displayId: st?.displayId ?? null };
        }),
      );
  });

test('a display plugged in, no hall screen yet: one click on “Show on <it>” and the hall’s picture is on it', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp({ ...OFFER, DRASHTI_TEST_DISPLAY_CHANGES: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const offer = win.getByTestId('show-on-offer');
  // One display (the controls'): nothing to offer. (A computer with a second display of its own offers it.)
  if ((await realDisplays(app)) === 1) await expect(offer).toHaveCount(0);

  // Plugged in: offered by its name.
  await plugIn(app, 1);
  await expect(offer).toBeVisible();
  const button = offer.getByTestId('show-on');
  await expect(button).toHaveText(/^Show on /u);
  const name = ((await button.textContent()) ?? '').replace(/^Show on /u, '');
  const offered = await win.evaluate(
    async (n) =>
      (await (globalThis as PageGlobals).drashti.screens.get()).displays.find((d) => d.label === n)?.id ??
      null,
    name,
  );
  expect(offered).not.toBeNull();
  await expectNoSeriousA11yIssues(win, 'the window offering Show on');

  // One click.
  await button.click();
  await expect
    .poll(() => hall(win))
    .toEqual([{ group: 'Audience', screen: name, state: 'showing', displayId: offered }]);
  await expect.poll(() => outputPages(app).length).toBe(1);
  // Offered no more: the hall has its screen.
  await expect(offer).toHaveCount(0);
  await expect(win.getByTestId('operator-notice')).toContainText(`The hall’s picture now shows on ${name}`);
  await app.close();
});

test('Not now puts the offer away; the first start’s welcome offers it as its one primary', async () => {
  test.setTimeout(90_000);
  const first = await launchApp({ ...OFFER, DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(first.app);
  await operatorReady(win);
  const offer = win.getByTestId('show-on-offer');
  await expect(offer).toBeVisible();
  await offer.getByTestId('show-on-not-now').click();
  await expect(offer).toHaveCount(0);
  await first.app.close();

  // A first start (the welcome on): its primary shows on the display, one click.
  const { app } = await launchApp({ ...OFFER, DRASHTI_EXTRA_DISPLAYS: '1', DRASHTI_TEST_NO_WIZARD: '0' });
  const w = await operatorPage(app);
  await operatorReady(w);
  const welcome = w.getByTestId('welcome');
  await expect(welcome).toBeVisible();
  const show = welcome.getByTestId('show-on');
  await expect(show).toBeFocused();
  await show.click();
  await expect.poll(async () => (await hall(w)).map((s) => s.state)).toEqual(['showing']);
  await expect(welcome).toHaveCount(0);
  await app.close();
});

test('Set Up Screens… opens on the displays: the free one already the hall’s, one click each, then Done', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '2' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await chooseMenuItem(app, 'set-up-screens');
  const wizard = win.getByTestId('setup-wizard');
  await expect(wizard.getByTestId('setup-step')).toHaveText('Screens');
  const displays = wizard.getByTestId('setup-display');
  // The first display not the controls' starts as the hall's; the rest as not used.
  const uses = () =>
    displays.evaluateAll((els) => els.map((e) => e.querySelector('[data-use]')?.getAttribute('data-use')));
  const before = await uses();
  expect(before.filter((u) => u === 'audience')).toHaveLength(1);
  await expectNoSeriousA11yIssues(win, 'Set Up Screens on its displays', '[data-testid="setup-wizard"]');
  // One click: the last display the stage's.
  await displays.last().getByTestId('setup-use-stage').click();
  expect((await uses()).at(-1)).toBe('stage');
  // Done: shown as chosen, nothing else asked.
  await wizard.getByTestId('setup-screens-done').click();
  await expect(wizard.getByTestId('setup-done')).toContainText('Done. A test slide is on 2 screens');
  await expect.poll(() => outputPages(app).length).toBe(2);
  await app.close();
});
