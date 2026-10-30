import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
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

/*
 * The slide editor's Words group (Session 55, Part 17a, run 1): one of Drashti's bundled fonts, size, colour, bold,
 * italic, underline and strike through, alignment, line spacing, bullets and numbering (Gujarati and Hindi digits
 * too), and effects (shadow, outline, glow); the screens draw what the editor drew, exactly; and find and replace
 * across the presentation, one Undo for Replace all. Gujarati words keep their shapes. Placeholder words only.
 */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function start(): Promise<{ app: ElectronApplication; win: Page }> {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1440, height: 900 });
  return { app, win };
}

async function importKirtan(win: Page, name: string, words: string): Promise<string> {
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-editor-words-')), `${name}.txt`);
  writeFileSync(file, words);
  const [id = ''] = await importAndGetIds(win, [file]);
  return id;
}

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

/** Select words being typed, between two offsets of the first piece of text (as a drag of the mouse would). */
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

/**
 * How a text box is drawn, as the page computes it: the box, each run, each line's mark. The same in the editor and
 * on the screens, when the screens draw what the editor drew.
 */
function drawn(box: Locator) {
  return box.evaluate((el) => {
    const css = (e: Element) => {
      const s = getComputedStyle(e);
      return {
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        fontStyle: s.fontStyle,
        color: s.color,
        textAlign: s.textAlign,
        lineHeight: s.lineHeight,
        textShadow: s.textShadow,
        decoration: s.textDecorationLine,
      };
    };
    return {
      box: css(el),
      runs: [...el.querySelectorAll('[data-run]')].map((r) => ({ text: r.textContent, ...css(r) })),
      marks: [...el.querySelectorAll('[data-list-marker]')].map((m) => ({
        mark: m.getAttribute('data-list-marker'),
        text: m.textContent,
      })),
    };
  });
}

test('Words: a bundled font, size, colour, bold, italic, underline, strike through, alignment, spacing, bullets, Gujarati numbering and a glow; the screens draw exactly what the editor drew', async () => {
  test.setTimeout(180_000);
  const { app, win } = await start();
  await setUpScreen(win);
  const output = await outputPage(app);
  await importKirtan(
    win,
    'Placeholder Words Kirtan',
    '[Verse]\nPlaceholder point one\nPlaceholder point two\nPlaceholder point three\n\n[Chorus]\nનમૂના એક\nનમૂના બે\n',
  );
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Words Kirtan/u })
    .click();
  await win.getByTestId('slide-thumb').first().click();
  const slideLayer = output.locator('[data-layer="slide"]');
  await expect(slideLayer).toContainText('Placeholder point one');

  await win.getByTestId('edit-slides').click();
  const { ed, editor } = await slideEditorWindow(app);
  await sizeSlideEditor(app, ed, { width: 1280, height: 800 });
  const ribbon = editor.getByTestId('editor-ribbon');
  const box = editor.getByTestId('editor-slide').locator('[data-element]').first();

  // The whole box: Mukta, 96, a yellow, bold, underlined, to the left, 1.5 between lines, bullets and a glow.
  await clickSlide(ed, 960, 540);
  await expect(editor.getByTestId('editor-status')).toContainText('Text box');
  const font = ribbon.getByTestId('field-font');
  // Only Drashti's bundled fonts are offered.
  const offered = await font.locator('option:not([disabled])').allTextContents();
  expect(offered).toContain('Mukta');
  expect(offered).toContain('Noto Serif');
  expect(offered).not.toContain('Arial');
  await font.selectOption('Mukta');
  await ribbon.getByTestId('field-size').fill('96');
  await ribbon.getByTestId('field-color').fill('#ffcc00');
  await ribbon.getByTestId('words-bold').click();
  await expect(ribbon.getByTestId('words-bold')).toHaveAttribute('aria-pressed', 'true');
  await ribbon.getByTestId('words-underline').click();
  await expect(ribbon.getByTestId('words-underline')).toHaveAttribute('aria-pressed', 'true');
  await ribbon.getByTestId('words-align-left').click();
  await ribbon.getByTestId('field-line-height').fill('1.5');
  await ribbon.getByTestId('words-bullets').click();
  await expect(ribbon.getByTestId('words-bullets')).toHaveAttribute('aria-pressed', 'true');
  await expect(box.locator('[data-list-marker]')).toHaveCount(3);
  await ribbon.getByTestId('words-effects').click();
  const effects = ed.getByTestId('words-effects-panel');
  await expect(effects).toBeVisible();
  await effects.getByTestId('field-glow').click();
  await effects.getByTestId('field-glow-color').fill('#00ffcc');
  await effects.getByTestId('field-glow-size').fill('20');
  await expectNoSeriousA11yIssues(ed, 'the Words group with its effects open');
  await ed.keyboard.press('Escape');
  await expect(effects).toHaveCount(0);

  // Words of their own: the first word, typed in, italic and struck through.
  await ed.keyboard.press('Enter');
  const typing = editor.getByTestId('text-editing');
  await expect(typing).toBeFocused();
  await selectTyped(ed, 0, 11);
  await expect(editor.getByTestId('text-target')).toHaveText('Styling the selected words.');
  await ribbon.getByTestId('words-italic').click();
  await ribbon.getByTestId('words-strike').click();
  await ed.keyboard.press('Escape');
  await expect(typing).toHaveCount(0);

  const inEditor = await drawn(box);
  expect(inEditor.box.fontFamily).toMatch(/^"?Mukta"?/u);
  expect(inEditor.box.fontSize).toBe('96px');
  expect(inEditor.box.color).toBe('rgb(255, 204, 0)');
  expect(inEditor.box.textAlign).toBe('left');
  expect(inEditor.box.lineHeight).toBe('144px');
  expect(inEditor.box.textShadow).toContain('rgb(0, 255, 204) 0px 0px 20px');
  expect(inEditor.marks.map((m) => m.mark)).toEqual(['disc', 'disc', 'disc']);
  const first = inEditor.runs[0];
  expect(first?.text).toBe('Placeholder');
  expect(first?.fontStyle).toBe('italic');
  expect(first?.decoration).toContain('underline');
  expect(first?.decoration).toContain('line-through');
  expect(first?.fontWeight).toBe('700');
  const rest = inEditor.runs.slice(1);
  expect(rest.length).toBeGreaterThan(0);
  for (const run of rest) {
    expect(run.decoration).toBe('underline');
    expect(run.fontWeight).toBe('700');
  }

  // The Gujarati slide: numbered in Gujarati digits; no Italic to offer (Gujarati stands upright).
  await editor.getByTestId('editor-slide-thumb').nth(1).click();
  await clickSlide(ed, 960, 540);
  await expect(editor.getByTestId('editor-status')).toContainText('Text box');
  await expect(ribbon.getByTestId('words-italic')).toBeDisabled();
  await ribbon.getByTestId('words-numbers-menu').click();
  await ed.getByRole('menuitemradio', { name: /૧/u }).click();
  await expect(ribbon.getByTestId('words-numbers')).toHaveAttribute('aria-pressed', 'true');
  const gujarati = editor.getByTestId('editor-slide').locator('[data-element]').first();
  await expect(gujarati.locator('[data-list-marker]')).toHaveText(['૧.', '૨.']);
  const gujaratiInEditor = await drawn(gujarati);

  // Saved: the screens draw exactly what the editor drew.
  await editor.getByTestId('save-slides').click();
  await slideEditorClosed(app);
  const onScreen = slideLayer.locator('[data-element]').first();
  await expect(onScreen.locator('[data-list-marker]')).toHaveCount(3);
  await expect.poll(() => drawn(onScreen)).toEqual(inEditor);
  // The next slide: the Gujarati words, whole, numbered as in the editor.
  await win.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await win.keyboard.press('ArrowRight');
  await expect(slideLayer).toContainText('નમૂના એક');
  const gujaratiOnScreen = slideLayer.locator('[data-element]').first();
  await expect(gujaratiOnScreen.locator('[data-list-marker]')).toHaveText(['૧.', '૨.']);
  await expect.poll(() => drawn(gujaratiOnScreen)).toEqual(gujaratiInEditor);
  expect(await gujaratiOnScreen.locator('[data-run]').allTextContents()).toEqual(['નમૂના એક\n', 'નમૂના બે']);
  await app.close();
});

test('find and replace across the presentation: counted, gone to, replaced one at a time or all at once (one Undo), Gujarati too', async () => {
  test.setTimeout(150_000);
  const { app, win } = await start();
  const id = await importKirtan(
    win,
    'Placeholder Find Kirtan',
    '[Verse]\nPlaceholder alpha words\n\nPlaceholder beta words\n\nPlaceholder alpha again\n\n[Chorus]\nનમૂના શબ્દ\n',
  );
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Find Kirtan/u })
    .click();
  await win.getByTestId('edit-slides').click();
  const { ed, editor } = await slideEditorWindow(app);
  await sizeSlideEditor(app, ed, { width: 1280, height: 800 });
  const thumbs = editor.getByTestId('editor-slide-thumb');

  // ⌘F (Ctrl+F) opens it, the words to find focused.
  await editor.getByTestId('editor-canvas').focus();
  await ed.keyboard.press(`${mod}+F`);
  const panel = editor.getByTestId('find-panel');
  await expect(panel).toBeVisible();
  const find = panel.getByTestId('find-text');
  await expect(find).toBeFocused();
  await find.fill('alpha');
  const count = panel.getByTestId('find-count');
  await expect(count).toHaveText('1 of 2');
  await panel.getByTestId('find-next').click();
  await expect(count).toHaveText('2 of 2');
  await expect(thumbs.nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(editor.getByTestId('selection')).toHaveCount(1);
  // Match case: none with a small p; without it, three.
  await find.fill('placeholder');
  await panel.getByTestId('find-case').click();
  await expect(count).toHaveText('None found');
  await panel.getByTestId('find-case').click();
  await expect(count).toHaveText(/of 3$/u);
  await expectNoSeriousA11yIssues(ed, 'find and replace');

  // Replace all: every "alpha" at once, one step for Undo.
  await find.fill('alpha');
  await panel.getByTestId('replace-text').fill('gamma');
  await panel.getByTestId('replace-all').click();
  await expect(panel.getByTestId('find-said')).toHaveText('Replaced 2.');
  await expect(count).toHaveText('None found');
  await expect(thumbs.nth(0)).toContainText('Placeholder gamma words');
  await expect(thumbs.nth(2)).toContainText('Placeholder gamma again');
  await editor.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(thumbs.nth(0)).toContainText('Placeholder alpha words');
  await expect(thumbs.nth(2)).toContainText('Placeholder alpha again');
  await editor.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(thumbs.nth(2)).toContainText('Placeholder gamma again');

  // Gujarati: one at a time.
  await find.fill('નમૂના');
  await expect(count).toHaveText('1 of 1');
  await panel.getByTestId('replace-text').fill('બીજું');
  await panel.getByTestId('replace-one').click();
  await expect(thumbs.nth(3)).toContainText('બીજું શબ્દ');
  await expect(count).toHaveText('None found');
  await ed.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  await editor.getByTestId('save-slides').click();
  await slideEditorClosed(app);
  const words = await win.evaluate(async (pid) => {
    const doc = await (globalThis as PageGlobals).drashti.library.getPresentation(pid);
    return doc?.groups.flatMap((g) => g.slides.map((s) => s.slide.elements.map((e) => ('text' in e ? e.text : ''))));
  }, id);
  expect(words).toEqual([
    ['Placeholder gamma words'],
    ['Placeholder beta words'],
    ['Placeholder gamma again'],
    ['બીજું શબ્દ'],
  ]);
  await app.close();
});
