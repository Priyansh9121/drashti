import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage } from './helpers';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

/*
 * The screenshots in docs/screenshots/, with placeholder content only. Taken
 * by hand, not in CI (the pictures depend on the computer's fonts and
 * displays):
 *
 *   DRASHTI_SCREENSHOTS=1 pnpm exec playwright test tests/e2e/screenshots.spec.ts
 *
 * (after pnpm build). They are kept at CSS pixel size.
 */

test.skip(!process.env['DRASHTI_SCREENSHOTS'], 'set DRASHTI_SCREENSHOTS=1 to take the screenshots');

const folder = join(__dirname, '..', '..', 'docs', 'screenshots');

async function shot(page: Page, name: string) {
  mkdirSync(folder, { recursive: true });
  // Let thumbnails and still frames settle.
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(folder, `${name}.png`), scale: 'css' });
}

/** The placeholder sabha running: the kirtan's verse live, a message on the screens and a timer going. */
async function running(win: Page) {
  const show = await setUpPlaceholderShow(win);
  await win.evaluate(async (logoId) => {
    const d = (globalThis as PageGlobals).drashti;
    await d.props.setLogo(logoId);
  }, show.logoPropId);
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await win.getByTestId('playlist-item').filter({ hasText: KIRTAN }).click();
  await win.getByTestId('slide-thumb').nth(1).click();
  await win.getByTestId('timers').getByRole('button', { name: 'Start' }).click();
  await win.getByTestId('messages').getByRole('textbox', { name: 'plate' }).fill('12');
  await win.getByTestId('messages').getByRole('button', { name: 'Show' }).click();
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 5');
  return show;
}

test('the operator window and its panels', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1920, height: 1080 });
  await running(win);
  await shot(win, 'operator-1920x1080');

  await win.setViewportSize({ width: 1280, height: 720 });
  await shot(win, 'operator-1280x720');

  await win.setViewportSize({ width: 1600, height: 900 });
  await win.getByRole('button', { name: 'Edit words' }).click();
  await expect(win.getByTestId('words-text')).not.toHaveValue('Loading…');
  await shot(win, 'edit-words');
  await win.getByTestId('words-editor').getByRole('button', { name: 'Cancel' }).click();

  await win.getByRole('button', { name: 'Themes', exact: true }).click();
  await expect(win.getByTestId('theme-editor')).toBeVisible();
  await shot(win, 'themes');
  await win.getByRole('button', { name: 'Close themes' }).click();

  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await expect(win.getByTestId('sound-output')).toBeVisible();
  await shot(win, 'screens');
  await win.getByRole('button', { name: 'Close screens' }).click();
  await app.close();
});

/** Click a point on the slide in the slide editor (slide pixels). */
async function clickSlide(win: Page, x: number, y: number) {
  const canvas = win.getByTestId('editor-canvas');
  const box = await canvas.boundingBox();
  const scale = Number(await canvas.getAttribute('data-scale'));
  if (box) await win.mouse.click(box.x + x * scale, box.y + y * scale);
}

test('the slide editor', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  await running(win);
  await win.getByTestId('edit-slides').click();
  const editor = win.getByTestId('slide-editor');
  await expect(editor.getByTestId('editor-canvas')).toBeVisible();
  // A band behind the words, to show a shape.
  await editor.getByTestId('add-shape').click();
  await win.getByRole('menuitem', { name: 'Rounded rectangle' }).click();
  await editor.getByTestId('field-y').fill('380');
  await editor.getByTestId('field-height').fill('320');
  await editor.getByTestId('field-width').fill('1400');
  await editor.getByTestId('field-x').fill('260');
  await editor.getByTestId('field-opacity').fill('60');
  await editor.getByRole('button', { name: 'Send to the back' }).click();
  // The words selected: their handles, and the inspector's words section.
  await clickSlide(win, 960, 420);
  await expect(editor.getByTestId('inspector-text')).toBeVisible();
  await shot(win, 'slide-editor');
  await win.keyboard.press('Escape');
  await expect(editor.getByTestId('slide-panel')).toBeVisible();
  await shot(win, 'slide-editor-slide');
  await win.setViewportSize({ width: 1280, height: 720 });
  await clickSlide(win, 960, 420);
  await shot(win, 'slide-editor-1280x720');
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await win.getByTestId('discard-confirm').getByRole('button', { name: 'Throw them away' }).click();
  await app.close();
});

test('Simple Mode', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await setUpPlaceholderShow(win);
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('PageDown');
  await win.keyboard.press('PageDown');
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 5');
  await shot(win, 'simple-mode-1280x720');
  await win.keyboard.press('F1');
  await expect(win.getByTestId('simple-put-back')).toBeVisible();
  await shot(win, 'simple-mode-put-it-back');
  await app.close();
});

test('the component gallery', async () => {
  const { app } = await launchApp({ DRASHTI_DIAGNOSTICS: '1' });
  await expect((await operatorPage(app)).getByTestId('live-status')).toBeVisible();
  const opened = app.waitForEvent('window', { predicate: (w) => w.url().includes('gallery.html') });
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('component-gallery')?.click();
  });
  const gallery = await opened;
  await gallery.setViewportSize({ width: 1440, height: 900 });
  await gallery.locator('#buttons').scrollIntoViewIfNeeded();
  await shot(gallery, 'component-gallery');
  await app.close();
});
