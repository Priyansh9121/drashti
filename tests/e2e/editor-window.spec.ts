import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues, settled } from './a11y';
import {
  editorGroup,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
  sizeSlideEditor,
  slideEditorClosed,
  slideEditorWindow,
} from './helpers';
import { CI_WINDOW } from './window-size';

/*
 * The slide editor's frame (Session 55, Part 17a, run 1): Edit slides opens a window of its own, so the show goes on
 * in the operator window while slides are edited (its keys and buttons stay live, the edits wait); the editor's
 * groups along its top (Words, Insert, Arrange, Design, Motion, Slides) with today's tools in them; Undo and Redo
 * for every change, by keys and by buttons, typing included; and zoom: to fit, in and out, by keys, buttons and the
 * trackpad. Laid out at CI's 1024 × 645 and at 1280 × 720. Placeholder words only.
 */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const GROUPS = ['Words', 'Insert', 'Arrange', 'Design', 'Motion', 'Slides'] as const;

async function start(): Promise<{ app: ElectronApplication; win: Page }> {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1440, height: 900 });
  return { app, win };
}

/** A placeholder kirtan of three slides, imported; its id. */
async function importPlaceholder(win: Page, name: string): Promise<string> {
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-editor-window-')), `${name}.txt`);
  writeFileSync(
    file,
    '[Verse]\nPlaceholder line one\n\nPlaceholder line two\n\n[Chorus]\nPlaceholder chorus line\n',
  );
  const [id = ''] = await importAndGetIds(win, [file]);
  return id;
}

/** The presentation chosen in the library, and Edit slides pressed: the editor's window. */
async function editSlides(app: ElectronApplication, win: Page, name: RegExp) {
  await openLibrary(win);
  await win.getByTestId('presentation-list').getByRole('button', { name }).click();
  await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toBeVisible();
  await win.getByTestId('edit-slides').click();
  return slideEditorWindow(app);
}

/** A point on the slide (slide pixels) as a point in the editor's window. */
async function onCanvas(ed: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = ed.getByTestId('editor-canvas');
  const box = await canvas.boundingBox();
  const scale = Number(await canvas.getAttribute('data-scale'));
  if (!box) throw new Error('no canvas');
  return { x: box.x + x * scale, y: box.y + y * scale };
}

test('Edit slides opens a window of its own: the show goes on in the operator window meanwhile, and the save comes back to it as one Undo', async () => {
  test.setTimeout(150_000);
  const { app, win } = await start();
  await setUpScreen(win);
  const output = await outputPage(app);
  await importPlaceholder(win, 'Placeholder Window Kirtan');
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Window Kirtan/ })
    .click();
  await win.getByTestId('slide-thumb').first().click();
  const slideLayer = output.locator('[data-layer="slide"]');
  await expect(slideLayer).toContainText('Placeholder line one');

  // Edit slides: a window of its own, named for the presentation; the operator window is still there, unchanged.
  await win.getByTestId('edit-slides').click();
  const { ed, editor } = await slideEditorWindow(app);
  await expect(ed).toHaveTitle(/Placeholder Window Kirtan/u);
  await expect(win.getByTestId('slide-editor')).toHaveCount(0);
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);

  // A change in the editor: the first slide's words taken away (not saved yet).
  const elements = editor.getByTestId('editor-slide').locator('[data-element]');
  await expect(elements).toHaveCount(1);
  const p = await onCanvas(ed, 960, 540);
  await ed.mouse.click(p.x, p.y);
  await expect(editor.getByTestId('editor-status')).toContainText('Text box');
  await ed.keyboard.press('Delete');
  await expect(elements).toHaveCount(0);

  // Meanwhile the show goes on from the operator window: its Next key moves the screens on.
  await win.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await win.keyboard.press('ArrowRight');
  await expect(slideLayer).toContainText('Placeholder line two');

  // The editor still has its change; saved, its window closes, and the operator window has the one Undo.
  await expect(elements).toHaveCount(0);
  await editor.getByTestId('save-slides').click();
  await slideEditorClosed(app);
  const undo = win.getByTestId('undo-removal');
  await expect(undo).toContainText('Edited the slides of “Placeholder Window Kirtan”');
  await undo.getByRole('button', { name: /Undo/ }).click();
  await expect(undo).toHaveCount(0);
  await app.close();
});

for (const size of [CI_WINDOW, { width: 1280, height: 720 }] as const)
  test(`its six groups along the top, today’s tools in them, at ${size.width} × ${size.height}: nothing cut off or overlapping, and no serious accessibility findings on any group`, async () => {
    test.setTimeout(150_000);
    const { app, win } = await start();
    await importPlaceholder(win, 'Placeholder Groups Kirtan');
    const { ed, editor } = await editSlides(app, win, /^Placeholder Groups Kirtan/u);
    await sizeSlideEditor(app, ed, size);
    const tabs = editor.getByRole('tablist', { name: 'The editor’s groups' });
    await expect(tabs.getByRole('tab')).toHaveText([...GROUPS]);
    // Words is chosen to begin with.
    await expect(tabs.getByRole('tab', { name: 'Words' })).toHaveAttribute('aria-selected', 'true');

    // Today's tools in their groups.
    const ribbon = editor.getByTestId('editor-ribbon');
    const tools: Record<(typeof GROUPS)[number], string[]> = {
      Words: ['field-font', 'field-size', 'field-color', 'words-bold', 'words-italic', 'words-underline'],
      Insert: ['add-text', 'add-shape', 'add-media', 'add-timer'],
      Arrange: ['arrange-left', 'arrange-front', 'arrange-back'],
      Design: ['design-color', 'design-darken'],
      Motion: ['motion-transition', 'motion-auto'],
      Slides: ['slide-new', 'slide-new-timer', 'group-new', 'slide-duplicate', 'slide-up', 'slide-down', 'slide-delete'],
    };
    // A box selected: the Words group and Arrange act on it.
    const p = await onCanvas(ed, 960, 540);
    await ed.mouse.click(p.x, p.y);
    await expect(editor.getByTestId('editor-status')).toContainText('Text box');
    for (const group of GROUPS) {
      await editorGroup(ed, group);
      for (const id of tools[group]) await expect(ribbon.getByTestId(id), `${group}: ${id}`).toBeVisible();
      await settled(ed);
      // Nothing along the top cut off, overlapping, or with words that do not fit; the slide still a good size.
      const problems = await ed.evaluate(() => {
        const out: string[] = [];
        const vw = innerWidth;
        const vh = innerHeight;
        const top = [
          ...document.querySelectorAll(
            '[data-testid="slide-editor"] header > *, [data-testid="editor-ribbon"] button, [data-testid="editor-ribbon"] input, [data-testid="editor-ribbon"] select',
          ),
        ];
        const boxes = top.map((el) => ({ el, r: el.getBoundingClientRect() })).filter((b) => b.r.width > 0);
        for (const { el, r } of boxes) {
          const name = el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? el.textContent;
          if (r.left < -0.5 || r.right > vw + 0.5 || r.top < -0.5 || r.bottom > vh + 0.5)
            out.push(`${name} is cut off`);
          if (el instanceof HTMLButtonElement && el.scrollWidth > el.clientWidth + 1)
            out.push(`${name}: its words do not fit`);
        }
        boxes.forEach((a, i) => {
          for (const b of boxes.slice(i + 1)) {
            if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
            const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
            const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
            if (x > 1 && y > 1)
              out.push(
                `${a.el.getAttribute('aria-label') ?? a.el.textContent} overlaps ${b.el.getAttribute('aria-label') ?? b.el.textContent}`,
              );
          }
        });
        const canvas = document.querySelector('[data-testid="editor-canvas"]')?.getBoundingClientRect();
        if (!canvas || canvas.width < 440) out.push(`the slide is too small (${canvas?.width ?? 0} px)`);
        const inspector = document.querySelector('[data-testid="inspector"]')?.getBoundingClientRect();
        if (!inspector || inspector.right > vw + 0.5) out.push('the side panel is cut off');
        if (document.documentElement.scrollWidth > vw) out.push('the page scrolls sideways');
        return out;
      });
      expect(problems, `${group} at ${size.width} × ${size.height}`).toEqual([]);
      await expectNoSeriousA11yIssues(ed, `the slide editor's ${group} at ${size.width} × ${size.height}`);
    }
    await app.close();
  });

test('Undo and Redo for every change, by keys and by buttons, typing too; zoom to fit, in and out by keys, buttons and the trackpad', async () => {
  test.setTimeout(150_000);
  const { app, win } = await start();
  await importPlaceholder(win, 'Placeholder Undo Kirtan');
  const { ed, editor } = await editSlides(app, win, /^Placeholder Undo Kirtan/u);
  await sizeSlideEditor(app, ed, { width: 1280, height: 800 });
  const undoButton = editor.getByRole('button', { name: 'Undo', exact: true });
  const redoButton = editor.getByRole('button', { name: 'Redo', exact: true });
  const words = editor.getByTestId('editor-slide').locator('[data-element]').first();

  // Typing: the buttons undo and redo the words as they are typed, without leaving the box.
  const p = await onCanvas(ed, 960, 540);
  await ed.mouse.click(p.x, p.y);
  await ed.keyboard.press('Enter');
  const typing = editor.getByTestId('text-editing');
  await expect(typing).toBeFocused();
  await ed.keyboard.press('End');
  await ed.keyboard.type(' placeholder typed');
  await expect(typing).toContainText('Placeholder line one placeholder typed');
  await expect(undoButton).toBeEnabled();
  await undoButton.click();
  await expect(typing).toHaveText('Placeholder line one');
  await expect(redoButton).toBeEnabled();
  await redoButton.click();
  await expect(typing).toHaveText('Placeholder line one placeholder typed');
  // Typing ended: one step, undone and redone by the buttons and by the keys.
  await ed.keyboard.press('Escape');
  await expect(typing).toHaveCount(0);
  await expect(words).toHaveText('Placeholder line one placeholder typed');
  await undoButton.click();
  await expect(words).toHaveText('Placeholder line one');
  await redoButton.click();
  await expect(words).toHaveText('Placeholder line one placeholder typed');
  await editor.getByTestId('editor-canvas').focus();
  await ed.keyboard.press(`${mod}+Z`);
  await expect(words).toHaveText('Placeholder line one');
  await ed.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
  await expect(words).toHaveText('Placeholder line one placeholder typed');

  // A shape added from Insert, then a slide from Slides: each one step back and forth.
  await editorGroup(ed, 'Insert');
  await editor.getByTestId('add-shape').click();
  await ed.getByRole('menuitem', { name: 'Ellipse' }).click();
  await expect(editor.getByTestId('editor-slide').locator('svg[data-shape="ellipse"]')).toHaveCount(1);
  await editorGroup(ed, 'Slides');
  const thumbs = editor.getByTestId('editor-slide-thumb');
  await expect(thumbs).toHaveCount(3);
  await editor.getByTestId('slide-new').click();
  await expect(thumbs).toHaveCount(4);
  await undoButton.click();
  await expect(thumbs).toHaveCount(3);
  await undoButton.click();
  await expect(editor.getByTestId('editor-slide').locator('svg[data-shape="ellipse"]')).toHaveCount(0);
  await redoButton.click();
  await expect(editor.getByTestId('editor-slide').locator('svg[data-shape="ellipse"]')).toHaveCount(1);
  await redoButton.click();
  await expect(thumbs).toHaveCount(4);

  // Zoom: to fit to begin with; in and out by the keys, back to fit; the buttons; and a pinch on the trackpad.
  const canvas = editor.getByTestId('editor-canvas');
  const scale = async () => Number(await canvas.getAttribute('data-scale'));
  const fit = await scale();
  expect(fit).toBeGreaterThan(0.1);
  await expect(editor.getByTestId('zoom-fit')).toHaveAttribute('aria-pressed', 'true');
  await canvas.focus();
  await ed.keyboard.press(`${mod}+Equal`);
  await expect.poll(scale).toBeGreaterThan(fit);
  await expect(editor.getByTestId('zoom-fit')).toHaveAttribute('aria-pressed', 'false');
  await expect(editor.getByTestId('zoom-fit')).toContainText(/\d+%/u);
  const zoomed = await scale();
  await ed.keyboard.press(`${mod}+Minus`);
  await expect.poll(scale).toBeLessThan(zoomed);
  await ed.keyboard.press(`${mod}+0`);
  await expect.poll(scale).toBeCloseTo(fit, 3);
  await editor.getByTestId('zoom-in').click();
  await expect.poll(scale).toBeGreaterThan(fit);
  await editor.getByTestId('zoom-out').click();
  await editor.getByTestId('zoom-out').click();
  await expect.poll(scale).toBeLessThan(fit);
  await editor.getByTestId('zoom-fit').click();
  await expect.poll(scale).toBeCloseTo(fit, 3);
  // A pinch (the trackpad's wheel with Ctrl) over the slide zooms in about the pointer.
  const area = editor.getByTestId('editor-canvas-area');
  const a = await area.boundingBox();
  if (!a) throw new Error('no canvas area');
  await ed.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await ed.keyboard.down('Control');
  await ed.mouse.wheel(0, -120);
  await ed.keyboard.up('Control');
  await expect.poll(scale).toBeGreaterThan(fit);
  // Zoomed in, the slide scrolls in its area; a change still lands where it should.
  await ed.keyboard.press(`${mod}+0`);
  await expect.poll(scale).toBeCloseTo(fit, 3);
  await app.close();
});
