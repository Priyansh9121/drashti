import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { newStageBox, type StageBox } from '../../src/shared/stage-layouts';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  setUpScreen,
} from './helpers';

/*
 * The stage message's colours (the owner, 24 Nov 2026): the operator chooses its box's colour and its words' colour
 * in the Stage screen panel, from a few that read well or two of their own (said plainly when they are hard to read,
 * never refused), remembered on this computer. Every stage screen shows them at once, wherever the message shows
 * (the Standard stage screen, the operator's preview, a layout's message box, the banner, Stage off's picture). The
 * flash keeps its rhythm, with white (amber for a white box), its words readable in both. A message sent with no
 * colours (a phone, the API, Simple Mode) looks as it always did. Placeholder words only.
 */

const SCREENS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
const WORDS = 'Placeholder: two minutes left';
const AMBER = 'rgb(245, 165, 36)';
const BLACK = 'rgb(0, 0, 0)';
const WHITE = 'rgb(255, 255, 255)';
const BLUE = 'rgb(29, 78, 216)';
const YELLOW = 'rgb(255, 255, 0)';

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

const stageCall = async (win: Page) =>
  (await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).state.stageCall;

/** A message's box and words colours as drawn. */
const colours = (message: Locator) =>
  message.evaluate((el) => {
    const s = getComputedStyle(el);
    return { box: s.backgroundColor, words: s.color };
  });

test('the stage message in the colours chosen, a preset or its own, on every stage screen wherever it shows; a hard-to-read pair is said; remembered', async () => {
  test.setTimeout(240_000);
  const launched = await launchApp(SCREENS);
  let app = launched.app;
  let win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  const stageId = await setUpScreen(win, 'Stage one', 1);
  await makeStage(win, 'Stage one');
  const stage = await outputFor(app, stageId);
  let panel = win.getByTestId('stage-message-control');
  const text = () => panel.getByRole('textbox', { name: 'Message for the stage' });
  const choice = () => panel.getByRole('combobox', { name: 'Colours of the stage message' });
  const show = () => panel.getByRole('button', { name: 'Show', exact: true }).click();

  // As always to begin with: amber, black words, and the call says no colours.
  await expect(choice()).toHaveValue('amber');
  await text().fill(WORDS);
  await show();
  const onStage = stage.getByTestId('stage-message');
  await expect(onStage).toHaveText(WORDS);
  expect(await colours(onStage)).toEqual({ box: AMBER, words: BLACK });
  expect(await stageCall(win)).not.toHaveProperty('boxColor');
  expect(await stageCall(win)).not.toHaveProperty('textColor');

  // A preset that reads well: blue, white words. Shown again, every place shows it.
  await choice().selectOption({ label: 'Blue, white words' });
  await expect(panel.getByTestId('stage-colours-contrast')).toHaveCount(0);
  await show();
  await expect.poll(() => colours(onStage)).toEqual({ box: BLUE, words: WHITE });
  expect(await stageCall(win)).toMatchObject({ boxColor: '#1d4ed8', textColor: '#ffffff' });
  // The operator's preview of the stage.
  expect(await colours(panel.getByTestId('stage-preview').getByTestId('stage-message'))).toEqual({
    box: BLUE,
    words: WHITE,
  });
  // A layout's message box (its own words' colour given way to the chosen one), then the banner over a layout
  // with none, then Stage off's picture.
  const withBox = await saveLayout(win, 'Placeholder message box', [newStageBox('stageMessage', 'message')]);
  await panel.getByTestId('stage-layout-choice').selectOption(withBox);
  await expect
    .poll(() => colours(stage.getByTestId('stage-box-message')))
    .toEqual({ box: BLUE, words: WHITE });
  const clockOnly = await saveLayout(win, 'Placeholder clock only', [newStageBox('clock', 'clock')]);
  await panel.getByTestId('stage-layout-choice').selectOption(clockOnly);
  const banner = stage.getByTestId('stage-message-banner');
  await expect.poll(() => colours(banner)).toEqual({ box: BLUE, words: WHITE });
  await win.evaluate(() => (globalThis as PageGlobals).drashti.screenSwitches.turn('stage', false));
  await expect(stage.getByTestId('stage-audience-picture')).toBeVisible();
  await expect.poll(() => colours(banner)).toEqual({ box: BLUE, words: WHITE });
  await win.evaluate(() => (globalThis as PageGlobals).drashti.screenSwitches.turn('stage', true));
  await panel.getByTestId('stage-layout-choice').selectOption('standard');

  // Its own colours: a white box with yellow words is hard to read: said beside the choice, never refused.
  await choice().selectOption({ label: 'Your own colours' });
  await panel.getByLabel('Box colour of the stage message').fill('#ffffff');
  await panel.getByLabel('Words colour of the stage message').fill('#ffff00');
  await expect(panel.getByTestId('stage-colours-contrast')).toContainText('Hard to read');
  await panel.getByRole('checkbox', { name: 'Flash as it comes up' }).check();
  await show();
  await expect.poll(() => colours(onStage)).toEqual({ box: WHITE, words: YELLOW });
  expect(await stageCall(win)).toMatchObject({ boxColor: '#ffffff', textColor: '#ffff00', flash: true });
  // Flashing, a white box turns amber, never white on white; its words then black, which read on amber.
  await expect.poll(() => colours(onStage), { timeout: 8_000 }).toEqual({ box: AMBER, words: BLACK });
  await expect.poll(() => colours(onStage), { timeout: 8_000 }).toEqual({ box: WHITE, words: YELLOW });
  await expectNoSeriousA11yIssues(
    win,
    'the Stage screen panel’s message colours',
    '[data-testid="stage-message-control"]',
  );

  // Remembered on this computer: Drashti started again offers the same colours for the next message.
  await app.close();
  app = (await launchApp(SCREENS, launched.userData)).app;
  win = await operatorPage(app);
  await operatorReady(win);
  panel = win.getByTestId('stage-message-control');
  await expect(choice()).toHaveValue('own');
  await expect(panel.getByLabel('Box colour of the stage message')).toHaveValue('#ffffff');
  await expect(panel.getByLabel('Words colour of the stage message')).toHaveValue('#ffff00');
  await app.close();
});

test('a stage message sent with no colours, by the API as a phone or Simple Mode sends it, shows amber with black words, its flash white', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(SCREENS);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  const stageId = await setUpScreen(win, 'Stage one', 1);
  await makeStage(win, 'Stage one');
  const stage = await outputFor(app, stageId);
  // The operator's own choice is not what a message sent from elsewhere shows.
  await win
    .getByTestId('stage-message-control')
    .getByRole('combobox', { name: 'Colours of the stage message' })
    .selectOption({ label: 'Blue, white words' });
  await win.evaluate(
    (text) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'setStageMessage', text, flash: true }),
    WORDS,
  );
  const onStage = stage.getByTestId('stage-message');
  await expect(onStage).toHaveText(WORDS);
  await expect.poll(() => colours(onStage), { timeout: 8_000 }).toEqual({ box: WHITE, words: BLACK });
  await expect.poll(() => colours(onStage), { timeout: 8_000 }).toEqual({ box: AMBER, words: BLACK });
  // Colours the API gives are shown, and one it cannot read is refused with the message.
  await win.evaluate(
    (text) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'setStageMessage',
        text,
        boxColor: '#000000',
        textColor: '#FFFFFF',
      } as never),
    WORDS,
  );
  await expect.poll(() => colours(onStage)).toEqual({ box: BLACK, words: WHITE });
  const refused = await win.evaluate(
    (text) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'setStageMessage',
        text,
        boxColor: 'amber',
      } as never),
    WORDS,
  );
  expect(refused).toMatchObject({ ok: false });
  await app.close();
});
