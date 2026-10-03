import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, outputPages, setUpScreen } from './helpers';
import { canvasPixels, near } from './pixels';

/*
 * Masks (Session 11): a group's own mask in a Look hides the right pixels on
 * that group's screens only, the inverse shows only what is inside it, and
 * the Masks layer goes up from the Masks panel and comes down with F7.
 * Pixels are read from the outputs' own pictures. Placeholder names only.
 */

const TWO_OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

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

/** Whether each point on a screen's canvas is white (true) or black (false); null for anything else. */
async function whites(page: Page, points: { x: number; y: number }[]): Promise<(boolean | null)[]> {
  const got = await canvasPixels(page, points);
  return got.map((c) => (near(c, WHITE) ? true : near(c, BLACK) ? false : null));
}

const LEFT = { x: 480, y: 540 };
const RIGHT = { x: 1440, y: 540 };
const CENTRE = { x: 960, y: 540 };
const CORNER = { x: 60, y: 60 };

test('a group’s own mask hides the right pixels on its screens only, the inverse shows only inside it, and the Masks layer comes down with F7', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(TWO_OUTPUTS);
  const win = await operatorPage(app);
  await operatorReady(win);
  const hallId = await setUpScreen(win, 'Hall', 0);
  const sideId = await setUpScreen(win, 'Side', 1);
  const [hall, side] = [await outputFor(app, hallId), await outputFor(app, sideId)];
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'setBackground',
      background: { kind: 'color', color: '#ffffff' },
    }),
  );
  await expect.poll(() => whites(hall, [LEFT, RIGHT])).toEqual([true, true]);

  // The mask editor from the hall's settings in Screens: a rectangle over the left half, hiding it.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const hallCard = win.getByTestId('screen-group').first();
  await hallCard.getByTestId('edit-masks').click();
  const editor = win.getByTestId('mask-editor');
  await expect(editor).toBeVisible();
  await editor.getByTestId('mask-name').fill('Placeholder left half');
  await editor.getByTestId('mask-add-kind').selectOption('rectangle');
  await editor.getByTestId('mask-add-shape').click();
  const shape = editor.getByTestId('mask-shape-settings');
  await shape.getByRole('spinbutton', { name: 'Across' }).fill('0');
  await shape.getByRole('spinbutton', { name: 'Down' }).fill('0');
  await shape.getByRole('spinbutton', { name: 'Width' }).fill('960');
  await shape.getByRole('spinbutton', { name: 'Height' }).fill('1080');
  await expect(editor.getByTestId('mask-mode-hide')).toBeChecked();
  await expectNoSeriousA11yIssues(win, 'the mask editor');
  await editor.getByTestId('mask-save').click();
  await expect(editor.getByTestId('mask-list')).toContainText('Placeholder left half');
  await editor.getByRole('button', { name: 'Close masks' }).click();
  // The hall's own shape in the live Look; the side screen keeps its whole picture.
  await hallCard.getByTestId('look-mask').selectOption({ label: 'Placeholder left half' });
  await win.getByRole('button', { name: 'Close screens' }).click();
  await expect.poll(() => whites(hall, [LEFT, RIGHT])).toEqual([false, true]);
  expect(await whites(side, [LEFT, RIGHT])).toEqual([true, true]);
  await expect(hall.locator('[data-look-mask]')).toHaveCount(1);
  await expect(side.locator('[data-look-mask]')).toHaveCount(0);

  // The inverse: show only what is inside the shape.
  const masksPanel = win.getByTestId('masks-panel');
  await masksPanel.getByRole('button', { name: 'Edit' }).click();
  await editor.getByTestId('mask-mode-show').check();
  await editor.getByTestId('mask-save').click();
  await editor.getByRole('button', { name: 'Close masks' }).click();
  await expect.poll(() => whites(hall, [LEFT, RIGHT])).toEqual([true, false]);

  // Clear all and F7 never take a group's own shape away.
  await win.keyboard.press('F1');
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'setBackground',
      background: { kind: 'color', color: '#ffffff' },
    }),
  );
  await expect.poll(() => whites(hall, [LEFT, RIGHT])).toEqual([true, false]);

  // The Masks layer: a circle up from the Masks panel, on every audience screen, until F7.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.masks.save(null, {
      name: 'Placeholder circle',
      width: 1920,
      height: 1080,
      mode: 'show',
      shapes: [{ id: 'circle', kind: 'ellipse', frame: { x: 660, y: 240, width: 600, height: 600 } }],
    });
    if (!made.ok) throw new Error(made.message);
  });
  await expectNoSeriousA11yIssues(win, 'the Masks panel');
  await masksPanel.getByTestId('mask-button').filter({ hasText: 'Placeholder circle' }).click();
  await expect(
    masksPanel.getByTestId('mask-button').filter({ hasText: 'Placeholder circle' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => whites(side, [CENTRE, CORNER])).toEqual([true, false]);
  // The hall has both: its own shape (the left half shows) and the circle (only its inside shows).
  await expect.poll(() => whites(hall, [LEFT, { x: 700, y: 540 }, RIGHT])).toEqual([false, true, false]);
  await expect(win.getByRole('button', { name: 'Clear masks (on screen)' })).toBeEnabled();
  await win.keyboard.press('F7');
  await expect.poll(() => whites(side, [CENTRE, CORNER])).toEqual([true, true]);
  await expect.poll(() => whites(hall, [LEFT, RIGHT])).toEqual([true, false]);
  await app.close();
});
