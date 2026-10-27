import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { LOOK_LAYERS } from '../../src/shared/looks';
import {
  chooseMenuItem,
  launchApp,
  operatorPage,
  operatorReady,
  type PageGlobals,
  setUpScreen,
} from './helpers';

/*
 * Quick ticks of boxes the main process saves (Session 54, Session 53's question 6): a tick made before the one
 * before it is saved never undoes it. Each box showed what the main process had saved, and each tick sent the whole
 * setting made from that, so a second tick made before the first's answer was made to what was saved before the
 * first, and put it back: a group's layers and a kirtan's languages in a Look, and what an Events out address gets.
 * Here the main process handles those requests 1.5 s late, as a busy one on a slow computer does (CI's Windows,
 * Session 52), so each next tick comes first. Nothing is sent anywhere: the address hears of no change in the show.
 * Placeholder names only.
 */

/** How late the main process handles them: Session 53 saw CI's flake with an answer 1.5 s late. */
const LATE_MS = 1500;
/** Long enough for every held-back request to be handled. */
const SAVED = { timeout: 15_000 };

/**
 * The main process handles requests on these channels `ms` late, as a busy one on a slow computer does: the work,
 * what it tells the windows and its answer all come after the next tick. There is no public way to hold a handler
 * back, so this wraps the one Electron keeps for each channel (ipcMain's _invokeHandlers); it fails plainly should
 * Electron keep them elsewhere.
 */
async function handledLate(app: ElectronApplication, channels: readonly string[], ms: number): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { channels, ms }) => {
      type Handler = (...args: unknown[]) => unknown;
      const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, Handler> })._invokeHandlers;
      for (const channel of channels) {
        const run = handlers?.get(channel);
        if (!handlers || !run) throw new Error(`No handler to hold back for ${channel}`);
        handlers.set(channel, async (...args: unknown[]) => {
          // eslint-disable-next-line no-restricted-syntax -- in the main process: held back, as a busy one is
          await new Promise((resolve) => setTimeout(resolve, ms));
          return run(...args);
        });
      }
    },
    { channels, ms },
  );
}

/** A group's settings in the live Look, as the main process has saved them. */
const savedLook = (win: Page, groupId: string) =>
  win.evaluate(async (id) => {
    const looks = await (globalThis as PageGlobals).drashti.looks.list();
    return looks.looks.find((l) => l.id === looks.liveId)?.groups[id] ?? null;
  }, groupId);

/** What the first Events out address gets, as the main process has saved it. */
const savedAddress = (win: Page) =>
  win.evaluate(async () => {
    const [first] = (await (globalThis as PageGlobals).drashti.events.view()).addresses;
    return first ? { kinds: first.kinds, words: first.words } : null;
  });

test('a group’s layers and a kirtan’s languages in a Look: each tick made before the one before it is saved is kept', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  const groupId = await win.evaluate(
    async () =>
      (await (globalThis as PageGlobals).drashti.screens.get()).groups.find((g) => g.name === 'Main Hall')
        ?.id ?? '',
  );
  expect(groupId).not.toBe('');
  await handledLate(app, ['looks:set-group'], LATE_MS);
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const card = win.locator(`#screen-group-${groupId}`).getByTestId('group-look');

  // Two layers off, the second straight after the first: both are off once both are saved, and the boxes say so.
  const background = card.getByTestId('look-layer-background');
  const messages = card.getByTestId('look-layer-messages');
  await expect(background).toBeChecked();
  await expect(messages).toBeChecked();
  await background.click();
  await messages.click();
  await expect
    .poll(() => savedLook(win, groupId), SAVED)
    .toMatchObject({ layers: LOOK_LAYERS.filter((l) => l !== 'background' && l !== 'messages') });
  await expect(background).not.toBeChecked();
  await expect(messages).not.toBeChecked();

  // Only these languages, then Hindi off and English off, each straight after the one before: Gujarati and
  // transliteration once all three are saved.
  const picker = card.getByTestId('language-picker');
  await picker.getByTestId('languages-some').click();
  await picker.getByRole('checkbox', { name: 'Hindi' }).click();
  await picker.getByRole('checkbox', { name: 'English' }).click();
  await expect.poll(() => savedLook(win, groupId), SAVED).toMatchObject({ languages: ['gu', 'translit'] });
  await expect(picker.getByTestId('languages-some')).toBeChecked();
  await expect(picker.getByRole('checkbox', { name: 'Hindi' })).not.toBeChecked();
  await expect(picker.getByRole('checkbox', { name: 'English' })).not.toBeChecked();
  await expect(picker.getByRole('checkbox', { name: 'Gujarati' })).toBeChecked();
  await app.close();
});

test('what an Events out address gets: each tick made before the one before it is saved is kept', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await chooseMenuItem(app, 'events-out');
  const dialog = win.getByTestId('events-dialog');
  await expect(dialog).toBeVisible();
  // An address on this computer, which nothing is sent to here (the show never changes).
  await dialog.getByTestId('events-url').fill('http://127.0.0.1:9/placeholder-hook');
  await dialog.getByTestId('events-add').click();
  await expect(dialog.getByTestId('events-host-0')).toHaveText('127.0.0.1:9');
  await handledLate(app, ['events:update'], LATE_MS);

  // Three kinds, each straight after the one before: all three once saved, and the boxes say so.
  const kinds = ['slide.changed', 'blackout.changed', 'screen.stopped'] as const;
  for (const kind of kinds) await dialog.getByTestId(`events-kind-${kind}-0`).click();
  await expect.poll(() => savedAddress(win), SAVED).toMatchObject({ kinds: [...kinds] });
  for (const kind of kinds) await expect(dialog.getByTestId(`events-kind-${kind}-0`)).toBeChecked();

  // Include the words for two of them, the second straight after the first: both once saved.
  await dialog.getByTestId('events-words-slide.changed-0').click();
  await dialog.getByTestId('events-words-screen.stopped-0').click();
  await expect
    .poll(() => savedAddress(win), SAVED)
    .toMatchObject({ words: ['slide.changed', 'screen.stopped'] });
  await expect(dialog.getByTestId('events-words-slide.changed-0')).toBeChecked();
  await expect(dialog.getByTestId('events-words-screen.stopped-0')).toBeChecked();
  await expect(dialog.getByTestId('events-problem')).toHaveCount(0);
  await app.close();
});
