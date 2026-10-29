import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { newStageBox, type StageBox } from '../../src/shared/stage-layouts';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import {
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The stage message (Session 55, Part 15), as the old program had its own: typed in the Stage screen panel, Show
 * puts it on every stage screen and Hide takes it off; never on the hall's screens; whatever the layout (the
 * Standard stage screen's own place, a layout's message box, a banner over a layout with none, and over the audience
 * picture with Stage off); its own size and a flash; the last few a tap away; and a phone does the same. Placeholder
 * words only.
 */

const SCREENS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };

async function outputFor(app: ElectronApplication, screenId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const p of outputPages(app))
        if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) found = p;
      return found !== undefined;
    })
    .toBe(true);
  if (!found) throw new Error(`no output for ${screenId}`);
  return found;
}

const makeStage = (win: Page, name: string) =>
  win.evaluate(async (name) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.name === name);
    if (!group) throw new Error(`no group ${name}`);
    const set = await d.screens.setGroupRole(group.id, 'stage');
    if (!set.ok) throw new Error(set.message);
  }, name);

const saveLayout = (win: Page, name: string, boxes: StageBox[]) =>
  win.evaluate(
    async ({ name, boxes }) => {
      const saved = await (globalThis as PageGlobals).drashti.stageLayouts.save(null, {
        name,
        background: '#000000',
        boxes,
      });
      if (!saved.ok) throw new Error(saved.message);
      return saved.id;
    },
    { name, boxes },
  );

const state = async (win: Page) =>
  (await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).state;

const WORDS = 'Placeholder: two minutes left';

test('the stage message: its size and flash, on every stage screen whatever the layout, never in the hall; Hide; the last few a tap away', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(SCREENS);
  const win = await operatorPage(app);
  await operatorReady(win);
  const hallId = await setUpScreen(win, 'Main Hall', 0);
  const stageId = await setUpScreen(win, 'Stage one', 1);
  await makeStage(win, 'Stage one');
  const hall = await outputFor(app, hallId);
  const stage = await outputFor(app, stageId);
  const panel = win.getByTestId('stage-message-control');

  // Typed, a size of its own and a flash, then Show.
  await panel.getByRole('textbox', { name: 'Message for the stage' }).fill(WORDS);
  await panel.getByRole('combobox', { name: 'Size of the stage message' }).selectOption({ label: 'Large' });
  await panel.getByRole('checkbox', { name: 'Flash as it comes up' }).check();
  await panel.getByRole('button', { name: 'Show', exact: true }).click();
  // The Standard stage screen's own place, larger, flashing as it came up.
  const onStage = stage.getByTestId('stage-message');
  await expect(onStage).toHaveText(WORDS);
  await expect(onStage).toHaveAttribute('data-size', 'large');
  await expect(onStage).toHaveCSS('font-size', '89.6px');
  await expect(onStage).toHaveAttribute('data-flash', 'true');
  expect((await state(win)).stageCall).toMatchObject({ size: 'large', flash: true });
  await expect(panel.getByTestId('stage-message-shown')).toHaveText(WORDS);
  // Never on the hall's screens.
  await expect(hall.getByText('two minutes left')).toHaveCount(0);

  // A layout with no message box: a banner over it.
  const clockOnly = await saveLayout(win, 'Placeholder clock only', [newStageBox('clock', 'clock')]);
  await panel.getByTestId('stage-layout-choice').selectOption(clockOnly);
  await expect(stage.getByTestId('stage-layout')).toBeVisible();
  await expect(stage.getByTestId('stage-message-banner')).toHaveText(WORDS);
  // A layout with a message box: in its box, and no banner.
  const withBox = await saveLayout(win, 'Placeholder with a message box', [
    newStageBox('stageMessage', 'message'),
    newStageBox('clock', 'clock'),
  ]);
  await panel.getByTestId('stage-layout-choice').selectOption(withBox);
  await expect(stage.getByTestId('stage-box-message')).toHaveText(WORDS);
  await expect(stage.getByTestId('stage-message-banner')).toHaveCount(0);
  // Stage off: the audience picture on the stage screen, with the banner over it; still never in the hall.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.screenSwitches.turn('stage', false));
  await expect(stage.getByTestId('stage-audience-picture')).toBeVisible();
  await expect(stage.getByTestId('stage-message-banner')).toHaveText(WORDS);
  await expect(hall.getByText('two minutes left')).toHaveCount(0);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.screenSwitches.turn('stage', true));

  // Hide takes it off every stage screen.
  await panel.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(stage.getByTestId('stage-box-message')).toHaveCount(0);
  await expect(panel.getByTestId('stage-message-shown')).toHaveCount(0);
  // Another, then the first again from the last few, one tap.
  await panel.getByRole('textbox', { name: 'Message for the stage' }).fill('Placeholder: wrap up');
  await panel.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(stage.getByTestId('stage-box-message')).toHaveText('Placeholder: wrap up');
  const recent = panel.getByTestId('stage-recent');
  await expect(recent.getByRole('button')).toHaveText(['Placeholder: wrap up', WORDS]);
  await recent.getByRole('button', { name: WORDS }).click();
  await expect(stage.getByTestId('stage-box-message')).toHaveText(WORDS);
  expect((await state(win)).stageRecent).toEqual([WORDS, 'Placeholder: wrap up']);
  await expectNoSeriousA11yIssues(
    win,
    'the Stage screen panel’s message',
    '[data-testid="stage-message-control"]',
  );
  await app.close();
});

test('a phone shows the stage message with its size and flash, hides it, and has the last few a tap away', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...SCREENS, ...NETWORK_ENV });
  const win = await operatorPage(app);
  await operatorReady(win);
  const stageId = await setUpScreen(win, 'Stage one', 1);
  await makeStage(win, 'Stage one');
  const stage = await outputFor(app, stageId);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  try {
    const p = phone.page;
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await p.getByTestId('remote-tab-more').click();
    const section = p.getByTestId('remote-stage');
    await p.getByTestId('remote-stage-text').fill(WORDS);
    await section
      .getByRole('combobox', { name: 'Size of the stage message' })
      .selectOption({ label: 'Very large' });
    await section.getByRole('checkbox', { name: 'Flash as it comes up' }).check();
    await section.getByRole('button', { name: 'Show', exact: true }).click();
    await expect(stage.getByTestId('stage-message')).toHaveText(WORDS);
    await expect(stage.getByTestId('stage-message')).toHaveAttribute('data-size', 'huge');
    await expect.poll(async () => (await state(win)).stageCall?.flash).toBe(true);
    await expect(p.getByTestId('remote-stage-message')).toContainText(WORDS);
    await section.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(stage.getByTestId('stage-message')).toHaveCount(0);
    // The last few, a tap away on the phone too.
    await section.getByTestId('remote-stage-recent').getByRole('button', { name: WORDS }).click();
    await expect(stage.getByTestId('stage-message')).toHaveText(WORDS);
    await expectNoSeriousA11yIssues(p, 'the phone’s stage message');
  } finally {
    await phone.close();
  }
  await app.close();
});

test('the Stage screen panel’s message, its last few and the timer for the audience fit CI’s operator window and 1280 × 720', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.evaluate(async (words) => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.timers.create({
      name: 'Placeholder activity with a longer name',
      kind: 'countdown',
      durationMs: 300_000,
      targetTime: null,
      allowsOverrun: false,
    });
    if (!made.ok) throw new Error(made.message);
    for (const text of ['Placeholder: two minutes left, then the arti', words])
      await d.engine.dispatch({ type: 'setStageMessage', text, size: 'large', flash: true });
  }, WORDS);
  const panel = win.getByTestId('stage-message-control');
  for (const size of [CI_WINDOW, { width: 1280, height: 720 }]) {
    await sizeOperatorWindow(app, win, size);
    await expect(panel.getByTestId('stage-recent').getByRole('button')).toHaveCount(2);
    await expect(panel.getByTestId('stage-audience-timer')).toBeVisible();
    await panel.getByTestId('stage-recent').scrollIntoViewIfNeeded();
    const problems = await panel.evaluate((root) => {
      const out: string[] = [];
      const frame = root.getBoundingClientRect();
      for (const el of root.querySelectorAll<HTMLElement>('button, select, input')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < frame.left - 1 || r.right > frame.right + 1)
          out.push(`${el.getAttribute('aria-label') ?? el.textContent} sticks out`);
        if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 1)
          out.push(`${el.getAttribute('aria-label') ?? el.textContent}: its words do not fit`);
      }
      if (root.scrollWidth > root.clientWidth + 1) out.push('the panel scrolls sideways');
      return out;
    });
    expect(problems, `at ${String(size.width)} × ${String(size.height)}`).toEqual([]);
  }
  await app.close();
});
