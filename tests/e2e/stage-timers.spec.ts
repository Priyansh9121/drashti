import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { StageLayout } from '../../src/shared/stage-layouts';
import { expectNoSeriousA11yIssues } from './a11y';
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
 * Stage timer layouts (Session 54). The stage layout editor's New from a Template… makes each of five ready-made
 * layouts with the timer it needs (a new one, with the length or the time of day asked, or one already in
 * Timers), shows it in the editor and chooses it at once for the stage screens in the live Look. The editor and
 * the dialog fit CI's window, 1024 × 645, and pass the accessibility checks. Placeholder timers and words only;
 * quiet; outputs as windows; nothing wider than 1024 assumed.
 */

/** The engine's state, as the operator window has it. */
const engineState = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** The timers, as Timers has them: what a template made. */
const timersNow = async (win: Page) =>
  (await engineState(win)).timers.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    durationMs: t.durationMs,
    targetTime: t.targetTime,
    allowsOverrun: t.allowsOverrun,
  }));

/** The output showing this screen. */
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

/** Make the group of this name a stage group; its id. */
function makeStage(win: Page, name: string): Promise<string> {
  return win.evaluate(async (name) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.name === name);
    if (!group) throw new Error(`no group ${name}`);
    const set = await d.screens.setGroupRole(group.id, 'stage');
    if (!set.ok) throw new Error(set.message);
    return group.id;
  }, name);
}

/** The stage layout the live Look gives this group, or null for the Standard stage screen. */
const liveLayoutOf = (win: Page, groupId: string): Promise<StageLayout | null> =>
  win.evaluate(async (groupId) => {
    const d = (globalThis as PageGlobals).drashti;
    const looks = await d.looks.list();
    const id = looks.looks.find((l) => l.id === looks.liveId)?.groups[groupId]?.stageLayoutId ?? null;
    return id === null ? null : ((await d.stageLayouts.list()).find((l) => l.id === id) ?? null);
  }, groupId);

/** The kinds of the boxes a stage page draws, bottom to top. */
const boxKinds = (page: Page) =>
  page
    .getByTestId('stage-layout')
    .evaluate((layout) =>
      [...layout.querySelectorAll<HTMLElement>('[data-stage-box]')].map((b) => b.dataset['stageBox']),
    );

test('New from a Template… makes each of the five with the timer it needs, chosen for the stage screens at once', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const stageId = await setUpScreen(win, 'Stage', 0);
  const group = await makeStage(win, 'Stage');
  const stage = await outputFor(app, stageId);

  // The editor, from the Stage screen panel's Edit layout….
  await win.getByTestId('stage-edit-layout').click();
  const editor = win.getByTestId('stage-layout-editor');
  await expect(editor).toBeVisible();
  const dialog = win.getByTestId('stage-template-dialog');
  const open = async (template: string) => {
    await editor.getByTestId('stage-layout-from-template').click();
    await expect(dialog).toBeVisible();
    const choice = dialog.getByRole('radio', { name: template, exact: true });
    await choice.click();
    await expect(choice).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByTestId('stage-template-picture')).toHaveAttribute(
      'data-template',
      (await choice.getAttribute('data-template')) ?? '',
    );
  };
  const make = async (layout: string) => {
    await dialog.getByTestId('stage-template-make').click();
    await expect(dialog).toHaveCount(0);
    // Shown in the editor, saved (nothing left to save), and chosen for the stage group in the live Look.
    await expect(
      editor.getByTestId('stage-layout-list').getByRole('button', { name: layout, exact: true }),
    ).toHaveAttribute('aria-current', 'true');
    await expect(editor.getByTestId('stage-layout-name')).toHaveValue(layout);
    await expect(editor.getByTestId('stage-layout-save')).toBeDisabled();
    await expect.poll(async () => (await liveLayoutOf(win, group))?.name ?? null).toBe(layout);
    await expect(stage.getByTestId('stage-layout')).toHaveAttribute(
      'data-layout',
      (await liveLayoutOf(win, group))?.id ?? '',
    );
  };

  // Countdown: a new one, of the length typed, that runs on past 0:00.
  await open('Countdown');
  await expect(dialog.getByTestId('stage-template-where')).toContainText(
    'it is chosen at once for the stage screens',
  );
  await expect(dialog.getByTestId('stage-template-length')).toHaveValue('5:00');
  await expect(dialog.getByTestId('stage-template-name')).toHaveValue('Stage countdown');
  await dialog.getByTestId('stage-template-length').fill('2:30');
  await make('Countdown');
  const countdown = (await timersNow(win)).find((t) => t.name === 'Stage countdown');
  expect(countdown).toMatchObject({ kind: 'countdown', durationMs: 150_000, allowsOverrun: true });
  expect(await boxKinds(stage)).toEqual(['timer']);
  await expect(stage.locator('[data-stage-box="timer"]')).toHaveText('2:30');

  // Countdown to a time: the time of day typed, and the words above it.
  await open('Countdown to a time');
  await dialog.getByTestId('stage-template-time').fill('08:15');
  await expect(dialog.getByTestId('stage-template-words')).toHaveValue('Starting in');
  await dialog.getByTestId('stage-template-words').fill('Placeholder words above');
  await make('Countdown to a time');
  expect((await timersNow(win)).find((t) => t.name === 'Stage countdown to a time')).toMatchObject({
    kind: 'countdown_to_time',
    targetTime: '08:15',
    allowsOverrun: false,
  });
  expect(await boxKinds(stage)).toEqual(['text', 'timer']);
  await expect(stage.locator('[data-stage-box="text"]')).toHaveText('Placeholder words above');
  await expect(stage.locator('[data-stage-box="timer"]')).toHaveText(/^\d+:\d\d(:\d\d)?$/u);

  // Count up from 0:00.
  await open('Count up from 0:00');
  await make('Count up from 0:00');
  expect((await timersNow(win)).find((t) => t.name === 'Stage count up')).toMatchObject({ kind: 'countup' });
  await expect(stage.locator('[data-stage-box="timer"]')).toHaveText('0:00');

  // Timer only, with a timer already in Timers: no new one is made.
  const before = await timersNow(win);
  await open('Timer only');
  await dialog.getByTestId('stage-template-own-timer').click();
  await expect(dialog.getByTestId('stage-template-own-timer')).toBeChecked();
  await dialog
    .getByTestId('stage-template-timer-choice')
    .selectOption({ label: 'Stage countdown (Countdown)' });
  await make('Timer only');
  expect(await timersNow(win)).toEqual(before);
  const alone = await liveLayoutOf(win, group);
  expect(alone?.boxes.map((b) => [b.kind, b.timerId])).toEqual([['timer', countdown?.id]]);
  await expect(stage.locator('[data-stage-box="timer"]')).toHaveText('2:30');

  // Timer and clock over the audience: a new count-up of the name typed; the picture under the two.
  await open('Timer and clock over the audience');
  await dialog.getByTestId('stage-template-kind').selectOption('countup');
  await dialog.getByTestId('stage-template-name').fill('Placeholder stage timer');
  await make('Timer and clock over the audience');
  expect((await timersNow(win)).find((t) => t.name === 'Placeholder stage timer')).toMatchObject({
    kind: 'countup',
  });
  expect(await boxKinds(stage)).toEqual(['audience', 'timer', 'clock']);
  await app.close();
});

test('the stage layout editor and New from a Template fit 1024 × 645 and pass the accessibility checks', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await win.getByTestId('stage-edit-layout').click();
  const editor = win.getByTestId('stage-layout-editor');
  await expect(editor).toBeVisible();
  await editor.getByTestId('stage-layout-from-template').click();
  const dialog = win.getByTestId('stage-template-dialog');
  await expect(dialog).toBeVisible();
  // No stage group yet: the layout is made, and chosen for the stage in Screens once there is one.
  await expect(dialog.getByTestId('stage-template-where')).toContainText(
    'No screens are set up for the stage yet',
  );
  // Each template: the dialog in the window, its Make the layout in view without scrolling the window.
  const makeButton = dialog.getByTestId('stage-template-make');
  for (const name of [
    'Timer only',
    'Countdown to a time',
    'Countdown',
    'Count up from 0:00',
    'Timer and clock over the audience',
  ]) {
    await dialog.getByRole('radio', { name, exact: true }).click();
    await expect(makeButton).toBeInViewport({ ratio: 1 });
  }
  // The arrow keys move the choice, as in any radio group.
  await dialog.getByRole('radio', { name: 'Timer and clock over the audience', exact: true }).focus();
  await win.keyboard.press('ArrowUp');
  await expect(dialog.getByRole('radio', { name: 'Count up from 0:00', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expectNoSeriousA11yIssues(win, 'New from a Template');
  await dialog.getByRole('radio', { name: 'Timer and clock over the audience', exact: true }).click();
  await makeButton.click();
  await expect(dialog).toHaveCount(0);
  await expect(editor.getByTestId('stage-layout-name')).toHaveValue('Timer and clock over the audience');

  // The new layout's timer box chosen: its settings, the canvas and Save in the window.
  await editor.getByTestId('stage-box-list').getByRole('button', { name: 'Timer', exact: true }).click();
  await expect(editor.getByTestId('stage-box-settings')).toBeVisible();
  await expect(editor.getByTestId('stage-layout-canvas')).toBeInViewport();
  await expect(editor.getByTestId('stage-layout-save')).toBeInViewport({ ratio: 1 });
  await expectNoSeriousA11yIssues(win, 'the stage layout editor at 1024 x 645, a timer box chosen');
  await app.close();
});
