import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeTestDeck, placeholderDeckMedia } from '../../src/main/import/testing/make-deck';
import { expectNoSeriousA11yIssues } from './a11y';
import { openEditor } from './deck-edit-fixtures';
import { drawPicture, goLive, halves, makeSlides } from './placeholder-slides';
import { near, pixels } from './pixels';
import {
  editorGroup,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  setUpScreen,
  type PageGlobals,
  sizeSlideEditor,
  slideEditorClosed,
  slideEditorWindow,
} from './helpers';

async function start() {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-design-motion-')), 'Placeholder editor design.txt');
  writeFileSync(
    file,
    '[Placeholder group]\nPlaceholder first slide\n\nPlaceholder second slide\n\nPlaceholder third slide\n',
  );
  const [id = ''] = await importAndGetIds(win, [file]);
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder editor design/ })
    .click();
  await win.getByTestId('edit-slides').click();
  const { ed, editor } = await slideEditorWindow(app);
  return { app, win, ed, editor, id };
}

test('Design keeps a gradient, slide size and layout with Undo and Redo, saved and reopened', async () => {
  const { app, win, ed, editor, id } = await start();
  try {
    await editorGroup(ed, 'Design');
    await expect(editor.getByTestId('design-background-kind')).toBeVisible();
    await editor.getByTestId('design-background-kind').selectOption('gradient');
    await editor.getByTestId('design-gradient-from').fill('#123456');
    await editor.getByTestId('design-gradient-to').fill('#654321');
    await editor.getByTestId('design-layout').selectOption('two-columns');
    await expect(editor.getByTestId('editor-slide').locator('[data-element]')).toHaveCount(2);
    await ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-element]')).toHaveCount(1);
    await ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-element]')).toHaveCount(2);
    await editor.getByTestId('design-size').click();
    await ed.getByTestId('slide-size-preset').selectOption('standard');
    await ed.getByRole('button', { name: 'Keep size', exact: true }).click();
    for (const size of [
      { width: 1024, height: 645 },
      { width: 1280, height: 720 },
    ]) {
      await sizeSlideEditor(app, ed, size);
      await expectNoSeriousA11yIssues(ed, `Design ${size.width}`);
    }
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      id,
    );
    if (!saved.ok) throw new Error(saved.message);
    expect([saved.doc.width, saved.doc.height]).toEqual([1440, 1080]);
    expect(saved.doc.groups[0]?.slides[0]).toMatchObject({
      design: { layout: 'two-columns', backdrop: { kind: 'gradient', from: '#123456', to: '#654321' } },
    });
    await win.getByTestId('edit-slides').click();
    const reopened = await slideEditorWindow(app);
    await editorGroup(reopened.ed, 'Design');
    await expect(reopened.editor.getByTestId('design-background-kind')).toHaveValue('gradient');
    await expect(reopened.editor.getByTestId('design-layout')).toHaveValue('two-columns');
  } finally {
    await app.close();
  }
});

test('Design edits one master on the canvas and keeps it behind the presentation’s own slides', async () => {
  const { app, win, ed, editor, id } = await start();
  try {
    await editorGroup(ed, 'Design');
    await expect(editor.getByTestId('design-master')).toBeVisible();
    await editor.getByTestId('design-master').click();
    await expect(editor.getByTestId('editor-master-banner')).toBeVisible();
    await editorGroup(ed, 'Insert');
    await editor.getByTestId('add-text').click();
    await editor.locator('[data-editing="true"] .ProseMirror').fill('Placeholder master heading');
    await editor.getByTestId('master-done').click();
    await expect(editor.getByTestId('editor-master-banner')).toHaveCount(0);
    await expect(editor.getByTestId('editor-slide')).toContainText('Placeholder master heading');
    await editor.getByTestId('editor-slide-thumb').nth(1).click();
    await expect(editor.getByTestId('editor-slide')).toContainText('Placeholder master heading');
    await editorGroup(ed, 'Design');
    await editor.getByTestId('design-master').click();
    const canvas = await editor.getByTestId('editor-canvas').boundingBox();
    if (!canvas) throw new Error('no canvas');
    await ed.mouse.dblclick(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    // The words chosen with the keys, as a person chooses them. fill() chooses with a DOM range instead,
    // and the box's own check just after it takes the keyboard can put the double-click's caret back first.
    const typing = editor.locator('[data-editing="true"] .ProseMirror');
    await expect(typing).toBeFocused();
    await typing.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await ed.keyboard.insertText('Placeholder revised master');
    await expect(typing).toHaveText('Placeholder revised master');
    await editor.getByTestId('master-done').click();
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      id,
    );
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.doc).toMatchObject({
      master: { elements: [expect.objectContaining({ text: 'Placeholder revised master' })] },
    });
    expect(saved.doc.groups.flatMap((g) => g.slides)).toHaveLength(3);
  } finally {
    await app.close();
  }
});

test('Motion keeps per-element in, emphasis and out times as well as the slide transition and auto advance', async () => {
  const { app, win, ed, editor, id } = await start();
  try {
    await editor.getByTestId('editor-canvas').focus();
    await ed.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await editorGroup(ed, 'Motion');
    await expect(editor.getByTestId('motion-element-in')).toBeVisible();
    await editor.getByTestId('motion-element-in').selectOption('fade');
    await editor.getByTestId('motion-in-duration').fill('1');
    await editor.getByTestId('motion-element-emphasis').selectOption('pulse');
    await editor.getByTestId('motion-emphasis-delay').fill('1.5');
    await editor.getByTestId('motion-element-out').selectOption('fade');
    await editor.getByTestId('motion-out-delay').fill('4');
    await editor.getByTestId('motion-transition').selectOption('dissolve');
    await editor.getByTestId('motion-transition-seconds').fill('0.4');
    await editor.getByTestId('motion-auto').check();
    await editor.getByTestId('motion-auto-seconds').fill('6');
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      id,
    );
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.doc.groups[0]?.slides[0]).toMatchObject({
      transition: { kind: 'dissolve', durationMs: 400 },
      autoAdvanceMs: 6000,
      elements: [
        expect.objectContaining({
          motion: {
            in: { kind: 'fade', delayMs: 0, durationMs: 1000 },
            emphasis: { kind: 'pulse', delayMs: 1500, durationMs: 600 },
            out: { kind: 'fade', delayMs: 4000, durationMs: 600 },
          },
        }),
      ],
    });
    await win.getByTestId('edit-slides').click();
    const reopened = await slideEditorWindow(app);
    await editorGroup(reopened.ed, 'Motion');
    await reopened.editor.getByTestId('editor-canvas').focus();
    await reopened.ed.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    for (const phase of ['in', 'emphasis', 'out']) {
      await reopened.editor.getByTestId(`motion-element-${phase}`).selectOption('none');
      await expect(reopened.editor.getByTestId(`motion-element-${phase}`)).toHaveValue('none');
    }
    await reopened.editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const cleared = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      id,
    );
    if (!cleared.ok) throw new Error(cleared.message);
    expect(cleared.doc.groups[0]?.slides[0]?.elements[0]?.motion).toBeUndefined();
  } finally {
    await app.close();
  }
});

test('PowerPoint motion notes keep the ribbon short at 1024 × 645', async () => {
  const { app, userData } = await launchApp({ DRASHTI_TEST_DECK_CONVERTER: '1' });
  try {
    const name = 'Placeholder motion notes';
    const file = join(userData, name + '.pptx');
    const points = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];
    const click = { kind: 'fade' as const, dur: 300, start: 'click' as const };
    writeFileSync(
      file,
      makeTestDeck(
        [
          {
            key: 'placeholder-motion',
            bg: '244060',
            transition: { kind: 'fade', dur: 200 },
            notes: '',
            shapes: [
              {
                id: 2,
                type: 'text',
                name: 'Placeholder paragraph box',
                x: 914_400,
                y: 914_400,
                w: 7_315_200,
                h: 3_657_600,
                paras: points.map((point) => ({ text: 'Placeholder ' + point + ' motion point' })),
              },
              {
                id: 3,
                type: 'text',
                name: 'Placeholder removable box',
                x: 914_400,
                y: 4_572_000,
                w: 7_315_200,
                h: 914_400,
                paras: [{ text: 'Placeholder removable motion' }],
              },
            ],
            effects: [
              { ...click, target: 2, para: 0 },
              { ...click, target: 2, para: 1 },
              { ...click, target: 3 },
              ...[2, 3, 4].map((para) => ({ ...click, target: 2, para })),
            ],
          },
        ],
        placeholderDeckMedia(),
      ),
    );
    const win = await operatorPage(app);
    await operatorReady(win);
    const [id] = await importAndGetIds(win, [file]);
    expect(id).toBeTruthy();
    const { ed, editor } = await openEditor(app, win, name);
    await sizeSlideEditor(app, ed, { width: 1024, height: 645 });
    await editorGroup(ed, 'Motion');
    const motion = editor.getByTestId('imported-motion');
    await expect(motion.getByText('6 clicks', { exact: true })).toBeVisible();
    const ribbon = editor.getByTestId('editor-ribbon');
    const height = () => ribbon.evaluate((element) => element.getBoundingClientRect().height);
    expect(await height()).toBeLessThanOrEqual(105);
    await expect(motion.getByText(/nothing left to move/u)).toHaveCount(0);

    const removable = editor
      .getByTestId('editor-slide')
      .getByText('Placeholder removable motion', { exact: true });
    await removable.click();
    await ed.keyboard.press('Delete');
    await expect(removable).toHaveCount(0);
    await expect(motion.getByText(/Click 3 has nothing left to move/u)).toBeVisible();
    await expect(motion.getByText(/Click [12456] has nothing left to move/u)).toHaveCount(0);
    expect(await height()).toBeLessThanOrEqual(105);
  } finally {
    await app.close();
  }
});

test('Slides offers a draggable strip and notes while a box is selected, with one Undo for its reorder', async () => {
  const { app, win, ed, editor, id } = await start();
  try {
    await editorGroup(ed, 'Slides');
    await expect(editor.getByTestId('slides-strip')).toBeVisible();
    await editor.getByTestId('slides-strip').check();
    await expect(editor.getByTestId('editor-slides')).toHaveAttribute('data-direction', 'across');
    const thumbs = editor.getByTestId('editor-slide-thumb');
    const original = await thumbs.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-slide-id')));
    const from = await thumbs.nth(0).boundingBox();
    const to = await thumbs.nth(2).boundingBox();
    if (!from || !to) throw new Error('no slide strip');
    await ed.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await ed.mouse.down();
    await ed.mouse.move(to.x + to.width - 3, to.y + to.height / 2, { steps: 16 });
    await ed.mouse.up();
    await expect
      .poll(() => thumbs.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-slide-id'))))
      .toEqual([original[1], original[2], original[0]]);
    await ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(() => thumbs.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-slide-id'))))
      .toEqual(original);
    await ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await editor.getByTestId('editor-canvas').focus();
    await ed.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await editor.getByTestId('slides-notes').click();
    await ed.getByTestId('slides-notes-text').fill('Placeholder notes from the Slides group');
    await ed.getByRole('button', { name: 'Keep notes', exact: true }).click();
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      id,
    );
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.doc.groups[0]?.slides.at(-1)?.notes).toBe('Placeholder notes from the Slides group');
  } finally {
    await app.close();
  }
});

test('notes still being typed from the Slides group survive native close and Save changes', async () => {
  const { app, win, ed, editor, id } = await start();
  try {
    await editorGroup(ed, 'Slides');
    await expect(editor.getByTestId('slides-notes')).toBeVisible();
    await editor.getByTestId('slides-notes').click();
    await ed.getByTestId('slides-notes-text').fill('Placeholder notes kept while still typing');
    // Closed once the typing has reached the editor: it holds the notes as a change (its Save, no longer Done), and it
    // tells Main so as it shows it. A person can't close it before their keys land; on CI's Mac the close from Main
    // came within 125 ms of the typing, before the page had told Main (Session 55's gate).
    await expect(editor.getByTestId('save-slides')).toHaveText(/^Save/u);
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('slide-editor.html'),
      );
      if (!window) throw new Error('no editor window');
      window.close();
    });
    await expect(ed.getByTestId('keep-changes')).toBeVisible();
    await ed.getByRole('button', { name: 'Save changes', exact: true }).click();
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      id,
    );
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.doc.groups[0]?.slides[0]?.notes).toBe('Placeholder notes kept while still typing');
  } finally {
    await app.close();
  }
});

test('a picture background survives Undo, Redo and reopening, paints the audience canvas, and can return to a colour', async () => {
  const { app, win, ed, editor, id } = await start();
  try {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-design-picture-'));
    const file = await drawPicture(
      win,
      join(dir, 'Placeholder design background.png'),
      halves('240,20,20', '20,220,20'),
    );
    const [mediaId = ''] = await importAndGetIds(win, [file]);
    await editorGroup(ed, 'Design');
    await editor.getByTestId('design-background-kind').selectOption('picture');
    await ed
      .getByTestId('media-picker')
      .getByRole('button', { name: /^Picture: Placeholder design background/ })
      .click();
    await expect(editor.getByTestId('editor-slide').locator('[data-slide-backdrop="picture"]')).toHaveCount(
      1,
    );
    await ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-slide-backdrop]')).toHaveCount(0);
    await ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-slide-backdrop="picture"]')).toHaveCount(
      1,
    );
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      id,
    );
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.doc.groups[0]?.slides[0]?.design?.backdrop).toEqual({
      kind: 'picture',
      mediaId,
      fit: 'fill',
    });
    await setUpScreen(win);
    const output = await outputPage(app);
    await outputReady(output);
    await goLive(win, id, 0);
    const background = output.locator('[data-layer="slide"] [data-slide-backdrop="picture"]');
    await expect(background).toHaveCount(1);
    await expect
      .poll(async () => {
        const box = await background.boundingBox();
        if (!box) return false;
        const colours = await pixels(
          output,
          [0.15, 0.85].map((part) => ({ x: box.x + box.width * part, y: box.y + box.height * 0.15 })),
        );
        return near(colours[0] ?? [], [240, 20, 20], 15) && near(colours[1] ?? [], [20, 220, 20], 15);
      })
      .toBe(true);
    await openLibrary(win);
    await win.getByTestId('edit-slides').click();
    const reopened = await slideEditorWindow(app);
    await editorGroup(reopened.ed, 'Design');
    await expect(reopened.editor.getByTestId('design-background-kind')).toHaveValue('picture');
    await reopened.editor.getByTestId('design-background-kind').selectOption('solid');
    await expect(reopened.editor.getByTestId('editor-slide').locator('[data-slide-backdrop]')).toHaveCount(0);
    await reopened.editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const solid = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      id,
    );
    if (!solid.ok) throw new Error(solid.message);
    expect(solid.doc.groups[0]?.slides[0]?.background).toBe('#000000');
    expect(solid.doc.groups[0]?.slides[0]?.design?.backdrop).toBeUndefined();
  } finally {
    await app.close();
  }
});

for (const kind of ['whole', 'band'] as const)
  test(`the master’s ${kind} darkening is identical in the editor and audience, under its white heading`, async () => {
    test.setTimeout(120_000);
    const { app } = await launchApp({}, undefined, {}, ['--force-color-profile=srgb']);
    expect(await app.evaluate(({ app }) => app.commandLine.getSwitchValue('force-color-profile'))).toBe(
      'srgb',
    );
    const win = await operatorPage(app);
    await operatorReady(win);
    try {
      const id = await makeSlides(
        win,
        `Placeholder master darkening ${kind}`,
        [{ words: 'Placeholder own words', wordsColor: '#ffffff', background: null }],
        { kind: 'cut', durationMs: 0 },
      );
      const fixture = await win.evaluate(
        async ({ id, kind }) => {
          const d = (globalThis as PageGlobals).drashti;
          const opened = await d.library.slidesForEdit(id);
          if (!opened.ok) throw new Error(opened.message);
          const { doc } = opened;
          const slide = doc.groups.flatMap((g) => g.slides)[0];
          const text = slide?.elements.find((el) => el.kind === 'text');
          if (!slide || !text) throw new Error('no placeholder slide words');
          const white = {
            ...text.style,
            fontFamily: null,
            fontSize: 100,
            fontWeight: 700,
            color: '#ffffff',
            align: 'center' as const,
            verticalAlign: 'middle' as const,
            lineHeight: 1,
            shadow: false,
            outline: null,
            glow: null,
            shrinkToFit: false,
          };
          // The background shape is before the master heading in the composed order.
          // Whole darkening must cover this shape, then leave both white headings alone.
          doc.master = {
            ...slide,
            id: 'placeholder-darkening-master',
            label: 'Master',
            background: '#c85028',
            darken: null,
            transition: null,
            autoAdvanceMs: null,
            cues: [],
            elements: [
              {
                id: 'placeholder-darkening-master-background',
                kind: 'shape',
                shape: 'rectangle',
                frame: { x: 0, y: 0, width: doc.width, height: doc.height },
                fill: '#c85028',
                cornerRadius: 0,
                opacity: 1,
              },
              {
                ...text,
                id: 'placeholder-darkening-master-heading',
                text: 'Placeholder master heading',
                lang: null,
                runs: [],
                frame: { x: 160, y: 120, width: 1600, height: 200 },
                style: white,
              },
            ],
          };
          slide.background = null;
          slide.darken = { kind, strength: 0.5 };
          slide.cues = [];
          slide.elements = [
            {
              ...text,
              text: 'Placeholder own words',
              lang: null,
              runs: [],
              frame: { x: 160, y: 650, width: 1600, height: 200 },
              style: white,
            },
          ];
          const saved = await d.library.saveSlides(id, doc, opened.stamp);
          if (!saved.ok) throw new Error(saved.message);
          // New master/element IDs are assigned on save: use the stored IDs, never the draft ones.
          const kept = await d.library.slidesForEdit(id);
          if (!kept.ok) throw new Error(kept.message);
          const master = kept.doc.master?.elements.find((el) => el.kind === 'text');
          const own = kept.doc.groups.flatMap((g) => g.slides)[0]?.elements.find((el) => el.kind === 'text');
          if (!master || !own) throw new Error('placeholder headings were not kept');
          return {
            masterHeadingId: master.id,
            ownWordsId: own.id,
            width: kept.doc.width,
            height: kept.doc.height,
          };
        },
        { id, kind },
      );
      await setUpScreen(win);
      const output = await outputPage(app);
      await outputReady(output);
      await goLive(win, id, 0);
      const audience = output.locator('[data-layer="slide"] [data-slide]');
      await expect(audience).toHaveCount(1);
      await expect(audience).toContainText('Placeholder master heading');
      await openLibrary(win);
      await win
        .getByTestId('presentation-list')
        .getByRole('button', { name: /^Placeholder master darkening/ })
        .click();
      await win.getByTestId('edit-slides').click();
      const { ed, editor } = await slideEditorWindow(app);
      const still = editor.getByTestId('editor-slide');
      await expect(still).toContainText('Placeholder master heading');
      for (const page of [ed, output])
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
      const brightestWords = async (page: Page, words: Locator): Promise<number> => {
        const box = await words.boundingBox();
        if (!box) throw new Error('no placeholder word box');
        const grid = Array.from({ length: 600 }, (_, i) => ({
          x: box.x + ((i % 60) + 0.5) * (box.width / 60),
          y: box.y + (0.2 + Math.floor(i / 60) * 0.06) * box.height,
        }));
        return Math.max(
          ...(await pixels(page, grid)).map((rgba) => Math.min(rgba[0] ?? 0, rgba[1] ?? 0, rgba[2] ?? 0)),
        );
      };
      for (const size of [
        { width: 1024, height: 645 },
        { width: 1280, height: 720 },
      ]) {
        await sizeSlideEditor(app, ed, size);
        // ResizeObserver updates the fitted canvas after the native content size changes.
        await ed.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        // Output is the established shared renderer; the editor must show exactly its layering.
        for (const view of [
          { name: 'audience', page: output, slide: audience },
          { name: 'editor', page: ed, slide: still },
        ]) {
          const heading = view.slide.locator(`[data-element="${fixture.masterHeadingId}"]`);
          const own = view.slide.locator(`[data-element="${fixture.ownWordsId}"]`);
          await expect(heading).toHaveCount(1);
          await expect(own).toHaveCount(1);
          const box = await view.slide.boundingBox();
          if (!box) throw new Error('no placeholder slide canvas');
          const points = [
            { x: 513, y: 457 }, // background shape, clear of both text bands and editor grid lines
            { x: 183, y: 221 }, // empty left edge inside the master heading’s band
            { x: 183, y: 751 }, // empty left edge inside the ordinary words’ band
          ].map((point) => ({
            x: box.x + (point.x / fixture.width) * box.width,
            y: box.y + (point.y / fixture.height) * box.height,
          }));
          const [shape, masterBand, ownBand] = await pixels(view.page, points);
          const label = `${view.name}, ${kind}, ${size.width}: ${JSON.stringify({ shape, masterBand, ownBand, box })}`;
          expect
            .soft(
              near(shape, kind === 'whole' ? [100, 40, 20] : [200, 80, 40], 8),
              `${label}: background shape`,
            )
            .toBe(true);
          expect
            .soft(near(masterBand, [100, 40, 20], 8), `${label}: darkening behind master words`)
            .toBe(true);
          expect.soft(near(ownBand, [100, 40, 20], 8), `${label}: darkening behind own words`).toBe(true);
          expect
            .soft(await brightestWords(view.page, heading), `${label}: master heading stays white`)
            .toBeGreaterThan(230);
          expect
            .soft(await brightestWords(view.page, own), `${label}: own words stay white`)
            .toBeGreaterThan(230);
          if (kind === 'whole') {
            await expect(view.slide.locator('[data-darken="whole"]')).toHaveCount(1);
            const underMaster = await heading.evaluate((words) => {
              const slide = words.closest('[data-testid="editor-slide"], [data-slide]');
              const overlay = slide?.querySelector('[data-darken="whole"]');
              return Boolean(
                overlay && overlay.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING,
              );
            });
            expect.soft(underMaster, `${label}: whole overlay precedes master words`).toBe(true);
          } else {
            // The ordinary band is a control: only the master band was omitted by Canvas.
            await expect.soft(heading.locator('[data-darken="band"]')).toHaveCount(1);
            await expect(own.locator('[data-darken="band"]')).toHaveCount(1);
          }
        }
      }
    } finally {
      await app.close();
    }
  });
