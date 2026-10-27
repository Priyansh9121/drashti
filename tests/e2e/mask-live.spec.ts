import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { launchApp, letTimePass, openMoreTools, operatorPage, operatorReady, setUpScreen } from './helpers';

/*
 * Masks drawn over the live screen (Session 44; Priyansh: "masking, i like it, but it should allow me to add
 * live screen which is projector screen, admin can use it for as long as he wants, not 10 minutes. operator also
 * can use it as long as he can"). The mask editor draws the hall screen's picture as it is now under the
 * shapes, live for as long as it is open, for anyone in Pro Mode (Session 54, E5: roles are gone); with no hall
 * screen set up, a test pattern, and it says so. Placeholder words only.
 */

const dispatch = (win: Page, command: object) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

async function openEditor(win: Page) {
  await win.getByTestId('masks-panel').getByRole('button', { name: 'Edit' }).click();
  const editor = win.getByTestId('mask-editor');
  await expect(editor).toBeVisible();
  return editor;
}

/** Close the editor; a new mask it began (or a shape drawn) is thrown away when it asks. */
async function closeEditor(win: Page) {
  await win.getByTestId('mask-editor').getByRole('button', { name: 'Close masks' }).click();
  const ask = win.getByTestId('keep-changes');
  const editor = win.getByTestId('mask-editor');
  await expect.poll(async () => (await ask.isVisible()) || (await editor.count()) === 0).toBe(true);
  if (await ask.isVisible()) await ask.getByRole('button', { name: 'Throw them away' }).click();
  await expect(editor).toHaveCount(0);
}

test('the mask editor draws the hall’s live picture under the shapes for as long as it is open; with no hall screen, a test pattern, and says so', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 800 });
  const id = await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.library.newFromWords(
      'Placeholder mask words',
      'Placeholder first line\n\nPlaceholder second line\n\nPlaceholder third line\n',
    );
    if (!made.ok) throw new Error(made.message);
    return made.id;
  });
  await openMoreTools(win);

  // No hall screen: the test pattern stands in, and the editor says so.
  let editor = await openEditor(win);
  await expect(editor.getByTestId('mask-pattern')).toBeVisible();
  await expect(editor.getByTestId('mask-live')).toHaveCount(0);
  await expect(editor.getByTestId('mask-under')).toContainText('No hall screen is set up yet');
  await closeEditor(win);

  // A hall screen showing a slide: under the shapes, its picture as it is now, and as it changes.
  await setUpScreen(win, 'Main Hall', 0);
  await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
  editor = await openEditor(win);
  const live = editor.getByTestId('mask-live');
  await expect(live.locator('[data-layer="slide"]')).toContainText('Placeholder first line');
  await expect(editor.getByTestId('mask-under')).toContainText('shows now, live');
  await expectNoSeriousA11yIssues(
    win,
    'the mask editor over the live picture',
    '[data-testid="mask-editor"]',
  );
  await dispatch(win, { type: 'next' });
  await expect(live.locator('[data-layer="slide"]')).toContainText('Placeholder second line');
  // A shape drawn over it darkens what it hides; the live picture stays under it.
  await editor.getByTestId('mask-add-shape').click();
  await expect(editor.getByTestId('mask-preview')).toHaveCSS('mask-image', /^url\(/u);
  await expect(live.locator('[data-layer="slide"]')).toContainText('Placeholder second line');
  await closeEditor(win);

  // Opened again, it is live again, and with no time limit it stays so.
  await openEditor(win);
  await expect(live.locator('[data-layer="slide"]')).toContainText('Placeholder second line');
  await letTimePass(win, 3000, 'the editor stays open a while; nothing about it runs out');
  await dispatch(win, { type: 'next' });
  await expect(live.locator('[data-layer="slide"]')).toContainText('Placeholder third line');
  await app.close();
});
