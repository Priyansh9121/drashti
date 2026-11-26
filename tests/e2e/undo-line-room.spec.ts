import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { LowerThirdInput } from '../../src/shared/lower-thirds';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../src/shared/lower-thirds';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, openSection, operatorPage, operatorReady } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The Undo line's room (QA24-UNDOLINE-2, from the review of QA23-UNDOLINE-1). The line at the foot of the left column
 * goes by itself a minute after the last change, and at once when its own Undo takes back the last change there is.
 * When it went, everything in the column above it moved by its height, unasked: a click aimed at a wallpaper or a
 * playlist could land on another (choosing a wallpaper changes the screens when nothing is up). Now, when it goes
 * with the pointer over the column, its room stays, empty, until the pointer is somewhere else, so nothing in the
 * column moves under the pointer; its words still go on time. With the pointer elsewhere, it goes as before. The
 * line's clock is held and moved on by the test (DRASHTI_TEST_UNDO_LINE): no real minute is waited. The changes are
 * lower thirds deleted from their panel; placeholder names only.
 */

const NAMES = ['Placeholder one', 'Placeholder two'] as const;

const input = (name: string): LowerThirdInput => ({
  lines: [name, 'Placeholder title', ''],
  look: DEFAULT_LOWER_THIRD_LOOK,
  where: 'hall',
  animation: 'fade-quick',
});

async function make(win: Page, lt: LowerThirdInput): Promise<void> {
  await win.evaluate(async (i) => {
    const made = await (globalThis as PageGlobals).drashti.lowerThirds.save(null, i);
    if (!made.ok) throw new Error(made.message);
  }, lt);
}

/** The Undo line's clock moved on (the test switch's own; a packaged Drashti never has it). */
const later = (win: Page, ms: number) =>
  win.evaluate((by) => {
    const move = (globalThis as { drashtiTestUndoLineLater?: (ms: number) => void }).drashtiTestUndoLineLater;
    if (!move) throw new Error('the Undo line’s test clock is not there (DRASHTI_TEST_UNDO_LINE)');
    move(by);
  }, ms);

/** Two frames on: the window has drawn what the clock moving on changed. */
const drawn = (win: Page) =>
  win.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );

test('when the Undo line goes with the pointer over the left column, its room stays empty until the pointer is elsewhere: nothing in the column moves under the pointer', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ DRASHTI_TEST_UNDO_LINE: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  for (const name of NAMES) await make(win, input(name));
  await openSection(win, 'lower-thirds');
  const panel = win.getByTestId('lower-thirds-panel');
  const row = (name: string) => panel.getByTestId('lower-third-row').filter({ hasText: name });
  await expect(panel.getByTestId('lower-third-row')).toHaveCount(NAMES.length);

  const column = win.getByRole('region', { name: 'Playlists' });
  const walls = column.getByTestId('wallpapers');
  const line = win.getByTestId('undo-removal');
  const room = win.getByTestId('undo-room');
  /** Where the wallpapers are: they sit right above the line, and move first when it comes or goes. */
  const top = async () => {
    const box = await walls.boundingBox();
    if (!box) throw new Error('the wallpapers are not in view');
    return box.y;
  };
  /** The pointer over the wallpapers, in the left column. */
  const overWallpapers = async () => {
    const box = await walls.boundingBox();
    if (!box) throw new Error('the wallpapers are not in view');
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  };
  /** The pointer out of the left column: over the middle of the window, beside it. */
  const elsewhere = async () => {
    const box = await column.boundingBox();
    if (!box) throw new Error('the left column is not in view');
    await win.mouse.move(box.x + box.width + 60, box.y + 120);
  };
  /** A lower third deleted with its trash: a change the line says, with a minute of its own. */
  const deleteOne = async (name: string) => {
    await row(name).getByTestId('lower-third-delete').click();
    await expect(row(name)).toHaveCount(0);
    await expect(line).toContainText(`Deleted “${name}”`);
  };

  // No line yet: where the wallpapers are without it. The line comes with a change, and the wallpapers move up by
  // its height (the change's own doing, asked for).
  await expect(line).toHaveCount(0);
  const without = await top();
  await deleteOne(NAMES[0]);
  const lineBox = await line.boundingBox();
  if (!lineBox) throw new Error('the Undo line is not in view');
  const withLine = await top();
  expect(without - withLine).toBeCloseTo(lineBox.height, 0);

  // 1. The line's own Undo takes back the only change there is: the line goes at once, under the pointer. Its room
  //    stays, so what the pointer is over does not change (a second click lands on nothing, never on a wallpaper).
  await line.getByRole('button', { name: /Undo/u }).click();
  await expect(row(NAMES[0])).toHaveCount(1);
  await expect(line).toHaveCount(0);
  await drawn(win);
  expect(await top()).toBeCloseTo(withLine, 0);
  await expect(room).toHaveCount(1);
  await expect(room).toBeEmpty();
  // The pointer elsewhere: the room closes, and the wallpapers are back where they are without the line.
  await elsewhere();
  await expect(room).toHaveCount(0);
  await expect.poll(top).toBeCloseTo(without, 0);

  // 2. A change, then the pointer over the wallpapers when its minute is up: the words go on time, their room stays
  //    (the wallpapers stay where the pointer found them).
  await deleteOne(NAMES[0]);
  expect(await top()).toBeCloseTo(withLine, 0);
  await overWallpapers();
  await later(win, 59_000);
  await drawn(win);
  await expect(line).toContainText(`Deleted “${NAMES[0]}”`);
  await later(win, 1_000);
  await drawn(win);
  await expect(line).toHaveCount(0);
  expect(await top()).toBeCloseTo(withLine, 0);
  await expect(room).toHaveCount(1);
  await expect(room).toBeEmpty();
  // Moved about inside the column, the room stays; moved out of it, it closes.
  await win.mouse.move(lineBox.x + lineBox.width / 2, lineBox.y + lineBox.height / 2);
  await drawn(win);
  await expect(room).toHaveCount(1);
  expect(await top()).toBeCloseTo(withLine, 0);
  await elsewhere();
  await expect(room).toHaveCount(0);
  await expect.poll(top).toBeCloseTo(without, 0);

  // 3. A change made from the live column, the pointer still there when its minute is up: no room is kept; the
  //    wallpapers go back down at once, away from the pointer, as before.
  await deleteOne(NAMES[1]);
  expect(await top()).toBeCloseTo(withLine, 0);
  await later(win, 60_000);
  await drawn(win);
  await expect(line).toHaveCount(0);
  await expect(room).toHaveCount(0);
  expect(await top()).toBeCloseTo(without, 0);

  // Edit > Undo still brings the change back after the line has gone (QA23-UNDOLINE-1), and no line or room comes.
  await chooseMenuItem(app, 'undo');
  await expect(row(NAMES[1])).toHaveCount(1);
  await expect(line).toHaveCount(0);
  await expect(room).toHaveCount(0);
  await app.close();
});
