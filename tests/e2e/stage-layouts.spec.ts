import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode, TABLET } from './devices';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, outputPages, setUpScreen } from './helpers';

/*
 * Stage layouts (Session 11): with none chosen a stage screen is the Standard
 * stage screen, drawn as before; a layout made in the editor puts each box
 * where it was set; a stage group gets its layout through the live Look; the
 * stage display in a browser shows the same layout. The seeded sample kirtan
 * and placeholder words only.
 */

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

/** Each box of a stage layout on a page: its kind, words, and where it is on the 1920 x 1080 canvas. */
const boxesOn = (page: Page) =>
  page.getByTestId('stage-layout').evaluate((layout) => {
    const r = layout.getBoundingClientRect();
    const scale = r.width / 1920;
    return [...layout.querySelectorAll<HTMLElement>('[data-stage-box]')].map((b) => {
      const box = b.getBoundingClientRect();
      return {
        kind: b.dataset['stageBox'],
        x: Math.round((box.left - r.left) / scale),
        y: Math.round((box.top - r.top) / scale),
        width: Math.round(box.width / scale),
        height: Math.round(box.height / scale),
        text: b.innerText.replace(/\s+/gu, ' ').trim(),
      };
    });
  });

test('Standard is the stage screen as before; a layout made in the editor puts each box where it was set, here and in a browser', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...NETWORK_ENV, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const stageId = await setUpScreen(win, 'Stage', 0);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.name === 'Stage');
    await d.screens.setGroupRole(group?.id ?? '', 'stage');
    await d.engine.dispatch({ type: 'setStageMessage', text: 'Placeholder: two minutes' });
  });
  const stage = await outputFor(app, stageId);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Sample kirtan/ })
    .click();
  await win.getByTestId('slide-thumb').first().click();

  // Standard: the stage screen as it always was (the same component, the same parts).
  await expect(stage.getByTestId('stage-view')).toBeVisible();
  await expect(stage.getByTestId('stage-layout')).toHaveCount(0);
  await expect(stage.getByTestId('stage-current')).toContainText('નમૂનાની પહેલી પંક્તિ');
  await expect(stage.getByTestId('stage-message')).toHaveText('Placeholder: two minutes');
  await expect(stage.getByTestId('stage-clock')).toBeVisible();
  await expect(stage.getByTestId('stage-next')).toBeVisible();

  // The editor, from the stage group's settings in Screens: Duplicate Standard, then place boxes.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await win.getByTestId('screen-group').first().getByTestId('edit-stage-layouts').click();
  const editor = win.getByTestId('stage-layout-editor');
  await expect(editor).toBeVisible();
  await expect(editor.getByText('Standard is the stage screen Drashti comes with')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the stage layout editor, Standard');
  await editor.getByTestId('stage-layout-duplicate').click();
  await expect(editor.getByTestId('stage-box-list').getByRole('button')).toHaveCount(7);
  await editor.getByTestId('stage-layout-name').fill('Placeholder band layout');
  // A fixed text box, placed with the fields.
  await editor.getByTestId('stage-box-kind').selectOption('text');
  await editor.getByTestId('stage-box-add').click();
  const settings = editor.getByTestId('stage-box-settings');
  await settings.getByTestId('stage-box-text').fill('Placeholder band: watch the clock');
  await settings.getByRole('spinbutton', { name: 'Across' }).fill('100');
  await settings.getByRole('spinbutton', { name: 'Down' }).fill('900');
  await settings.getByRole('spinbutton', { name: 'Width' }).fill('800');
  await settings.getByRole('spinbutton', { name: 'Height' }).fill('120');
  await settings.getByTestId('stage-box-fit').uncheck();
  await settings.getByTestId('stage-box-size').fill('48');
  // The clock, dragged about 150 px to the left on the canvas (from 1162: no line to snap to near there).
  await editor.getByTestId('stage-box-list').getByRole('button', { name: 'Clock', exact: true }).click();
  const canvas = editor.getByTestId('stage-layout-canvas-stage');
  const scale = Number(await canvas.getAttribute('data-scale'));
  const chosen = await canvas.locator('[data-selected="true"]').boundingBox();
  if (!chosen) throw new Error('no clock box');
  const from = { x: chosen.x + chosen.width / 2, y: chosen.y + chosen.height / 2 };
  await win.mouse.move(from.x, from.y);
  await win.mouse.down();
  for (let i = 1; i <= 5; i++) await win.mouse.move(from.x - (150 * scale * i) / 5, from.y);
  await win.mouse.up();
  const across = settings.getByRole('spinbutton', { name: 'Across' });
  await expect.poll(async () => Math.abs(Number(await across.inputValue()) - 1012)).toBeLessThanOrEqual(3);
  const clockX = Number(await across.inputValue());
  // And one pixel down with the arrow key, from the canvas.
  await canvas.focus();
  await win.keyboard.press('ArrowDown');
  await expect(settings.getByRole('spinbutton', { name: 'Down' })).toHaveValue('187');
  await expectNoSeriousA11yIssues(win, 'the stage layout editor, a box chosen');
  await editor.getByTestId('stage-layout-save').click();
  await expect(editor.getByTestId('stage-layout-list')).toContainText('Placeholder band layout');
  await editor.getByRole('button', { name: 'Close stage layouts' }).click();

  // Not on the stage until the live Look gives it to the stage group.
  await expect(stage.getByTestId('stage-view')).toBeVisible();
  const choose = win.getByTestId('screen-group').first().getByTestId('look-stage-layout');
  await choose.selectOption({ label: 'Placeholder band layout' });
  await win.getByRole('button', { name: 'Close screens' }).click();
  await expect(stage.getByTestId('stage-layout')).toBeVisible();
  await expect(stage.getByTestId('stage-view')).toHaveCount(0);
  const boxes = await boxesOn(stage);
  expect(boxes.map((b) => b.kind)).toEqual([
    'stageMessage',
    'current',
    'screensState',
    'notes',
    'clock',
    'timer',
    'next',
    'text',
  ]);
  // Each box where it was set (Duplicate of Standard put the clock at 1162, 186; it was dragged left, and 1 down).
  expect(boxes.find((b) => b.kind === 'clock')).toMatchObject({ x: clockX, y: 187, width: 710, height: 130 });
  expect(boxes.find((b) => b.kind === 'text')).toMatchObject({
    x: 100,
    y: 900,
    width: 800,
    height: 120,
    text: 'Placeholder band: watch the clock',
  });
  expect(boxes.find((b) => b.kind === 'current')).toMatchObject({ x: 48, y: 186, width: 1066, height: 560 });
  expect(boxes.find((b) => b.kind === 'current')?.text).toContain('નમૂનાની પહેલી પંક્તિ');
  expect(boxes.find((b) => b.kind === 'stageMessage')?.text).toBe('Placeholder: two minutes');

  // The stage display in a browser: the same layout, the same boxes in the same places, the same words.
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'stage', 'Placeholder tablet');
  const tablet = await device('chromium', TABLET);
  try {
    await pairByQr(tablet.page, base, code, '/stage');
    await expect(tablet.page.getByTestId('stage-layout')).toBeVisible();
    const inBrowser = await boxesOn(tablet.page);
    expect(inBrowser.map((b) => b.kind)).toEqual(boxes.map((b) => b.kind));
    inBrowser.forEach((b, i) => {
      const there = boxes[i];
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(Math.abs(b[key] - (there?.[key] ?? NaN)), `${b.kind} ${key}`).toBeLessThanOrEqual(1);
    });
    for (const kind of ['text', 'current', 'stageMessage', 'next'])
      expect(inBrowser.find((b) => b.kind === kind)?.text, kind).toBe(
        boxes.find((b) => b.kind === kind)?.text,
      );
  } finally {
    await tablet.close();
  }
  await app.close();
});
