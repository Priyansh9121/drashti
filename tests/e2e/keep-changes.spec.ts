import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
} from './helpers';
import { makeTestVideo } from './test-media';

/*
 * Ask before throwing away typed work (Session 25): closing a dialog or an editor with typed changes
 * (its close button, Esc or Cancel) asks one question, the same everywhere. Save changes is the
 * primary and has the focus (Session 26g, decided 15 Oct 2026); Esc keeps editing and nothing is
 * saved; Save changes saves; Throw them away closes without saving and is never the default. Saving
 * the live presentation's words changes the screens at once: the question says so, and Keep editing
 * has the focus then, so Enter never changes the screens by accident (Session 26h). Placeholder
 * content only.
 */

/**
 * The question is up with Save changes focused, the one primary (Keep editing, when there is nothing
 * to save from there, or when saving would change the screens now: `live`); Esc keeps editing: the
 * question goes and `still` is still open.
 */
async function escKeepsEditing(
  win: Page,
  still: Locator,
  options: { save?: boolean; live?: string | null } = {},
): Promise<void> {
  const ask = win.getByTestId('keep-changes');
  await expect(ask).toBeVisible();
  const focused =
    options.save === false || typeof options.live === 'string' ? 'Keep editing' : 'Save changes';
  await expect(ask.getByRole('button', { name: focused })).toBeFocused();
  await expect(ask.locator('[data-variant="primary"]')).toHaveCount(options.save === false ? 0 : 1);
  await expect(ask.getByRole('button', { name: 'Throw them away' })).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Keep editing' })).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Save changes' })).toHaveCount(options.save === false ? 0 : 1);
  if (options.live === null) await expect(ask.getByTestId('keep-changes-live')).toHaveCount(0);
  else if (options.live !== undefined)
    await expect(ask.getByTestId('keep-changes-live')).toContainText(options.live);
  await win.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  await expect(still).toBeVisible();
}

const answer = (win: Page, name: 'Save changes' | 'Throw them away') =>
  win.getByTestId('keep-changes').getByRole('button', { name }).click();

async function start(): Promise<{ app: Awaited<ReturnType<typeof launchApp>>['app']; win: Page }> {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  return { app, win };
}

test('New… from words asks before typed words are lost', async () => {
  // Session 55 (Part 12): the open presentation's Edit words and the Kirtan dialog went, with their questions; the
  // words editor stays for a new presentation from pasted words, and asks the same question.
  const { app, win } = await start();
  const count = () =>
    win.evaluate(async () => (await (globalThis as PageGlobals).drashti.library.listPresentations()).length);
  const before = await count();
  await openLibrary(win);
  await win.getByTestId('library-sheet').getByRole('button', { name: 'New…' }).click();
  const editor = win.getByTestId('words-editor');
  const text = editor.getByTestId('words-text');
  await editor.getByRole('textbox', { name: 'Name' }).fill('Placeholder Keep Words');
  await text.fill('Placeholder line one\n\nPlaceholder line two\n');
  await win.keyboard.press('Escape');
  await escKeepsEditing(win, editor);
  await expect(text).toHaveValue(/Placeholder line two/u);
  expect(await count()).toBe(before);
  // Cancel asks too; thrown away: closed, and nothing made.
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(win.getByTestId('keep-changes')).toBeVisible();
  await answer(win, 'Throw them away');
  await expect(editor).toHaveCount(0);
  expect(await count()).toBe(before);
  // Nothing typed: Esc closes at once.
  await win.getByTestId('library-sheet').getByRole('button', { name: 'New…' }).click();
  await expect(editor).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(win.getByTestId('keep-changes')).toHaveCount(0);
  await app.close();
});

test('Playback markers ask before typed points are lost', async () => {
  test.setTimeout(120_000);
  const { app, win } = await start();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-keep-markers-'));
  const video = await makeTestVideo(win, join(dir, 'Placeholder keep clip.webm'), {
    seconds: 3,
    hue: 120,
    tone: 300,
  });
  const [mediaId = ''] = await importAndGetIds(win, [video]);
  const markers = () =>
    win.evaluate(async (mid) => (globalThis as PageGlobals).drashti.media.markers(mid), mediaId);
  await openLibrary(win);
  await win.getByRole('tab', { name: 'Media' }).click();
  await win.getByTestId('media-markers').first().click();
  const dialog = win.getByTestId('markers-dialog');
  await dialog.getByTestId('markers-start').fill('0:01.0');
  await win.keyboard.press('Escape');
  await escKeepsEditing(win, dialog, { live: null });
  await expect(dialog.getByTestId('markers-start')).toHaveValue('0:01.0');
  expect((await markers()).startMs).toBeNull();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await answer(win, 'Save changes');
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await markers()).startMs).toBe(1000);

  await win.getByTestId('media-markers').first().click();
  await dialog.getByTestId('markers-end').fill('0:02.0');
  await dialog.getByRole('button', { name: 'Close markers' }).click();
  await answer(win, 'Throw them away');
  await expect(dialog).toHaveCount(0);
  expect((await markers()).endMs).toBeNull();
  await app.close();
});

test('the setup wizard closes without asking: nothing typed in it is lost (Session 54, E5: its PINs step went)', async () => {
  const { app, win } = await start();
  await chooseMenuItem(app, 'set-up-screens');
  const wizard = win.getByTestId('setup-wizard');
  // From the displays (Session 44: where it opens) through every step to Finish, choosing as it goes (Session 55: its
  // Theme step went).
  for (let step = 0; step < 3; step++) await wizard.getByTestId('setup-next').click();
  await expect(wizard.getByTestId('setup-step')).toHaveText('Finish');
  await wizard.getByRole('button', { name: 'Close the setup' }).click();
  await expect(wizard).toHaveCount(0);
  await expect(win.getByTestId('keep-changes')).toHaveCount(0);
  // Esc the same, from any step.
  await chooseMenuItem(app, 'set-up-screens');
  await wizard.getByTestId('setup-next').click();
  await win.keyboard.press('Escape');
  await expect(wizard).toHaveCount(0);
  await expect(win.getByTestId('keep-changes')).toHaveCount(0);
  await app.close();
});

test('the stage layout editor asks the same question, and Save changes saves', async () => {
  const { app, win } = await start();
  // A stage group and an audience group, for their editors in Screens.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    await d.screens.createGroup('Placeholder Hall');
    const made = await d.screens.createGroup('Placeholder Stage');
    if (!made.ok) throw new Error(made.message);
    const stage = made.snapshot.groups.find((g) => g.name === 'Placeholder Stage');
    await d.screens.setGroupRole(stage?.id ?? '', 'stage');
  });
  const listed = () =>
    win.evaluate(async () =>
      (await (globalThis as PageGlobals).drashti.stageLayouts.list()).map((x) => x.name),
    );

  // A stage layout, from the stage group in Screens.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  // Only the stage group has stage layouts.
  await win.getByTestId('edit-stage-layouts').click();
  const layouts = win.getByTestId('stage-layout-editor');
  await layouts.getByTestId('stage-layout-duplicate').click();
  await layouts.getByTestId('stage-layout-name').fill('Placeholder keep layout');
  await win.keyboard.press('Escape');
  await escKeepsEditing(win, layouts, { live: 'if it is the layout they show' });
  await win.keyboard.press('Escape');
  await answer(win, 'Save changes');
  await expect(layouts).toHaveCount(0);
  await expect.poll(listed).toContain('Placeholder keep layout');

  // A mask from the hall's group was asked here too, until Session 55 took masks out.
  await app.close();
});

test('the slide editor asks before words still being typed in a text box are lost (Cancel)', async () => {
  const { app, win } = await start();
  await win.setViewportSize({ width: 1600, height: 900 });
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Language test slides/u })
    .click();
  await win.getByTestId('edit-slides').click();
  const editor = win.getByTestId('slide-editor');
  await expect(editor.getByTestId('editor-canvas')).toBeVisible();
  // Type in the slide's words (double-click a text box), then Cancel straight away.
  await editor.getByTestId('editor-slide').locator('[data-element]').first().dblclick();
  await expect(editor.locator('[contenteditable="true"]')).toBeVisible();
  await win.keyboard.press('End');
  await win.keyboard.type(' placeholder typed');
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await escKeepsEditing(win, editor);
  // Still there, and Cancel asks again.
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(win.getByTestId('keep-changes')).toBeVisible();
  await answer(win, 'Throw them away');
  await expect(editor).toHaveCount(0);
  await app.close();
});
