import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, importAndGetIds, launchApp, operatorPage, operatorReady } from './helpers';
import { makeTestVideo } from './test-media';

/*
 * Ask before throwing away typed work (Session 25): closing a dialog or an editor with typed changes
 * (its close button, Esc or Cancel) asks one question, the same everywhere. Keep editing has the
 * focus, so Enter (and Esc) keep editing and nothing is saved; Save changes saves; Throw them away
 * closes without saving. Saving the live presentation's words changes the screens at once, and the
 * question says so. Placeholder content only.
 */

/**
 * The question is up with Keep editing focused (and Save changes, unless there is nothing to save
 * from there); Enter keeps editing: the question goes and `still` is still open.
 */
async function enterKeepsEditing(
  win: Page,
  still: Locator,
  options: { save?: boolean; live?: string | null } = {},
): Promise<void> {
  const ask = win.getByTestId('keep-changes');
  await expect(ask).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await expect(ask.getByRole('button', { name: 'Throw them away' })).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Save changes' })).toHaveCount(options.save === false ? 0 : 1);
  if (options.live === null) await expect(ask.getByTestId('keep-changes-live')).toHaveCount(0);
  else if (options.live !== undefined)
    await expect(ask.getByTestId('keep-changes-live')).toContainText(options.live);
  await win.keyboard.press('Enter');
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

/** A presentation made from typed words, chosen in the library. */
async function presentation(win: Page, name: string, words: string): Promise<string> {
  const id = await win.evaluate(
    async ({ name, words }) => {
      const made = await (globalThis as PageGlobals).drashti.library.newFromWords(name, words);
      if (!made.ok) throw new Error(made.message);
      return made.id;
    },
    { name, words },
  );
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: new RegExp(`^${name}`, 'u') })
    .click();
  await expect(win.getByTestId('slide-grid')).toHaveAttribute('data-presentation-id', id);
  return id;
}

test('Edit words asks before typed words are lost, and says when saving changes the screens at once', async () => {
  const { app, win } = await start();
  const id = await presentation(
    win,
    'Placeholder Keep Words',
    'Placeholder line one\n\nPlaceholder line two',
  );
  const words = () =>
    win.evaluate(async (pid) => {
      const r = await (globalThis as PageGlobals).drashti.library.words(pid);
      return r.ok ? r.text : '';
    }, id);
  const before = await words();
  const grid = win.getByTestId('slide-grid');
  // Its first slide goes up: it is the live presentation.
  await grid.getByTestId('slide-thumb').first().click();
  await expect(win.getByTestId('presentation-list').getByText('Live', { exact: true })).toBeVisible();

  await grid.getByRole('button', { name: 'Edit words' }).click();
  const editor = win.getByTestId('words-editor');
  const text = editor.getByTestId('words-text');
  await expect(text).toHaveValue(before);
  await text.fill(`${before.trimEnd()}\n\nPlaceholder line three\n`);
  await win.keyboard.press('Escape');
  await enterKeepsEditing(win, editor, {
    live: '“Placeholder Keep Words” is on the screens now: saving changes them at once.',
  });
  await expect(text).toHaveValue(/Placeholder line three/u);
  expect(await words()).toBe(before);
  // Cancel asks too; Save changes saves and closes.
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await answer(win, 'Save changes');
  await expect(editor).toHaveCount(0);
  await expect.poll(words).toContain('Placeholder line three');

  // Typed again, then thrown away: closed, and nothing saved.
  await grid.getByRole('button', { name: 'Edit words' }).click();
  await expect(text).toHaveValue(/Placeholder line three/u);
  await text.fill('Placeholder thrown away\n');
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('keep-changes')).toBeVisible();
  await answer(win, 'Throw them away');
  await expect(editor).toHaveCount(0);
  expect(await words()).not.toContain('Placeholder thrown away');

  // Nothing typed: Esc closes at once.
  await grid.getByRole('button', { name: 'Edit words' }).click();
  await expect(text).toHaveValue(/Placeholder line three/u);
  await win.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(win.getByTestId('keep-changes')).toHaveCount(0);
  await app.close();
});

test('the Kirtan dialog asks before typed details are lost, Edit words by language too', async () => {
  const { app, win } = await start();
  const id = await presentation(win, 'Placeholder Keep Kirtan', 'Placeholder kirtan line');
  const kavi = () =>
    win.evaluate(
      async (pid) =>
        (await (globalThis as PageGlobals).drashti.library.getPresentation(pid))?.kirtan?.kavi ?? null,
      id,
    );
  await win.getByTestId('kirtan-button').click();
  const dialog = win.getByTestId('kirtan-dialog');
  await dialog.getByTestId('make-kirtan').click();
  const field = dialog.getByTestId('kirtan-kavi');
  await field.fill('Placeholder kavi');
  await win.keyboard.press('Escape');
  // Its details are never on the screens: no warning about them.
  await enterKeepsEditing(win, dialog, { live: null });
  await expect(field).toHaveValue('Placeholder kavi');
  expect(await kavi()).toBeFalsy();
  await win.keyboard.press('Escape');
  await answer(win, 'Save changes');
  await expect(dialog).toHaveCount(0);
  await expect.poll(kavi).toBe('Placeholder kavi');

  // Changed again, then Edit words by language: it asks first; thrown away, the words editor opens.
  await win.getByTestId('kirtan-button').click();
  await field.fill('Placeholder other kavi');
  await dialog.getByRole('button', { name: 'Edit words by language' }).click();
  await expect(win.getByTestId('keep-changes')).toBeVisible();
  await answer(win, 'Throw them away');
  await expect(dialog).toHaveCount(0);
  await expect(win.getByTestId('words-editor')).toBeVisible();
  expect(await kavi()).toBe('Placeholder kavi');
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
  await win.getByRole('tab', { name: 'Media' }).click();
  await win.getByTestId('media-markers').first().click();
  const dialog = win.getByTestId('markers-dialog');
  await dialog.getByTestId('markers-start').fill('0:01.0');
  await win.keyboard.press('Escape');
  await enterKeepsEditing(win, dialog, { live: null });
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

test('the theme form in Themes asks before a typed change is lost', async () => {
  const { app, win } = await start();
  const names = () =>
    win.evaluate(async () =>
      (await (globalThis as PageGlobals).drashti.themes.list()).themes.map((t) => t.name),
    );
  await win.getByRole('button', { name: 'Themes', exact: true }).click();
  const panel = win.getByTestId('themes-panel');
  const name = panel.getByRole('textbox', { name: 'Theme name' });
  await name.fill('Placeholder Keep Theme');
  await win.keyboard.press('Escape');
  await enterKeepsEditing(win, panel, { live: null });
  await expect(win.getByTestId('keep-changes')).toHaveCount(0);
  await expect(name).toHaveValue('Placeholder Keep Theme');
  expect(await names()).not.toContain('Placeholder Keep Theme');
  await win.keyboard.press('Escape');
  await answer(win, 'Save changes');
  await expect(panel).toHaveCount(0);
  await expect.poll(names).toContain('Placeholder Keep Theme');

  await win.getByRole('button', { name: 'Themes', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Theme name' }).fill('Placeholder Thrown Theme');
  await panel.getByRole('button', { name: 'Close themes' }).click();
  await answer(win, 'Throw them away');
  await expect(panel).toHaveCount(0);
  expect(await names()).not.toContain('Placeholder Thrown Theme');
  await app.close();
});

test('the setup wizard asks before typed PINs are lost (nothing is set until Finish)', async () => {
  const { app, win } = await start();
  await chooseMenuItem(app, 'set-up-screens');
  const wizard = win.getByTestId('setup-wizard');
  for (let step = 0; step < 5; step++) await wizard.getByTestId('setup-next').click();
  await wizard.getByRole('radio', { name: 'Set an admin PIN and an operator PIN' }).check();
  await wizard.getByTestId('setup-admin-pin').fill('2468');
  await win.keyboard.press('Escape');
  await enterKeepsEditing(win, wizard, { save: false });
  await expect(wizard.getByTestId('setup-admin-pin')).toHaveValue('2468');
  await wizard.getByRole('button', { name: 'Close the setup' }).click();
  await answer(win, 'Throw them away');
  await expect(wizard).toHaveCount(0);
  // Nothing was set: opened again, it starts afresh, with no PINs typed.
  await chooseMenuItem(app, 'set-up-screens');
  for (let step = 0; step < 5; step++) await wizard.getByTestId('setup-next').click();
  await expect(wizard.getByRole('radio', { name: 'No PINs for now' })).toBeChecked();
  await app.close();
});

test('the macro, stage layout and mask editors ask the same question, and Save changes saves', async () => {
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
  const listed = (what: 'macros' | 'stageLayouts' | 'masks') =>
    win.evaluate(async (kind) => {
      const d = (globalThis as PageGlobals).drashti;
      const list =
        kind === 'macros'
          ? await d.macros.list()
          : kind === 'masks'
            ? await d.masks.list()
            : await d.stageLayouts.list();
      return list.map((x) => x.name);
    }, what);

  // A macro.
  await win.getByTestId('macros-panel').getByRole('button', { name: 'Edit' }).click();
  const macros = win.getByTestId('macro-editor');
  await macros.getByTestId('macro-name').fill('Placeholder keep macro');
  await win.keyboard.press('Escape');
  await enterKeepsEditing(win, macros);
  expect(await listed('macros')).not.toContain('Placeholder keep macro');
  await win.keyboard.press('Escape');
  await answer(win, 'Save changes');
  await expect(macros).toHaveCount(0);
  await expect.poll(() => listed('macros')).toContain('Placeholder keep macro');

  // A stage layout, from the stage group in Screens.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  // Only the stage group has stage layouts; only the hall's has masks.
  await win.getByTestId('edit-stage-layouts').click();
  const layouts = win.getByTestId('stage-layout-editor');
  await layouts.getByTestId('stage-layout-duplicate').click();
  await layouts.getByTestId('stage-layout-name').fill('Placeholder keep layout');
  await win.keyboard.press('Escape');
  await enterKeepsEditing(win, layouts, { live: 'wherever the live Look uses this layout' });
  await win.keyboard.press('Escape');
  await answer(win, 'Save changes');
  await expect(layouts).toHaveCount(0);
  await expect.poll(() => listed('stageLayouts')).toContain('Placeholder keep layout');

  // A mask, from the hall's group.
  await win.getByTestId('edit-masks').click();
  const masks = win.getByTestId('mask-editor');
  await masks.getByTestId('mask-name').fill('Placeholder keep mask');
  await win.keyboard.press('Escape');
  await enterKeepsEditing(win, masks, { live: 'wherever this mask is showing' });
  await win.keyboard.press('Escape');
  await answer(win, 'Throw them away');
  await expect(masks).toHaveCount(0);
  expect(await listed('masks')).not.toContain('Placeholder keep mask');
  await app.close();
});
