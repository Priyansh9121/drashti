import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
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
 * first, and put it back: a kirtan's languages for a group (in a Look with its layers until Session 55, in Screens
 * since), and what an Events out address gets.
 * Here the main process handles those requests 1.5 s late, as a busy one on a slow computer does (CI's Windows,
 * Session 52), so each next tick comes first. Since the review, one save at a time for each setting: the main
 * process here handles the first of two saves last, as two waiting for an import to give way could go (each waits
 * on its own), and refuses one, which goes back. Nothing is sent anywhere: the address hears of no change in the
 * show. Placeholder names only.
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

/**
 * The main process handles the next request on this channel `ms` late and every one after it at once, as two saves
 * waiting for an import to give way can go in either order (each waits on its own, Session 54 review): a later tick
 * would be written first, then the earlier over it. heldHandled says when the held one has been handled.
 */
async function firstHandledLast(app: ElectronApplication, channel: string, ms: number): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { channel, ms }) => {
      type Handler = (...args: unknown[]) => unknown;
      const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, Handler> })._invokeHandlers;
      const run = handlers?.get(channel);
      if (!handlers || !run) throw new Error(`No handler to hold back for ${channel}`);
      const held = globalThis as { drashtiTestHeldHandled?: boolean };
      held.drashtiTestHeldHandled = false;
      handlers.set(channel, async (...args: unknown[]) => {
        handlers.set(channel, run);
        // eslint-disable-next-line no-restricted-syntax -- in the main process: the first held back, the rest not
        await new Promise((resolve) => setTimeout(resolve, ms));
        const answer = await run(...args);
        held.drashtiTestHeldHandled = true;
        return answer;
      });
    },
    { channel, ms },
  );
}

/**
 * The main process refuses the next request on this channel, `ms` late, as it refuses a change it cannot make; every
 * one after it goes to it as before, at once.
 */
async function refusedOnce(app: ElectronApplication, channel: string, ms: number): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { channel, ms }) => {
      type Handler = (...args: unknown[]) => unknown;
      const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, Handler> })._invokeHandlers;
      const run = handlers?.get(channel);
      if (!handlers || !run) throw new Error(`No handler to refuse for ${channel}`);
      handlers.set(channel, async () => {
        handlers.set(channel, run);
        // eslint-disable-next-line no-restricted-syntax -- in the main process: the refusal held back, as a busy one is
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { ok: false, message: 'Placeholder: that change cannot be made now.' };
      });
    },
    { channel, ms },
  );
}

/** Whether the request firstHandledLast held back has been handled. */
const heldHandled = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { drashtiTestHeldHandled?: boolean }).drashtiTestHeldHandled === true);

/** The channel a group's languages are saved on (screens.setGroupLanguages). */
const LANGUAGES = 'screens:set-group-languages';

/** Drashti with a Main Hall group, Screens open: the group's languages in its card, and the group's id. */
async function hallLanguages(win: Page) {
  await setUpScreen(win, 'Main Hall', 0);
  const groupId = await win.evaluate(
    async () =>
      (await (globalThis as PageGlobals).drashti.screens.get()).groups.find((g) => g.name === 'Main Hall')
        ?.id ?? '',
  );
  expect(groupId).not.toBe('');
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const picker = win
    .locator(`#screen-group-${groupId}`)
    .getByTestId('group-languages')
    .getByTestId('language-picker');
  return { groupId, picker, box: (name: string) => picker.getByRole('checkbox', { name }) };
}

/** A group's languages, as the main process has saved them (null: every language). */
const savedLanguages = (win: Page, groupId: string) =>
  win.evaluate(
    async (id) =>
      (await (globalThis as PageGlobals).drashti.screens.get()).groups.find((g) => g.id === id)?.languages ??
      null,
    groupId,
  );

/** What the first Events out address gets, as the main process has saved it. */
const savedAddress = (win: Page) =>
  win.evaluate(async () => {
    const [first] = (await (globalThis as PageGlobals).drashti.events.view()).addresses;
    return first ? { kinds: first.kinds, words: first.words } : null;
  });

test('a group’s languages in Screens: each tick made before the one before it is saved is kept', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const { groupId, picker, box } = await hallLanguages(win);
  await handledLate(app, [LANGUAGES], LATE_MS);
  // (A group's layers, in its Look, were ticked here too until Session 55 took Looks out.)

  // Only these languages, then Hindi off and English off, each straight after the one before: Gujarati and
  // transliteration once all three are saved.
  await picker.getByTestId('languages-some').click();
  await box('Hindi').click();
  await box('English').click();
  await expect.poll(() => savedLanguages(win, groupId), SAVED).toEqual(['gu', 'translit']);
  await expect(picker.getByTestId('languages-some')).toBeChecked();
  await expect(box('Hindi')).not.toBeChecked();
  await expect(box('English')).not.toBeChecked();
  await expect(box('Gujarati')).toBeChecked();
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

test('two ticks whose saves the main process would handle the wrong way round: the second waits for the first’s answer, so the latest is kept (Session 54 review)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const { groupId, picker, box } = await hallLanguages(win);
  await picker.getByTestId('languages-some').click();
  await expect.poll(() => savedLanguages(win, groupId), SAVED).toEqual(['gu', 'hi', 'translit', 'en']);
  // The first save held back, the second handled at once: sent together, the second was written first, then the
  // first over it, English back on.
  await firstHandledLast(app, LANGUAGES, LATE_MS);
  await box('Hindi').click();
  await box('English').click();
  // Once the held one has been handled (it was written last before), both are off, and the boxes say so.
  await expect.poll(() => heldHandled(app), SAVED).toBe(true);
  await expect.poll(() => savedLanguages(win, groupId), SAVED).toEqual(['gu', 'translit']);
  await expect(box('Hindi')).not.toBeChecked();
  await expect(box('English')).not.toBeChecked();
  await app.close();
});

test('a tick the main process refuses goes back once refused; refused with another tick straight after, the boxes end on what was saved (Session 54 review)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const { groupId, picker, box } = await hallLanguages(win);
  const some = picker.getByTestId('languages-some');
  const all = picker.getByTestId('languages-all');

  // Refused: shown at once, then back as it was once the refusal comes, saying why; nothing saved.
  await refusedOnce(app, LANGUAGES, LATE_MS);
  await some.click();
  await expect(some).toBeChecked();
  await expect(win.getByRole('dialog', { name: 'Screens' })).toContainText(
    'Placeholder: that change cannot be made now.',
  );
  await expect(all).toBeChecked();
  expect(await savedLanguages(win, groupId)).toBeNull();

  // Refused, with Hindi off straight after: that goes once the refusal has come, made to what the boxes showed,
  // and the boxes end on what the main process saved.
  await refusedOnce(app, LANGUAGES, LATE_MS);
  await some.click();
  await box('Hindi').click();
  await expect.poll(() => savedLanguages(win, groupId), SAVED).toEqual(['gu', 'translit', 'en']);
  await expect(some).toBeChecked();
  await expect(box('Hindi')).not.toBeChecked();
  await expect(box('English')).toBeChecked();
  await app.close();
});
