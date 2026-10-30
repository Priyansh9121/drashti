import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  editorGroup,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  outputPage,
  setUpScreen,
  sizeSlideEditor,
  slideEditorClosed,
  slideEditorWindow,
} from './helpers';
import { makeTestImage } from './test-media';

/*
 * The slide editor (Session 7): editing words in place, shapes and
 * pictures, moving from the keyboard and by dragging (with snapping),
 * Undo and Redo, saving to the screens, Cancel, legacy-font text, typing
 * through an input method, and accessibility. Placeholder words and
 * generated pictures only. Since Session 55 (Part 17a) the editor is a window of its own, its tools in groups along
 * its top (Words, Insert, Arrange, Design, Motion, Slides).
 */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** A point on the slide (slide pixels) as a point in the editor's window. */
async function onCanvas(ed: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = ed.getByTestId('editor-canvas');
  const box = await canvas.boundingBox();
  const scale = Number(await canvas.getAttribute('data-scale'));
  if (!box) throw new Error('no canvas');
  return { x: box.x + x * scale, y: box.y + y * scale };
}

async function clickSlide(ed: Page, x: number, y: number): Promise<void> {
  const p = await onCanvas(ed, x, y);
  await ed.mouse.click(p.x, p.y);
}

/** Drag on the slide from one point to another (slide pixels), in small steps, optionally holding Alt. */
async function dragSlide(ed: Page, from: [number, number], to: [number, number], alt = false): Promise<void> {
  const a = await onCanvas(ed, ...from);
  const b = await onCanvas(ed, ...to);
  await ed.mouse.move(a.x, a.y);
  if (alt) await ed.keyboard.down('Alt');
  await ed.mouse.down();
  for (let i = 1; i <= 8; i++) await ed.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  await ed.mouse.up();
  if (alt) await ed.keyboard.up('Alt');
}

const fieldValue = async (ed: Page, id: string) => Number(await ed.getByTestId(id).inputValue());

/** Import a placeholder kirtan (and anything else) and return the kirtan's id. */
async function importKirtan(win: Page, name: string, words: string, more: string[] = []): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-editor-'));
  const file = join(dir, `${name}.txt`);
  writeFileSync(file, words);
  const [id = ''] = await importAndGetIds(win, [file, ...more]);
  return id;
}

/** The presentation chosen in the library, and Edit slides: the editor's window (Session 55, Part 17a), and the editor. */
async function openEditor(
  app: ElectronApplication,
  win: Page,
  name: string | RegExp,
): Promise<{ ed: Page; editor: Locator }> {
  // By its row (the row's trash button is named after it too: “Delete …”, Session 26a).
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByTestId('presentation-row')
    .filter({ hasText: name })
    .click();
  await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toBeVisible();
  await win.getByTestId('edit-slides').click();
  const opened = await slideEditorWindow(app);
  await sizeSlideEditor(app, opened.ed, { width: 1600, height: 900 });
  return opened;
}

/**
 * Select the words between two offsets of the first piece of text being typed in (as a mouse drag
 * would). The editor reads a selection when the page says it changed; the page's own word for that
 * came too late on a macOS CI runner, so it is said here at once, as the browser would.
 */
async function selectTyped(ed: Page, start: number, end: number): Promise<void> {
  await ed.evaluate(
    ({ start, end }) => {
      const root = document.querySelector('[data-testid="text-editing"]');
      const walker = root ? document.createTreeWalker(root, NodeFilter.SHOW_TEXT) : null;
      const text = walker?.nextNode();
      if (!text) throw new Error('nothing typed');
      document.getSelection()?.setBaseAndExtent(text, start, text, end);
      document.dispatchEvent(new Event('selectionchange'));
    },
    { start, end },
  );
}

test('edit a slide: a Gujarati word in its own font and size, a shape and a picture, moved and snapped, undone, saved to the screens', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  await setUpScreen(win);
  const output = await outputPage(app);
  const picture = await makeTestImage(
    win,
    join(mkdtempSync(join(tmpdir(), 'drashti-pic-')), 'Placeholder editor picture.png'),
    {
      width: 320,
      height: 180,
      color: '#1d4e89',
    },
  );
  await importKirtan(win, 'Placeholder Editor Kirtan', '[Verse]\nનમૂના પંક્તિ\nNamūnā pankti\n', [picture]);
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Editor Kirtan/ })
    .click();
  await win.getByTestId('slide-thumb').first().click();
  const slideLayer = output.locator('[data-layer="slide"]');
  await expect(slideLayer).toContainText('નમૂના પંક્તિ');

  const { ed, editor } = await openEditor(app, win, /Placeholder Editor Kirtan/);
  const status = editor.getByTestId('editor-status');

  // The words: select the box, type in it, give the first Gujarati word one of Drashti's fonts and its own size
  // (Session 55, Part 17a: the Words group along the top; its fonts are the bundled ones).
  await clickSlide(ed, 960, 540);
  await expect(status).toContainText('Text box');
  await ed.keyboard.press('Enter');
  const typing = editor.getByTestId('text-editing');
  await expect(typing).toBeFocused();
  await selectTyped(ed, 0, 5);
  await expect(editor.getByTestId('text-target')).toHaveText('Styling the selected words.');
  await editor.getByTestId('field-font').selectOption('Noto Serif');
  await editor.getByTestId('field-size').fill('120');
  await ed.keyboard.press('Escape');
  await expect(typing).toHaveCount(0);
  const word = editor.getByTestId('editor-slide').locator('[data-run][data-lang="gu"]').first();
  await expect(word).toHaveText('નમૂના');
  await expect.poll(() => word.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Noto Serif"?/u);
  expect(await word.evaluate((el) => getComputedStyle(el).fontSize)).toBe('120px');

  // A shape: an ellipse in the middle, moved from the keyboard.
  await editorGroup(ed, 'Insert');
  await editor.getByTestId('add-shape').click();
  await ed.getByRole('menuitem', { name: 'Ellipse' }).click();
  await expect(status).toContainText('Ellipse selected');
  await clickSlide(ed, 960, 540);
  const x0 = await fieldValue(ed, 'field-x');
  const y0 = await fieldValue(ed, 'field-y');
  await ed.keyboard.press('ArrowRight');
  await ed.keyboard.press('ArrowRight');
  await ed.keyboard.press('ArrowRight');
  await ed.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => fieldValue(ed, 'field-x')).toBe(x0 + 3);
  expect(await fieldValue(ed, 'field-y')).toBe(y0 + 10);

  // A picture from the library, at its own proportions in the middle of the slide.
  await editor.getByTestId('add-media').click();
  await ed.getByTestId('media-picker').getByTestId('media-choice').first().click();
  await expect(status).toContainText('Picture selected');
  await expect.poll(() => fieldValue(ed, 'field-width')).toBe(960);
  expect(await fieldValue(ed, 'field-height')).toBe(540);
  expect(await fieldValue(ed, 'field-x')).toBe(480);

  // Move it off the middle from the keyboard (ten times ten), then drag it back to 10 px short of
  // the middle: it snaps there, with a guide; holding Alt it goes exactly where it is dragged.
  await clickSlide(ed, 700, 400);
  for (let i = 0; i < 10; i++) await ed.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => fieldValue(ed, 'field-x')).toBe(580);
  const a = await onCanvas(ed, 1060, 540);
  const b = await onCanvas(ed, 950, 540);
  await ed.mouse.move(a.x, a.y);
  await ed.mouse.down();
  for (let i = 1; i <= 8; i++) await ed.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y);
  await expect(editor.getByTestId('guide').first()).toBeVisible();
  await ed.mouse.up();
  await expect(editor.getByTestId('guide')).toHaveCount(0);
  await expect.poll(() => fieldValue(ed, 'field-x')).toBe(480);
  await dragSlide(ed, [960, 540], [863, 540], true);
  const free = await fieldValue(ed, 'field-x');
  expect(Math.abs(free - 383)).toBeLessThanOrEqual(3);

  // Undo and Redo: the free drag, then the snapped one.
  await ed.keyboard.press(`${mod}+Z`);
  await expect.poll(() => fieldValue(ed, 'field-x')).toBe(480);
  await ed.keyboard.press(`${mod}+Z`);
  await expect.poll(() => fieldValue(ed, 'field-x')).toBe(580);
  await ed.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
  await expect.poll(() => fieldValue(ed, 'field-x')).toBe(480);

  // Save: the live slide on the screens shows it all at once, and the editor's window closes.
  await editor.getByTestId('save-slides').click();
  await slideEditorClosed(app);
  const outWord = slideLayer.locator('[data-run][data-lang="gu"]').first();
  await expect(outWord).toHaveText('નમૂના');
  await expect.poll(() => outWord.evaluate((el) => getComputedStyle(el).fontSize)).toBe('120px');
  await expect(slideLayer.locator('svg[data-shape="ellipse"]')).toHaveCount(1);
  await expect(slideLayer.locator('img[data-media-id]')).toHaveCount(1);

  // One change for the operator's Undo: it all comes off again.
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/ }).click();
  await expect(slideLayer.locator('svg[data-shape="ellipse"]')).toHaveCount(0);
  await expect(slideLayer.locator('img[data-media-id]')).toHaveCount(0);
  await expect(slideLayer).toContainText('નમૂના પંક્તિ');
  await app.close();
});

test('words past their box and words too small for the hall are marked and said (Sessions 31–36, SLD-1)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  const long = Array.from({ length: 30 }, (_, i) => `Placeholder word ${String(i + 1)}`).join(' ');
  const white: [number, number, number] = [255, 255, 255];
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-overset-')), 'Placeholder Overset.pro6');
  writeFileSync(
    file,
    pp6Presentation({
      uuid: 'E2E-OVERSET',
      groups: [
        {
          name: 'Verse',
          uuid: 'E2E-OVERSET-G',
          slides: [
            // Too many words for the box.
            { text: [{ rtf: cocoaRtf([[long, 80, white]]), rect: [160, 100, 1600, 200] }] },
            // Words set at 30 px: below the 36 px floor.
            {
              text: [
                { rtf: cocoaRtf([['Placeholder small words', 30, white]]), rect: [160, 400, 1600, 200] },
              ],
            },
            // Nothing to say.
            {
              text: [{ rtf: cocoaRtf([['Placeholder fine words', 72, white]]), rect: [160, 400, 1600, 200] }],
            },
          ],
        },
      ],
    }),
  );
  await importAndGetIds(win, [file]);
  const { ed, editor } = await openEditor(app, win, /Placeholder Overset/);
  // The slide list marks the slide whose words run over, and says so with its name.
  const thumbs = editor.getByTestId('editor-slide-thumb');
  await expect(thumbs.nth(0).getByTestId('thumb-overset')).toBeVisible();
  await expect(thumbs.nth(0)).toHaveAttribute('aria-label', /words run past a box$/u);
  await expect(thumbs.nth(1).getByTestId('thumb-overset')).toHaveCount(0);
  // Its box, selected: the inspector says what to do.
  await clickSlide(ed, 960, 200);
  await expect(editor.getByTestId('inspector-overset')).toContainText('Words run past the box');
  // The 30 px words: a warning, below 36 px.
  await thumbs.nth(1).click();
  await clickSlide(ed, 960, 500);
  const floor = editor.getByTestId('inspector-floor');
  await expect(floor).toHaveAttribute('data-level', 'warning');
  await expect(floor).toContainText('drawn at 30 px on a 1080-line screen');
  await expect(editor.getByTestId('inspector-overset')).toHaveCount(0);
  await expectNoSeriousA11yIssues(ed, 'the slide editor saying words are too small');
  // The 72 px words: nothing to say.
  await thumbs.nth(2).click();
  await clickSlide(ed, 960, 500);
  await expect(editor.getByTestId('inspector-text')).toBeVisible();
  await expect(floor).toHaveCount(0);
  await expect(editor.getByTestId('inspector-overset')).toHaveCount(0);
  // The operator's slide grid marks the same slide.
  await ed.keyboard.press('Escape');
  await ed.keyboard.press('Escape');
  await slideEditorClosed(app);
  const grid = win.getByTestId('slide-thumb');
  await expect(grid.nth(0).getByTestId('thumb-overset')).toBeVisible();
  await expect(grid.nth(1).getByTestId('thumb-overset')).toHaveCount(0);
  await app.close();
});

test('View › Show Safe Areas draws 93% and 90%, the ticker’s band at 999 of 1080, a message’s band and where a group cuts the slide; words in the ticker’s band are warned of (Sessions 31–36, SLD-2)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  // The hall's group, whose Look shows the ticker (every Look does to begin with).
  const screenId = await setUpScreen(win);
  const white: [number, number, number] = [255, 255, 255];
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-safe-')), 'Placeholder Safe Areas.pro6');
  writeFileSync(
    file,
    pp6Presentation({
      uuid: 'E2E-SAFE',
      groups: [
        {
          name: 'Verse',
          uuid: 'E2E-SAFE-G',
          slides: [
            {
              text: [
                { rtf: cocoaRtf([['Placeholder title', 72, white]]), rect: [160, 200, 1600, 200] },
                // Words along the very bottom: where the ticker runs.
                { rtf: cocoaRtf([['Placeholder footer', 48, white]]), rect: [160, 990, 1600, 80] },
              ],
            },
          ],
        },
      ],
    }),
  );
  await importAndGetIds(win, [file]);
  const { ed, editor } = await openEditor(app, win, /Placeholder Safe Areas/);
  const areas = editor.getByTestId('safe-areas');
  await expect(areas).toHaveCount(0);
  await chooseMenuItem(app, 'show-safe-areas');
  await expect(areas).toBeVisible();
  const box = async (id: string) =>
    editor.getByTestId(id).evaluate((el: HTMLElement) => ({
      left: Math.round(parseFloat(el.style.left)),
      top: Math.round(parseFloat(el.style.top)),
      width: Math.round(parseFloat(el.style.width)),
      height: Math.round(parseFloat(el.style.height)),
    }));
  // Action-safe and title-safe, in slide pixels: 93% and 90% of 1920 × 1080, centred.
  expect(await box('safe-action')).toEqual({ left: 67, top: 38, width: 1786, height: 1004 });
  expect(await box('safe-title')).toEqual({ left: 96, top: 54, width: 1728, height: 972 });
  await expect(editor.getByTestId('guide-ticker')).toHaveAttribute('data-y', '999');
  await expect(editor.getByTestId('guide-message')).toBeVisible();
  // Nothing cuts a 16:9 slide on the 16:9 group: no crop lines. Made 4:3 and Fill, it loses its sides.
  await expect(editor.getByTestId('guide-crop')).toHaveCount(0);
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.screens.updateScreen(id, {
        canvasWidth: 1024,
        canvasHeight: 768,
        scaling: 'fill',
      }),
    screenId,
  );
  const crops = editor.getByTestId('guide-crop');
  await expect(crops).toHaveCount(2);
  expect(await crops.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset['x']))).toEqual([
    '240',
    '1680',
  ]);
  await expect(crops.first()).toHaveAttribute('data-group', 'Main Hall');
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.screens.updateScreen(id, {
        canvasWidth: 1920,
        canvasHeight: 1080,
        scaling: 'fit',
      }),
    screenId,
  );
  await expect(crops).toHaveCount(0);
  // The footer's words sit in the ticker's band on the hall's group: the inspector says so; the title's do not.
  await clickSlide(ed, 960, 1030);
  await expect(editor.getByTestId('inspector-ticker')).toContainText(
    'Words sit where the ticker runs on “Main Hall”',
  );
  await expectNoSeriousA11yIssues(ed, 'the slide editor with its safe areas');
  await clickSlide(ed, 960, 300);
  await expect(editor.getByTestId('inspector-text')).toBeVisible();
  await expect(editor.getByTestId('inspector-ticker')).toHaveCount(0);
  // Off again from the menu.
  await chooseMenuItem(app, 'show-safe-areas');
  await expect(areas).toHaveCount(0);
  await app.close();
});

test('new words get 1.35 between lines; a Gujarati box set closer than 1.3 is warned of, and has no Italic (Sessions 31–36, I18N-2)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  await importKirtan(
    win,
    'Placeholder Spacing',
    '[Verse]\nનમૂનાની પંક્તિ\nબીજી નમૂના પંક્તિ\n\n[Chorus]\nPlaceholder line\nPlaceholder second line\n',
  );
  const { ed, editor } = await openEditor(app, win, /Placeholder Spacing/);
  const spacing = editor.getByTestId('field-line-height');
  const warning = editor.getByTestId('inspector-line-height');
  const italic = editor.getByRole('button', { name: 'Italic', exact: true });
  // The Gujarati slide's words: 1.35 apart, nothing to say, and no Italic (they are always drawn upright: since
  // Session 55, Part 17a, the Words group's Italic is there but cannot be pressed for them).
  await clickSlide(ed, 960, 540);
  await expect(editor.getByTestId('inspector-text')).toBeVisible();
  await expect(spacing).toHaveValue('1.35');
  await expect(warning).toHaveCount(0);
  await expect(italic).toBeDisabled();
  // Set at 1.2: warned of, until it is 1.3 again.
  await spacing.fill('1.2');
  await expect(warning).toHaveText(
    'The line spacing is 1.2: below 1.3, Gujarati and Hindi marks can touch the line above. Line spacing is under Words.',
  );
  await expectNoSeriousA11yIssues(ed, 'the slide editor warning of close Gujarati lines');
  await spacing.fill('1.3');
  await expect(warning).toHaveCount(0);
  // English words at 1.2: nothing to say, and Italic is there to press.
  await ed.keyboard.press('Escape');
  await editor.getByTestId('editor-slide-thumb').nth(1).click();
  await clickSlide(ed, 960, 540);
  await expect(editor.getByTestId('inspector-text')).toBeVisible();
  await spacing.fill('1.2');
  await expect(italic).toBeEnabled();
  await expect(warning).toHaveCount(0);
  await app.close();
});

test('Cancel keeps nothing: Esc lets go of the selection, then asks before throwing changes away', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  const { ed, editor } = await openEditor(app, win, /Language test slides/);
  const elements = editor.getByTestId('editor-slide').locator('[data-element]');
  const count = await elements.count();
  expect(count).toBeGreaterThan(0);
  await clickSlide(ed, 960, 450);
  await expect(editor.getByTestId('selection')).toHaveCount(1);
  await ed.keyboard.press('Delete');
  await expect(elements).toHaveCount(count - 1);
  // Nothing is selected now: Esc would close, so it asks first, with Save changes focused (Session
  // 26g; the one question every editor asks, Session 25): Esc keeps editing, and nothing is saved.
  await ed.keyboard.press('Escape');
  const confirm = ed.getByTestId('keep-changes');
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Save changes' })).toBeFocused();
  await expect(confirm.getByRole('button', { name: 'Keep editing' })).toBeVisible();
  await ed.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(elements).toHaveCount(count - 1);
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await ed.getByTestId('keep-changes').getByRole('button', { name: 'Throw them away' }).click();
  await slideEditorClosed(app);
  // Opened again: everything is still there.
  await win.getByTestId('edit-slides').click();
  const again = await slideEditorWindow(app);
  await expect(again.editor.getByTestId('editor-slide').locator('[data-element]')).toHaveCount(count);
  // With no changes, Esc closes at once.
  await again.ed.keyboard.press('Escape');
  await slideEditorClosed(app);
  await app.close();
});

test('words typed in a legacy font can be moved and resized, but not edited', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-legacy-'));
  const file = join(dir, 'Placeholder Legacy.pro6');
  writeFileSync(
    file,
    pp6Presentation({
      uuid: 'LEGACY-EDIT',
      groups: [
        {
          name: 'Verse',
          slides: [
            {
              text: [
                {
                  rtf: cocoaRtf([['nmUnO pHelI', 80, [255, 255, 255]]], 'qc', 'Gopika'),
                  rect: [100, 100, 1720, 880],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  const [id = ''] = await importAndGetIds(win, [file]);
  const { ed, editor } = await openEditor(app, win, /Placeholder Legacy/);
  await clickSlide(ed, 960, 540);
  await expect(editor.getByTestId('legacy-note')).toContainText('Gopika');
  await ed.keyboard.press('Enter');
  await expect(editor.getByTestId('editor-note')).toContainText('legacy font (Gopika)');
  await expect(editor.getByTestId('text-editing')).toHaveCount(0);
  await ed.getByTestId('editor-canvas').dblclick();
  await expect(editor.getByTestId('text-editing')).toHaveCount(0);
  // It moves, and keeps its words exactly.
  await ed.getByTestId('editor-canvas').focus();
  await ed.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => fieldValue(ed, 'field-x')).toBe(90);
  await editor.getByTestId('save-slides').click();
  await slideEditorClosed(app);
  const el = await win.evaluate(async (pid) => {
    const doc = await (globalThis as PageGlobals).drashti.library.getPresentation(pid);
    return doc?.groups[0]?.slides[0]?.slide.elements[0] ?? null;
  }, id);
  expect(el).toMatchObject({
    kind: 'text',
    frame: { x: 90, y: 100 },
    runs: [{ text: 'nmUnO pHelI', font: 'Gopika', legacy: true }],
  });
  await app.close();
});

test('words typed through a Gujarati or Hindi input method go in as composed', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  const { ed, editor } = await openEditor(app, win, /Language test slides/);
  await editorGroup(ed, 'Insert');
  await editor.getByTestId('add-text').click();
  const typing = editor.getByTestId('text-editing');
  await expect(typing).toBeFocused();
  // Count the composition events the box sees, to be sure the input method's path was used.
  await ed.evaluate(() => {
    const root = document.querySelector('[data-testid="text-editing"]');
    const seen: string[] = [];
    (globalThis as typeof globalThis & { compositions?: string[] }).compositions = seen;
    root?.addEventListener('compositionstart', () => seen.push('start'));
    root?.addEventListener('compositionend', (e) => seen.push(`end:${(e as CompositionEvent).data}`));
  });
  const cdp = await ed.context().newCDPSession(ed);
  // Gujarati: the input method shows what is being composed, then commits the word.
  await cdp.send('Input.imeSetComposition', { text: 'ગુ', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.imeSetComposition', { text: 'ગુજરા', selectionStart: 5, selectionEnd: 5 });
  await cdp.send('Input.insertText', { text: 'ગુજરાતી' });
  await ed.keyboard.press('Enter');
  // Hindi, the same way.
  await cdp.send('Input.imeSetComposition', { text: 'हि', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.imeSetComposition', { text: 'हिन्द', selectionStart: 5, selectionEnd: 5 });
  await cdp.send('Input.insertText', { text: 'हिन्दी' });
  await expect(typing).toHaveText('ગુજરાતીहिन्दी');
  const seen = await ed.evaluate(
    () => (globalThis as typeof globalThis & { compositions?: string[] }).compositions,
  );
  expect(seen).toEqual(['start', 'end:ગુજરાતી', 'start', 'end:हिन्दी']);
  await ed.keyboard.press('Escape');
  // A new box: each line takes its language's look from the theme.
  const box = editor.getByTestId('editor-slide').locator('[data-element]').last();
  await expect(box.locator('[data-run][data-lang="gu"]')).toHaveText('ગુજરાતી\n');
  await expect(box.locator('[data-run][data-lang="hi"]')).toHaveText('हिन्दी');
  await app.close();
});

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const)
  test(`the editor at ${width} x ${height}: nothing cut off, and no serious accessibility findings`, async () => {
    const { app } = await launchApp();
    const win = await operatorPage(app);
    await win.setViewportSize({ width, height });
    const { ed, editor } = await openEditor(app, win, /Sample kirtan/);
    await sizeSlideEditor(app, ed, { width, height });
    // Nothing selected: the slide's own settings.
    await expect(editor.getByTestId('slide-panel')).toBeVisible();
    await expectNoSeriousA11yIssues(ed, `the slide editor's slide panel at ${width} x ${height}`);
    await clickSlide(ed, 960, 540);
    await expect(editor.getByTestId('inspector-text')).toBeVisible();
    const problems = await ed.evaluate(() => {
      const out: string[] = [];
      const vw = innerWidth;
      const vh = innerHeight;
      const header = [...document.querySelectorAll('[data-testid="slide-editor"] header > *')];
      const boxes = header.map((el) => ({ el, r: el.getBoundingClientRect() })).filter((b) => b.r.width > 0);
      for (const { el, r } of boxes) {
        if (r.left < -0.5 || r.right > vw + 0.5 || r.top < -0.5 || r.bottom > vh + 0.5)
          out.push(`${el.textContent} is cut off`);
        if (el instanceof HTMLButtonElement && el.scrollWidth > el.clientWidth + 1)
          out.push(`${el.textContent}: words do not fit`);
      }
      boxes.forEach((a, i) => {
        for (const b of boxes.slice(i + 1)) {
          const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (x > 1 && y > 1) out.push(`${a.el.textContent} overlaps ${b.el.textContent}`);
        }
      });
      const canvas = document.querySelector('[data-testid="editor-canvas"]')?.getBoundingClientRect();
      if (!canvas || canvas.width < 480) out.push(`the slide is too small (${canvas?.width ?? 0} px)`);
      const inspector = document.querySelector('[data-testid="inspector"]')?.getBoundingClientRect();
      if (!inspector || inspector.right > vw + 0.5) out.push('the inspector is cut off');
      if (document.documentElement.scrollWidth > vw) out.push('the page scrolls sideways');
      return out;
    });
    expect(problems).toEqual([]);
    await expectNoSeriousA11yIssues(ed, `the slide editor at ${width} x ${height}`);
    // Typing in a box, with the inspector styling its words.
    await ed.keyboard.press('Enter');
    await expect(editor.getByTestId('text-editing')).toBeFocused();
    await expectNoSeriousA11yIssues(ed, 'the slide editor while typing');
    await app.close();
  });
