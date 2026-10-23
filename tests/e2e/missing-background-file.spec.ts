import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineCommand } from '../../src/shared/engine/commands';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { expectNoSeriousA11yIssues, settled } from './a11y';
import {
  closeLibrary,
  importAndGetIds,
  killApp,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPage,
  type PageGlobals,
  relaunchApp,
  savedLive,
  setUpScreen,
} from './helpers';
import { makeTestImage } from './test-media';

/*
 * A slide's background cue whose file is missing (Session 52): a presentation imported with its background picture
 * not found (on another computer's drive), as a library brought from another computer often is. It goes as a video
 * input this computer has none of does (Session 51): the background stays as it was, never black, and LIVE says
 * why; its thumbnail, the slide editor and Simple Mode's picture of what is next say so too; it says so again after
 * an unexpected restart; and once the file is found (Find missing media…) the slide puts it up. Placeholder names, a
 * generated picture.
 */

const ENV = { DRASHTI_WINDOWED_OUTPUTS: '1' };
const FILE = 'Placeholder backdrop.png';
const COLOUR = { kind: 'color', color: '#203040' } as const;
const LINE = `File missing: “${FILE}”. The background stays as it was.`;

const line = (text: string) => ({ text: [{ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) }] });

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

function dispatch(win: Page, command: EngineCommand) {
  return win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
}

/** The hall's screen shows the colour as its background (no picture there, never black). */
async function showsColour(app: ElectronApplication): Promise<void> {
  const hall = await outputPage(app);
  await expect(hall.locator('[data-layer="slide"]')).toContainText('Placeholder over the missing file');
  await expect(hall.locator('[data-layer="background"]')).toHaveCount(1);
  await expect(hall.locator('[data-layer="background"]')).toHaveCSS('background-color', 'rgb(32, 48, 64)');
}

test('a missing file behind a slide: the background stays as it was, never black, and LIVE, the thumbnail, the editor and Simple Mode’s Next say why; again after a restart, and it goes up once found', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-missing-file-'));
  const show = join(dir, 'Placeholder Missing Backdrop.pro6');
  writeFileSync(
    show,
    pp6Presentation({
      uuid: 'E2E-MISSING-FILE',
      groups: [
        {
          name: 'Verse',
          slides: [
            line('Placeholder before'),
            {
              // Another computer's drive: not found here, nor beside the presentation.
              background: { path: `/Volumes/Placeholder drive/${FILE}`, kind: 'image' },
              ...line('Placeholder over the missing file'),
            },
            line('Placeholder after'),
          ],
        },
      ],
    }),
  );
  const first = await launchApp(ENV);
  const win = await operatorPage(first.app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  await outputPage(first.app);
  const [presentationId = ''] = await importAndGetIds(win, [show]);
  const cue = await win.evaluate(
    async (id) =>
      (await (globalThis as PageGlobals).drashti.library.getPresentation(id))?.groups[0]?.slides[1]?.cues[0],
    presentationId,
  );
  expect(cue).toMatchObject({ kind: 'background', name: FILE, missing: true });
  await dispatch(win, { type: 'setBackground', background: COLOUR });

  // Its thumbnail marks the file as the library does.
  await (await openLibrary(win)).getByTestId('library-tab-presentations').click();
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Missing Backdrop/ })
    .click();
  await closeLibrary(win);
  const thumbs = win.getByTestId('slide-thumb');
  await expect(thumbs.nth(1).getByTestId('thumb-missing')).toHaveText('Missing');
  await expect(thumbs.nth(0).getByTestId('thumb-missing')).toHaveCount(0);

  // Up: the background stays the colour on the screens, and LIVE says why.
  await thumbs.nth(0).click();
  await expect.poll(async () => (await state(win)).live.slideIndex).toBe(0);
  await thumbs.nth(1).click();
  await expect.poll(async () => (await state(win)).live.slideIndex).toBe(1);
  expect((await state(win)).layers.background).toEqual(COLOUR);
  expect((await state(win)).layers.slide).toMatchObject({ slideIndex: 1, fileMissing: FILE });
  await expect(win.getByTestId('live-file-missing')).toHaveText(LINE);
  await showsColour(first.app);
  await settled(win);
  await expectNoSeriousA11yIssues(win, 'LIVE saying a slide’s background file is missing');

  // Next goes on to a slide naming none: LIVE says nothing more. Back brings it back, saying so again.
  await dispatch(win, { type: 'next' });
  await expect.poll(async () => (await state(win)).live.slideIndex).toBe(2);
  await expect(win.getByTestId('live-file-missing')).toHaveCount(0);
  await dispatch(win, { type: 'back' });
  await expect.poll(async () => (await state(win)).live.slideIndex).toBe(1);
  await expect(win.getByTestId('live-file-missing')).toHaveText(LINE);

  // The slide editor says so (a double-click on the live thumbnail opens it there); with nothing changed, Esc closes.
  await thumbs.nth(1).dblclick();
  const editor = win.getByTestId('slide-editor');
  await expect(editor.getByTestId('background-file-missing')).toHaveText(
    `The file “${FILE}” is missing: the background stays as it was when this slide goes up.`,
  );
  await win.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);

  // Simple Mode: its picture of what is next says so before it goes up, and its LIVE says why, as Pro Mode's does.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('live-file-missing')).toHaveText(LINE);
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
  await expect(win.getByTestId('live-file-missing')).toHaveCount(0);
  await expect(win.getByTestId('next-caption')).toHaveText(
    `Placeholder Missing Backdrop, slide 2, over the file “${FILE}”, which is missing: the background stays as it is`,
  );
  await win.getByTestId('simple-buttons').getByRole('button', { name: /^Next/u }).click();
  await expect.poll(async () => (await state(win)).live.slideIndex).toBe(1);
  await expect(win.getByTestId('live-file-missing')).toHaveText(LINE);
  expect((await state(win)).layers.background).toEqual(COLOUR);
  const pro = await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'));
  expect(pro.ok).toBe(true);
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);

  // Stopped dead with it up: the next start puts it back, the background as it was, and LIVE says why again.
  await savedLive(
    first.userData,
    (saved) => saved.slide?.slideIndex === 1 && saved.background?.kind === 'color',
  );
  await killApp(first.app);
  const second = await relaunchApp(first.userData, ENV);
  const win2 = await operatorPage(second.app);
  await operatorReady(win2);
  await expect.poll(async () => (await state(win2)).layers.slide?.slideIndex).toBe(1);
  expect((await state(win2)).layers.slide).toMatchObject({ fileMissing: FILE });
  expect((await state(win2)).layers.background).toEqual(COLOUR);
  await expect(win2.getByTestId('live-file-missing')).toHaveText(LINE);
  await showsColour(second.app);

  // Found again (Find missing media…, the folder answered here by the test): the slide shown again puts it up.
  const found = mkdtempSync(join(tmpdir(), 'drashti-found-'));
  await makeTestImage(win2, join(found, FILE), { color: '#1e3a8a' });
  await second.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, found);
  const relinked = await win2.evaluate(() => (globalThis as PageGlobals).drashti.library.relinkMedia());
  expect(relinked.ok).toBe(true);
  await dispatch(win2, { type: 'goLive', presentationId, slideIndex: 1 });
  await expect
    .poll(async () => (await state(win2)).layers.background)
    .toMatchObject({ kind: 'media', media: 'image' });
  expect((await state(win2)).layers.slide).not.toHaveProperty('fileMissing');
  await expect(win2.getByTestId('live-file-missing')).toHaveCount(0);
  await second.app.close();
});
