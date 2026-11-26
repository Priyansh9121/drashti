import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { LowerThirdInput } from '../../src/shared/lower-thirds';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../src/shared/lower-thirds';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, holdStill, launchApp, openSection, operatorPage, operatorReady } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * A double click on a trash that is always shown takes out that row only (QA24-ROWDEL-2, as QA23-ROWDEL-1 did for
 * the playlists', the library's and the tracks' rows: one-click.spec.ts). Its first click takes the row out at once,
 * the row under it moves up under the pointer, and the second click (a click count of 2) used to take that row out
 * too: a lower third (with Undo) and a caption word (kept at once). Only the first click of a run counts now. In CI's
 * window, 1024 × 645. Placeholder names and invented words only.
 */

/** The pointer on this button's middle: where both clicks of the double click land. */
async function pointAt(win: Page, button: Locator): Promise<{ x: number; y: number }> {
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error('the trash is not in view');
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await win.mouse.move(at.x, at.y);
  return at;
}

/** Whether the point is on this button now (the row under the first has moved up into its place). */
async function isUnder(button: Locator, at: { x: number; y: number }): Promise<boolean> {
  const box = await button.boundingBox();
  return (
    box !== null && at.x >= box.x && at.x <= box.x + box.width && at.y >= box.y && at.y <= box.y + box.height
  );
}

/** A double click's first click, then (once the next row is under the pointer) its second: click counts 1 and 2. */
async function firstClick(win: Page): Promise<void> {
  await win.mouse.down({ clickCount: 1 });
  await win.mouse.up({ clickCount: 1 });
}
async function secondClick(win: Page, at: { x: number; y: number }): Promise<void> {
  // Moved a pixel, as a hand does.
  await win.mouse.move(at.x, at.y + 1);
  await win.mouse.down({ clickCount: 2 });
  await win.mouse.up({ clickCount: 2 });
}

async function start() {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  return { app, win };
}

const LOWER_THIRDS = ['Placeholder first', 'Placeholder second', 'Placeholder third'] as const;

const lowerThird = (name: string): LowerThirdInput => ({
  lines: [name, 'Placeholder title', ''],
  look: DEFAULT_LOWER_THIRD_LOOK,
  where: 'hall',
  animation: 'fade-quick',
});

/** The lower thirds' first lines, as the library keeps them. */
const lowerThirdsKept = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.lowerThirds.list()).map((l) => l.lines[0] ?? ''),
  );

test('a double click on a lower third’s trash takes out that lower third only: the one that moves up under the pointer stays', async () => {
  test.setTimeout(120_000);
  const { app, win } = await start();
  for (const name of LOWER_THIRDS)
    await win.evaluate(async (i) => {
      const made = await (globalThis as PageGlobals).drashti.lowerThirds.save(null, i);
      if (!made.ok) throw new Error(made.message);
    }, lowerThird(name));
  await openSection(win, 'lower-thirds');
  const panel = win.getByTestId('lower-thirds-panel');
  const rows = panel.getByTestId('lower-third-row');
  await expect(rows).toHaveCount(LOWER_THIRDS.length);
  // The rows in the order they are drawn: the first one's trash takes the double click.
  const shown = await rows.evaluateAll((all) => all.map((r) => r.getAttribute('data-id') ?? ''));
  const [firstId, nextId] = shown;
  const trash = (id: string | undefined) =>
    panel.locator(`[data-id="${id ?? ''}"]`).getByTestId('lower-third-delete');
  const firstName = await panel.locator(`[data-id="${firstId ?? ''}"]`).textContent();
  const gone = LOWER_THIRDS.find((n) => firstName?.includes(n)) ?? '';
  const left = LOWER_THIRDS.filter((n) => n !== gone).sort();

  const at = await pointAt(win, trash(firstId));
  // The first click: the lower third goes at once, with no question and with Undo, as one click does.
  await firstClick(win);
  await expect(rows).toHaveCount(LOWER_THIRDS.length - 1);
  await expect.poll(async () => (await lowerThirdsKept(win)).sort()).toEqual(left);
  await expect(win.getByTestId('undo-removal')).toContainText(`Deleted “${gone}”`);
  // The next one has moved up into its place: its trash is under the pointer, where the second click lands.
  await expect.poll(() => isUnder(trash(nextId), at)).toBe(true);
  await secondClick(win, at);
  await holdStill(
    async () => JSON.stringify((await lowerThirdsKept(win)).sort()) === JSON.stringify(left),
    1500,
    'a double click’s second click takes out no other lower third',
  );
  await expect(rows).toHaveCount(LOWER_THIRDS.length - 1);
  await expect(win.getByTestId('undo-removal')).toContainText(`Deleted “${gone}”`);
  // Enter on a trash (a click with no count) still takes its lower third out, as the Delete key does.
  await trash(nextId).focus();
  await win.keyboard.press('Enter');
  await expect(rows).toHaveCount(LOWER_THIRDS.length - 2);
  await app.close();
});

/**
 * Invented words, enough that the list scrolls (it shows about six), as an admin's list of names does: the dialog then
 * keeps its height as one goes. A shorter list shrinks it, and the dialog, centred, moves down by half a row, so the
 * second click lands on the next word's Remove only from the lower half of the button (CI's red run, :149).
 */
const WORDS = [
  'Zentrova',
  'Quellmark',
  'Varnisto',
  'Brolevan',
  'Tesmaric',
  'Olvenor',
  'Druskel',
  'Pemarit',
] as const;

/** The English caption words, as the library keeps them. */
const wordsKept = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.captionWords.view()).words
      .filter((w) => w.language === 'en')
      .map((w) => w.word),
  );

test('a double click on a caption word’s Remove takes out that word only: the word that moves up under the pointer stays', async () => {
  test.setTimeout(120_000);
  const { app, win } = await start();
  await win.evaluate(
    async (words) => {
      await (globalThis as PageGlobals).drashti.captionWords.set(
        words.map((word) => ({ language: 'en' as const, word })),
      );
    },
    [...WORDS],
  );
  // File › Live Captions… › Caption Words…, the English list.
  await chooseMenuItem(app, 'live-captions');
  await win.getByTestId('captions-dialog').getByTestId('captions-words').click();
  const dialog = win.getByTestId('caption-words-dialog');
  await dialog.getByTestId('caption-words-language').selectOption('en');
  await expect(dialog.getByTestId('caption-word')).toHaveText([...WORDS]);
  const remove = (word: string) => dialog.getByRole('button', { name: `Remove ${word}` });

  const rest = WORDS.slice(1);
  const at = await pointAt(win, remove(WORDS[0]));
  // The first click: the word goes at once (kept at once, as each change is).
  await firstClick(win);
  await expect(dialog.getByTestId('caption-word')).toHaveText(rest);
  await expect.poll(() => wordsKept(win)).toEqual(rest);
  // The next word has moved up into its place: its Remove is under the pointer, where the second click lands.
  await expect.poll(() => isUnder(remove(WORDS[1]), at)).toBe(true);
  await secondClick(win, at);
  await holdStill(
    async () => JSON.stringify(await wordsKept(win)) === JSON.stringify(rest),
    1500,
    'a double click’s second click takes out no other word',
  );
  await expect(dialog.getByTestId('caption-word')).toHaveText(rest);
  // Enter on a Remove (a click with no count) still takes its word out.
  await remove(WORDS[2]).focus();
  await win.keyboard.press('Enter');
  await expect(dialog.getByTestId('caption-word')).toHaveText(rest.filter((w) => w !== WORDS[2]));
  await app.close();
});

/** Invented words to leave out, enough that the list scrolls (as with Caption Words, above). */
const LEFT_OUT = [
  'Zorvek',
  'Plindar',
  'Quosmet',
  'Vretnal',
  'Skavoru',
  'Dremlix',
  'Tolvaq',
  'Murnesk',
] as const;

/** The admin's own English words left out, as the library keeps them. */
const leftOutKept = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.captionClean.view()).words
      .filter((w) => w.language === 'en')
      .map((w) => w.word),
  );

test('a double click on a word’s Remove in Words Left Out… takes out that word only: the word that moves up under the pointer stays', async () => {
  test.setTimeout(120_000);
  const { app, win } = await start();
  await win.evaluate(
    async (words) => {
      await (globalThis as PageGlobals).drashti.captionClean.set(
        words.map((word) => ({ language: 'en' as const, word })),
      );
    },
    [...LEFT_OUT],
  );
  // File › Live Captions… › Words Left Out…, the English list; its words hidden, as each time it opens.
  await chooseMenuItem(app, 'live-captions');
  await win.getByTestId('captions-dialog').getByTestId('captions-clean').click();
  const dialog = win.getByTestId('caption-clean-dialog');
  await dialog.getByTestId('caption-clean-language').selectOption('en');
  const rows = dialog.getByTestId('caption-clean-word');
  await expect(rows).toHaveCount(LEFT_OUT.length);
  // Hidden, each Remove is named by its place: the first row's is always "Remove Hidden word 1".
  const first = dialog.getByRole('button', { name: 'Remove Hidden word 1', exact: true });
  const second = dialog.getByRole('button', { name: 'Remove Hidden word 2', exact: true });
  const rest = LEFT_OUT.slice(1);

  const at = await pointAt(win, first);
  // The first click: the word goes at once (kept at once, with no Undo).
  await firstClick(win);
  await expect(rows).toHaveCount(LEFT_OUT.length - 1);
  await expect.poll(() => leftOutKept(win)).toEqual(rest);
  // The next word has moved up into its place: its Remove is under the pointer, where the second click lands.
  await expect.poll(() => isUnder(first, at)).toBe(true);
  await secondClick(win, at);
  await holdStill(
    async () => JSON.stringify(await leftOutKept(win)) === JSON.stringify(rest),
    1500,
    'a double click’s second click takes out no other word',
  );
  await expect(rows).toHaveCount(LEFT_OUT.length - 1);
  // Enter on a Remove (a click with no count) still takes its word out.
  await second.focus();
  await win.keyboard.press('Enter');
  await expect.poll(() => leftOutKept(win)).toEqual(rest.filter((w) => w !== rest[1]));
  await app.close();
});
