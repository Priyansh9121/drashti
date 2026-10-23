import { type Page, expect, test } from '@playwright/test';
import type { EngineCommand } from '../../src/shared/engine/commands';
import type { NewItem } from '../../src/shared/playlists';
import { expectNoSeriousA11yIssues, settled } from './a11y';
import { expectFits } from './fit';
import {
  closeLibrary,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * A video input as a playlist item and as a slide's background cue (Session 51). Chromium's fake camera
 * (DRASHTI_TEST_FAKE_DEVICES: a moving test pattern named "fake_device_0") stands in for the input, named
 * "Placeholder input": never a real camera's picture. An input another computer has and this one does not is an
 * input added, used, then removed from Media: the playlist and the slide still name it. Renamed in Media (Session
 * 52), it is "Placeholder camera", and the playlist and the slide name it so; its Change dialog says they will,
 * and that the spare computer's input needs the new name too (Session 53).
 */

const FAKE = { DRASHTI_TEST_FAKE_DEVICES: '1' };
const INPUT = 'Placeholder input';
const RENAMED = 'Placeholder camera';
/** Chromium's fake camera, as the computer names it. */
const DEVICE = 'fake_device_0';
const LIVE = '[data-testid="live-preview"]';
/** What changing an input says a new name does (Session 53). */
const RENAMING =
  'Renaming it takes this computer’s playlist items and slides that use it to the new name. The spare computer’s input needs the same new name.';

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

function dispatch(win: Page, command: EngineCommand) {
  return win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
}

/** A video input of this computer's, named, through the operator window's own request; its id. */
async function addInput(win: Page, name: string): Promise<string> {
  return win.evaluate(
    async ({ name, device }) => {
      const added = await (globalThis as PageGlobals).drashti.videoInputs.add({ name, device, fit: 'fit' });
      if (!added.ok) throw new Error(added.message);
      return added.view.inputs.find((i) => i.name === name)?.id ?? '';
    },
    { name, device: DEVICE },
  );
}

/** A presentation of placeholder words, a slide each; `inputs[i]` names the video input behind slide i. */
async function makeWords(win: Page, name: string, slides: number, inputs: (string | null)[] = []) {
  return win.evaluate(
    async ({ name, slides, inputs }) => {
      const d = (globalThis as PageGlobals).drashti;
      const words = Array.from({ length: slides }, (_, i) => `Placeholder ${String(i + 1)}`).join('\n\n');
      const made = await d.library.newFromWords(name, words);
      if (!made.ok) throw new Error(made.message);
      if (inputs.every((input) => input === null)) return made.id;
      const opened = await d.library.slidesForEdit(made.id);
      if (!opened.ok) throw new Error(opened.message);
      opened.doc.groups
        .flatMap((g) => g.slides)
        .forEach((slide, i) => {
          const input = inputs[i];
          if (input)
            slide.cues = [
              {
                id: `placeholder-input-${String(i)}`,
                kind: 'background',
                label: '',
                mediaId: null,
                props: JSON.stringify({ input }),
              },
            ];
        });
      const saved = await d.library.saveSlides(made.id, opened.doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
      return made.id;
    },
    { name, slides, inputs },
  );
}

/** A playlist of these items; its id and its items' ids. */
async function makePlaylist(win: Page, name: string, items: NewItem[]) {
  return win.evaluate(
    async ({ name, items }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.create(name, null, false);
      if (!made.ok) throw new Error(made.message);
      const id = made.ids[0] ?? '';
      const added = await d.playlists.addItems(id, null, items);
      if (!added.ok) throw new Error(added.message);
      return { id, items: added.ids };
    },
    { name, items },
  );
}

/** The input plays on this page (within a part of it): live, on screen. */
async function playsOn(page: Page, within = ''): Promise<void> {
  const box = page.locator(`${within} [data-kind="input"]`.trim()).first();
  await expect(box).toHaveAttribute('data-input-state', 'live', { timeout: 15_000 });
  await expect(box).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
}

async function openPlaylist(win: Page, name: string): Promise<void> {
  await win.getByTestId('playlist-node').filter({ hasText: name }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText(name);
}

test('a video input as a playlist item and as a slide’s background, each up with its 1 s fade; Simple Mode’s Next puts one up through the playlist', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...FAKE, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => outputPages(app).length).toBe(1);
  const [hall] = outputPages(app);
  if (!hall) throw new Error('a screen expected');
  await addInput(win, INPUT);
  const opening = await makeWords(win, 'Placeholder opening', 1);
  await makePlaylist(win, 'Placeholder Sunday', [{ kind: 'presentation', presentationId: opening }]);
  await openPlaylist(win, 'Placeholder Sunday');

  // Media's row of the input: Add to playlist, from its right-click menu. Nothing goes up.
  const sheet = await openLibrary(win);
  await sheet.getByTestId('library-tab-media').click();
  const row = sheet.getByTestId('video-input-row').and(sheet.locator(`[data-name="${INPUT}"]`));
  await row.getByTestId('video-input-show').click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Add to “Placeholder Sunday”' }).click();
  await closeLibrary(win);
  const card = win.getByTestId('open-playlist').getByTestId('playlist-item').filter({ hasText: INPUT });
  await expect(card.getByTestId('item-what')).toHaveText('Video input');
  await expect(card.getByTestId('item-input-missing')).toHaveCount(0);
  expect((await state(win)).layers.background).toBeNull();

  // Its card shows it in the middle, with its own live picture; a click there puts it up as the background, with
  // its fixed 1 s fade, and takes the slide off as a picture or video item does.
  await card.click();
  const view = win.getByTestId('item-view');
  await expect(view.getByTestId('item-input')).toBeVisible();
  await settled(win);
  await expectNoSeriousA11yIssues(win, 'a video input item in the middle');
  await view.getByTestId('item-input').click();
  await expect
    .poll(async () => (await state(win)).layers.background)
    .toMatchObject({ kind: 'input', name: INPUT, device: DEVICE, fade: { durationMs: 1000 } });
  await playsOn(hall);
  await playsOn(win, LIVE);
  expect((await state(win)).layers.slide).toBeNull();
  await expect(view.getByTestId('item-input')).toHaveAttribute('aria-current', 'true');

  // A slide's background cue: chosen in the slide editor among this computer's video inputs.
  await dispatch(win, { type: 'clearAll' });
  await expect(hall.locator('[data-kind="input"]')).toHaveCount(0);
  const words = await makeWords(win, 'Placeholder words', 2);
  // The library's sheet opens on the tab it had (Media): its presentations.
  await (await openLibrary(win)).getByTestId('library-tab-presentations').click();
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder words/ })
    .click();
  await win.getByTestId('edit-slides').click();
  const editor = win.getByTestId('slide-editor');
  await editor.getByTestId('choose-background').click();
  const picker = win.getByTestId('media-picker');
  await expect(picker.getByTestId('input-choice')).toHaveCount(1);
  await picker.getByRole('button', { name: `Video input: ${INPUT}` }).click();
  await expect(editor.getByTestId('background-cue')).toHaveText(`Background: the video input “${INPUT}”`);
  await expect(editor.getByTestId('background-input-missing')).toHaveCount(0);
  await editor.getByTestId('save-slides').click();
  await expect(editor).toHaveCount(0);
  const cues = await win.evaluate(
    async (id) =>
      (await (globalThis as PageGlobals).drashti.library.getPresentation(id))?.groups[0]?.slides[0]?.cues,
    words,
  );
  expect(cues).toEqual([
    {
      kind: 'background',
      label: '',
      name: INPUT,
      missing: false,
      unplayable: null,
      background: { kind: 'input', name: INPUT },
    },
  ]);
  await closeLibrary(win);
  // Its thumbnail names it; going live, the input comes up behind the slide with its 1 s fade.
  const first = win.getByTestId('slide-thumb').first();
  await expect(first.getByTestId('thumb-input')).toHaveAttribute('data-input', INPUT);
  await expect(first.getByTestId('thumb-input')).not.toHaveAttribute('data-missing', 'true');
  await first.click();
  await expect
    .poll(async () => (await state(win)).layers.background)
    .toMatchObject({ kind: 'input', name: INPUT, fade: { durationMs: 1000 } });
  await playsOn(hall);
  await expect(hall.locator('[data-layer="slide"]')).toBeVisible();
  // The next slide has none: the input carries on under it.
  const up = (await state(win)).layers.background;
  await dispatch(win, { type: 'next' });
  await expect.poll(async () => (await state(win)).live.slideIndex).toBe(1);
  expect((await state(win)).layers.background).toEqual(up);
  await expect(win.getByTestId('live-input-missing')).toHaveCount(0);

  // Simple Mode: its Next puts the input up through the playlist, while choosing one directly stays refused.
  await dispatch(win, { type: 'clearAll' });
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const items = win.getByTestId('simple-items');
  const simpleInput = items.getByTestId('simple-item').filter({ hasText: INPUT });
  await expect(simpleInput.getByTestId('simple-input-note')).toHaveText('Video input');
  await items.getByTestId('simple-item').filter({ hasText: 'Placeholder opening' }).click();
  await expect.poll(async () => (await state(win)).live.presentationId).toBe(opening);
  await win.getByTestId('simple-buttons').getByRole('button', { name: /^Next/u }).click();
  await expect
    .poll(async () => (await state(win)).layers.background)
    .toMatchObject({ kind: 'input', name: INPUT });
  await playsOn(hall);
  await expect(simpleInput).toHaveAttribute('data-live', 'true');
  const inputId = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.videoInputs.list()).inputs[0]?.id ?? '',
  );
  expect(await dispatch(win, { type: 'showInput', inputId })).toMatchObject({
    ok: false,
    error: 'forbidden',
  });
  await app.close();
});

test('an input this computer does not have: its item and slide say so plainly, never black without why, and Next goes on past it', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ ...FAKE, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => outputPages(app).length).toBe(1);
  // Another computer's "Placeholder input": named by the playlist and a slide, not in this computer's list.
  const id = await addInput(win, INPUT);
  const opening = await makeWords(win, 'Placeholder opening', 1);
  const closing = await makeWords(win, 'Placeholder closing', 1);
  const behind = await makeWords(win, 'Placeholder over the input', 2, [INPUT, null]);
  const sunday = await makePlaylist(win, 'Placeholder Sunday', [
    { kind: 'presentation', presentationId: opening },
    { kind: 'input', name: INPUT },
    { kind: 'presentation', presentationId: closing },
  ]);
  const removed = await win.evaluate(
    (inputId) => (globalThis as PageGlobals).drashti.videoInputs.remove(inputId),
    id,
  );
  expect(removed.ok).toBe(true);

  // Its card says so plainly, and the middle says why and what to do.
  await openPlaylist(win, 'Placeholder Sunday');
  const card = win.getByTestId('open-playlist').getByTestId('playlist-item').filter({ hasText: INPUT });
  await expect(card.getByTestId('item-input-missing')).toHaveText('Not on this computer');
  await card.click();
  const view = win.getByTestId('item-view');
  await expect(view).toHaveAttribute('data-missing', 'true');
  await expect(view).toContainText(
    `No video input called “${INPUT}” is on this computer, so Next goes past it.`,
  );
  await settled(win);
  await expectNoSeriousA11yIssues(win, 'a video input item not on this computer');
  // Next on it says why, and puts nothing up.
  await win.getByTestId('show-next').click();
  await expect(win.getByTestId('operator-notice')).toContainText(
    `The video input “${INPUT}” is not on this computer`,
  );
  expect((await state(win)).layers.background).toBeNull();

  // Played through: Next goes from the opening past it to the closing.
  const [openingItem, , closingItem] = sunday.items;
  await dispatch(win, { type: 'playItem', playlistId: sunday.id, itemId: openingItem ?? '' });
  expect((await state(win)).next).toMatchObject({ kind: 'slide', presentationId: closing });
  await dispatch(win, { type: 'next' });
  await expect
    .poll(async () => (await state(win)).live.playlist)
    .toEqual({ playlistId: sunday.id, itemId: closingItem });

  // A slide naming it: the background stays as it was (here a colour), and LIVE says why.
  await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#203040' } });
  await (await openLibrary(win)).getByTestId('library-tab-presentations').click();
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder over the input/ })
    .click();
  await closeLibrary(win);
  const first = win.getByTestId('slide-thumb').first();
  await expect(first.getByTestId('thumb-input')).toHaveAttribute('data-missing', 'true');
  await first.click();
  await expect.poll(async () => (await state(win)).live.presentationId).toBe(behind);
  await expect(win.getByTestId('live-input-missing')).toHaveText(
    `Video input not on this computer: “${INPUT}”. The background stays as it was.`,
  );
  expect((await state(win)).layers.background).toEqual({ kind: 'color', color: '#203040' });
  // Next goes on to the next slide, which names none: LIVE says nothing more.
  await dispatch(win, { type: 'next' });
  await expect.poll(async () => (await state(win)).live.slideIndex).toBe(1);
  await expect(win.getByTestId('live-input-missing')).toHaveCount(0);
  await app.close();
});

test('renaming an input in Media carries its playlist item and the slide naming it to the new name: neither says Not on this computer, Next puts it up by it, and the input up plays on (Session 52); the Change dialog says so before a name is typed, fitting 1024 × 645 (Session 53)', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ ...FAKE, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => outputPages(app).length).toBe(1);
  const [hall] = outputPages(app);
  if (!hall) throw new Error('a screen expected');
  await addInput(win, INPUT);
  const opening = await makeWords(win, 'Placeholder opening', 1);
  const behind = await makeWords(win, 'Placeholder over the input', 2, [INPUT, null]);
  const sunday = await makePlaylist(win, 'Placeholder Sunday', [
    { kind: 'presentation', presentationId: opening },
    { kind: 'input', name: INPUT },
    { kind: 'presentation', presentationId: behind },
  ]);
  const [openingItem, inputItem, behindItem] = sunday.items;
  await openPlaylist(win, 'Placeholder Sunday');
  // Up now, from its item.
  await dispatch(win, { type: 'playItem', playlistId: sunday.id, itemId: inputItem ?? '' });
  await expect
    .poll(async () => (await state(win)).layers.background)
    .toMatchObject({ kind: 'input', name: INPUT });
  await playsOn(hall);
  const up = (await state(win)).layers.background;
  if (up?.kind !== 'input') throw new Error('the input expected up');

  // Renamed in Media: Change on its row, a new name, Save. In CI's window, 1024 × 645 (Session 53).
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const sheet = await openLibrary(win);
  await sheet.getByTestId('library-tab-media').click();
  const row = sheet.getByTestId('video-input-row').and(sheet.locator(`[data-name="${INPUT}"]`));
  await row.getByTestId('video-input-change').click();
  const dialog = win.getByTestId('video-input-dialog');
  await expect(dialog.getByTestId('video-input-name')).toHaveValue(INPUT);
  await expect(
    dialog.getByTestId('video-input-device').and(dialog.locator(`[data-name="${DEVICE}"]`)),
  ).toBeVisible({ timeout: 15_000 });
  // It says what a new name does from the start, before one is typed (Session 53), in a muted line.
  const renaming = dialog.getByTestId('video-input-renaming');
  await expect(renaming).toHaveText(RENAMING);
  await settled(win);
  const height = () => dialog.evaluate((d) => d.getBoundingClientRect().height);
  const before = await height();
  await dialog.getByTestId('video-input-name').fill(RENAMED);
  await expect(dialog.getByTestId('video-input-save')).toBeEnabled({ timeout: 15_000 });
  // The same once the name differs, so the dialog never grows as it is typed; it fits CI's window, the line and
  // its buttons in reach.
  await expect(renaming).toHaveText(RENAMING);
  expect(await height()).toBe(before);
  await expectFits(dialog, 'Change “Placeholder input” at 1024 × 645');
  await expect(renaming).toBeInViewport();
  const buttons = [dialog.getByRole('button', { name: 'Cancel' }), dialog.getByTestId('video-input-save')];
  for (const button of buttons) await button.click({ trial: true });
  await expectNoSeriousA11yIssues(
    win,
    'Change a video input, a new name typed',
    '[data-testid="video-input-dialog"]',
  );
  await dialog.getByTestId('video-input-save').click();
  await expect(dialog).toHaveCount(0);
  await expect(
    sheet.getByTestId('video-input-row').and(sheet.locator(`[data-name="${RENAMED}"]`)),
  ).toBeVisible();
  // What is on the screens plays on, by its new name: never taken off for it.
  await expect.poll(async () => (await state(win)).layers.background).toEqual({ ...up, name: RENAMED });
  await playsOn(hall);

  // Its item takes the new name, on this computer: not Not on this computer, and no card left on the old name.
  await closeLibrary(win);
  const cards = win.getByTestId('open-playlist').getByTestId('playlist-item');
  const card = cards.filter({ hasText: RENAMED });
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('item-what')).toHaveText('Video input');
  await expect(card.getByTestId('item-input-missing')).toHaveCount(0);
  await expect(cards.filter({ hasText: INPUT })).toHaveCount(0);

  // The slide naming it takes it too: in the library, and in its thumbnail, on this computer.
  const cues = await win.evaluate(
    async (id) =>
      (await (globalThis as PageGlobals).drashti.library.getPresentation(id))?.groups[0]?.slides[0]?.cues,
    behind,
  );
  expect(cues).toEqual([
    {
      kind: 'background',
      label: '',
      name: RENAMED,
      missing: false,
      unplayable: null,
      background: { kind: 'input', name: RENAMED },
    },
  ]);
  await (await openLibrary(win)).getByTestId('library-tab-presentations').click();
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder over the input/ })
    .click();
  await closeLibrary(win);
  const first = win.getByTestId('slide-thumb').first();
  await expect(first.getByTestId('thumb-input')).toHaveAttribute('data-input', RENAMED);
  await expect(first.getByTestId('thumb-input')).not.toHaveAttribute('data-missing', 'true');

  // Played through from the opening: Next is the input by its new name, and puts it up with its 1 s fade; then
  // the slide naming it, with the input carrying on behind it and nothing said missing.
  await dispatch(win, { type: 'clearAll' });
  await expect(hall.locator('[data-kind="input"]')).toHaveCount(0);
  await dispatch(win, { type: 'playItem', playlistId: sunday.id, itemId: openingItem ?? '' });
  expect((await state(win)).next).toMatchObject({ kind: 'input', itemId: inputItem, name: RENAMED });
  await dispatch(win, { type: 'next' });
  await expect
    .poll(async () => (await state(win)).layers.background)
    .toMatchObject({ kind: 'input', name: RENAMED, fade: { durationMs: 1000 } });
  await playsOn(hall);
  expect((await state(win)).next).toMatchObject({ kind: 'slide', presentationId: behind, input: RENAMED });
  await dispatch(win, { type: 'next' });
  await expect
    .poll(async () => (await state(win)).live.playlist)
    .toEqual({ playlistId: sunday.id, itemId: behindItem });
  expect((await state(win)).layers.background).toMatchObject({ kind: 'input', name: RENAMED });
  await expect(win.getByTestId('live-input-missing')).toHaveCount(0);
  await app.close();
});
