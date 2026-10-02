import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, outputPage, setUpScreen } from './helpers';
import { makeTestImage } from './test-media';

/*
 * The slide editor (Session 7): editing words in place, shapes and
 * pictures, moving from the keyboard and by dragging (with snapping),
 * Undo and Redo, saving to the screens, Cancel, legacy-font text, typing
 * through an input method, and accessibility. Placeholder words and
 * generated pictures only.
 */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** A point on the slide (slide pixels) as a point in the window. */
async function onCanvas(win: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = win.getByTestId('editor-canvas');
  const box = await canvas.boundingBox();
  const scale = Number(await canvas.getAttribute('data-scale'));
  if (!box) throw new Error('no canvas');
  return { x: box.x + x * scale, y: box.y + y * scale };
}

async function clickSlide(win: Page, x: number, y: number): Promise<void> {
  const p = await onCanvas(win, x, y);
  await win.mouse.click(p.x, p.y);
}

/** Drag on the slide from one point to another (slide pixels), in small steps, optionally holding Alt. */
async function dragSlide(
  win: Page,
  from: [number, number],
  to: [number, number],
  alt = false,
): Promise<void> {
  const a = await onCanvas(win, ...from);
  const b = await onCanvas(win, ...to);
  await win.mouse.move(a.x, a.y);
  if (alt) await win.keyboard.down('Alt');
  await win.mouse.down();
  for (let i = 1; i <= 8; i++) await win.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  await win.mouse.up();
  if (alt) await win.keyboard.up('Alt');
}

const fieldValue = async (win: Page, id: string) => Number(await win.getByTestId(id).inputValue());

/** Import a placeholder kirtan (and anything else) and return the kirtan's id. */
async function importKirtan(win: Page, name: string, words: string, more: string[] = []): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-editor-'));
  const file = join(dir, `${name}.txt`);
  writeFileSync(file, words);
  const [id = ''] = await importAndGetIds(win, [file, ...more]);
  return id;
}

async function openEditor(win: Page, name: string | RegExp): Promise<Locator> {
  await win.getByTestId('presentation-list').getByRole('button', { name }).click();
  await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toBeVisible();
  await win.getByTestId('edit-slides').click();
  const editor = win.getByTestId('slide-editor');
  await expect(editor.getByTestId('editor-canvas')).toBeVisible();
  return editor;
}

/**
 * Select the words between two offsets of the first piece of text being typed in (as a mouse drag
 * would). The editor reads a selection when the page says it changed; the page's own word for that
 * came too late on a macOS CI runner, so it is said here at once, as the browser would.
 */
async function selectTyped(win: Page, start: number, end: number): Promise<void> {
  await win.evaluate(
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
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Placeholder Editor Kirtan/ })
    .click();
  await win.getByTestId('slide-thumb').first().click();
  const slideLayer = output.locator('[data-layer="slide"]');
  await expect(slideLayer).toContainText('નમૂના પંક્તિ');

  const editor = await openEditor(win, /Placeholder Editor Kirtan/);
  const status = editor.getByTestId('editor-status');

  // The words: select the box, type in it, give the first Gujarati word its own font and size.
  await clickSlide(win, 960, 540);
  await expect(status).toContainText('Text box');
  await win.keyboard.press('Enter');
  const typing = editor.getByTestId('text-editing');
  await expect(typing).toBeFocused();
  await selectTyped(win, 0, 5);
  await expect(editor.getByTestId('text-target')).toHaveText('Styling the selected words.');
  await editor.getByTestId('field-font').fill('Placeholder Serif');
  await editor.getByTestId('field-size').fill('120');
  await win.keyboard.press('Escape');
  await expect(typing).toHaveCount(0);
  const word = editor.getByTestId('editor-slide').locator('[data-run][data-lang="gu"]').first();
  await expect(word).toHaveText('નમૂના');
  await expect.poll(() => word.evaluate((el) => getComputedStyle(el).fontSize)).toBe('120px');
  expect(await word.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Placeholder Serif"?/u);

  // A shape: an ellipse in the middle, moved from the keyboard.
  await editor.getByTestId('add-shape').click();
  await win.getByRole('menuitem', { name: 'Ellipse' }).click();
  await expect(status).toContainText('Ellipse selected');
  await clickSlide(win, 960, 540);
  const x0 = await fieldValue(win, 'field-x');
  const y0 = await fieldValue(win, 'field-y');
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => fieldValue(win, 'field-x')).toBe(x0 + 3);
  expect(await fieldValue(win, 'field-y')).toBe(y0 + 10);

  // A picture from the library, at its own proportions in the middle of the slide.
  await editor.getByTestId('add-media').click();
  await win.getByTestId('media-picker').getByTestId('media-choice').first().click();
  await expect(status).toContainText('Picture selected');
  await expect.poll(() => fieldValue(win, 'field-width')).toBe(960);
  expect(await fieldValue(win, 'field-height')).toBe(540);
  expect(await fieldValue(win, 'field-x')).toBe(480);

  // Move it off the middle from the keyboard (ten times ten), then drag it back to 10 px short of
  // the middle: it snaps there, with a guide; holding Alt it goes exactly where it is dragged.
  await clickSlide(win, 700, 400);
  for (let i = 0; i < 10; i++) await win.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => fieldValue(win, 'field-x')).toBe(580);
  const a = await onCanvas(win, 1060, 540);
  const b = await onCanvas(win, 950, 540);
  await win.mouse.move(a.x, a.y);
  await win.mouse.down();
  for (let i = 1; i <= 8; i++) await win.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y);
  await expect(editor.getByTestId('guide').first()).toBeVisible();
  await win.mouse.up();
  await expect(editor.getByTestId('guide')).toHaveCount(0);
  await expect.poll(() => fieldValue(win, 'field-x')).toBe(480);
  await dragSlide(win, [960, 540], [863, 540], true);
  const free = await fieldValue(win, 'field-x');
  expect(Math.abs(free - 383)).toBeLessThanOrEqual(3);

  // Undo and Redo: the free drag, then the snapped one.
  await win.keyboard.press(`${mod}+Z`);
  await expect.poll(() => fieldValue(win, 'field-x')).toBe(480);
  await win.keyboard.press(`${mod}+Z`);
  await expect.poll(() => fieldValue(win, 'field-x')).toBe(580);
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
  await expect.poll(() => fieldValue(win, 'field-x')).toBe(480);

  // Save: the live slide on the screens shows it all at once.
  await editor.getByTestId('save-slides').click();
  await expect(editor).toHaveCount(0);
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

test('Cancel keeps nothing: Esc lets go of the selection, then asks before throwing changes away', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  const editor = await openEditor(win, /Language test slides/);
  const elements = editor.getByTestId('editor-slide').locator('[data-element]');
  const count = await elements.count();
  expect(count).toBeGreaterThan(0);
  await clickSlide(win, 960, 450);
  await expect(editor.getByTestId('selection')).toHaveCount(1);
  await win.keyboard.press('Delete');
  await expect(elements).toHaveCount(count - 1);
  // Nothing is selected now: Esc would close, so it asks first.
  await win.keyboard.press('Escape');
  const confirm = win.getByTestId('discard-confirm');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Keep editing' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await win.getByTestId('discard-confirm').getByRole('button', { name: 'Throw them away' }).click();
  await expect(editor).toHaveCount(0);
  // Opened again: everything is still there.
  await win.getByTestId('edit-slides').click();
  await expect(
    win.getByTestId('slide-editor').getByTestId('editor-slide').locator('[data-element]'),
  ).toHaveCount(count);
  // With no changes, Esc closes at once.
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('slide-editor')).toHaveCount(0);
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
  const editor = await openEditor(win, /Placeholder Legacy/);
  await clickSlide(win, 960, 540);
  await expect(editor.getByTestId('legacy-note')).toContainText('Gopika');
  await win.keyboard.press('Enter');
  await expect(editor.getByTestId('editor-note')).toContainText('legacy font (Gopika)');
  await expect(editor.getByTestId('text-editing')).toHaveCount(0);
  await win.getByTestId('editor-canvas').dblclick();
  await expect(editor.getByTestId('text-editing')).toHaveCount(0);
  // It moves, and keeps its words exactly.
  await win.getByTestId('editor-canvas').focus();
  await win.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => fieldValue(win, 'field-x')).toBe(90);
  await editor.getByTestId('save-slides').click();
  await expect(editor).toHaveCount(0);
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
  const editor = await openEditor(win, /Language test slides/);
  await editor.getByTestId('add-text').click();
  const typing = editor.getByTestId('text-editing');
  await expect(typing).toBeFocused();
  // Count the composition events the box sees, to be sure the input method's path was used.
  await win.evaluate(() => {
    const root = document.querySelector('[data-testid="text-editing"]');
    const seen: string[] = [];
    (globalThis as typeof globalThis & { compositions?: string[] }).compositions = seen;
    root?.addEventListener('compositionstart', () => seen.push('start'));
    root?.addEventListener('compositionend', (e) => seen.push(`end:${(e as CompositionEvent).data}`));
  });
  const cdp = await win.context().newCDPSession(win);
  // Gujarati: the input method shows what is being composed, then commits the word.
  await cdp.send('Input.imeSetComposition', { text: 'ગુ', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.imeSetComposition', { text: 'ગુજરા', selectionStart: 5, selectionEnd: 5 });
  await cdp.send('Input.insertText', { text: 'ગુજરાતી' });
  await win.keyboard.press('Enter');
  // Hindi, the same way.
  await cdp.send('Input.imeSetComposition', { text: 'हि', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.imeSetComposition', { text: 'हिन्द', selectionStart: 5, selectionEnd: 5 });
  await cdp.send('Input.insertText', { text: 'हिन्दी' });
  await expect(typing).toHaveText('ગુજરાતીहिन्दी');
  const seen = await win.evaluate(
    () => (globalThis as typeof globalThis & { compositions?: string[] }).compositions,
  );
  expect(seen).toEqual(['start', 'end:ગુજરાતી', 'start', 'end:हिन्दी']);
  await win.keyboard.press('Escape');
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
    const editor = await openEditor(win, /Sample kirtan/);
    // Nothing selected: the slide's own settings.
    await expect(editor.getByTestId('slide-panel')).toBeVisible();
    await expectNoSeriousA11yIssues(win, `the slide editor's slide panel at ${width} x ${height}`);
    await clickSlide(win, 960, 540);
    await expect(editor.getByTestId('inspector-text')).toBeVisible();
    const problems = await win.evaluate(() => {
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
    await expectNoSeriousA11yIssues(win, `the slide editor at ${width} x ${height}`);
    // Typing in a box, with the inspector styling its words.
    await win.keyboard.press('Enter');
    await expect(editor.getByTestId('text-editing')).toBeFocused();
    await expectNoSeriousA11yIssues(win, 'the slide editor while typing');
    await app.close();
  });
